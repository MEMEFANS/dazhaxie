/* eslint-disable @typescript-eslint/no-require-imports -- Plugin-wallet deployment tooling; no signing keys. */
const fs = require('node:fs');
const path = require('node:path');
const { encodeDeployData, encodeFunctionData, formatEther, getAddress, keccak256, parseAbi, parseUnits, zeroAddress } = require('viem');
const { compileLaunch } = require('./compile-launch-contracts.cjs');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const factoryAbi = parseAbi(['function getPair(address,address) view returns(address)', 'function createPair(address,address) returns(address)']);
const pairAbi = parseAbi(['function factory() view returns(address)', 'function token0() view returns(address)', 'function token1() view returns(address)']);
const publicAbi = parseAbi(['function owner() view returns(address)', 'function signer() view returns(address)', 'function token() view returns(address)', 'function usdt() view returns(address)', 'function lpReceiver() view returns(address)', 'function decimals() view returns(uint8)', 'function poolBalance() view returns(uint256)', 'function totalClaimed() view returns(uint256)', 'function factory() view returns(address)', 'function reservedPayout() view returns(uint256)', 'function totalPrepared() view returns(uint256)', 'function escrowedLp() view returns(uint256)']);
const kinds = ['token', 'pair', 'trading', 'pool', 'bind'];
const labels = { token: '部署新版 CaBi 代币', pair: '创建 CaBi／USDT 交易对', trading: '绑定 PancakeSwap 交易对', pool: '部署加池与领取合约', bind: '绑定专用加池合约', fund: '注入新 CaBi 储备' };

function buildBundle() {
  const { input, output } = compileLaunch();
  const entry = name => {
    const a = output.contracts[name + '.sol'][name];
    return { abi: a.abi, bytecode: '0x' + a.evm.bytecode.object, runtime: '0x' + a.evm.deployedBytecode.object, immutableReferences: a.evm.deployedBytecode.immutableReferences };
  };
  return { input, token: entry('CaBiLaunchToken'), pool: entry('CaBiLaunchPool') };
}
function checkRuntime(code, entry) {
  if (!code || code === '0x') throw new Error('合约尚未上链');
  const actual = Buffer.from(code.slice(2), 'hex'), expected = Buffer.from(entry.runtime.slice(2), 'hex');
  if (actual.length !== expected.length) throw new Error('链上合约长度与本次构建不一致');
  for (const positions of Object.values(entry.immutableReferences || {})) {
    for (const { start, length } of positions) { actual.fill(0, start, start + length); expected.fill(0, start, start + length); }
  }
  if (keccak256(actual) !== keccak256(expected)) throw new Error('链上合约代码与本次构建不一致');
}

function createSession({ client, config, bundle, recordFile, confirmations = 2 }) {
  const steps = config.fundReserve ? [...kinds, 'fund'] : kinds;
  const reserve = config.fundReserve ? parseUnits(config.newTokenClaimReserve, 18) : 0n;
  if (config.fundReserve && (reserve <= 0n || reserve > parseUnits('1000000000', 18) - parseUnits(config.initialTokenAmount, 18))) throw new Error('新池储备须为正数，并为初始加池预留代币');
  for (const field of ['owner', 'distributionReceiver', 'buybackPool', 'lpReceiver', 'signer', 'usdt', 'router', 'factory', 'previousClaimPool']) config[field] = getAddress(config[field]);
  const fingerprint = keccak256(Buffer.from(JSON.stringify({ config, token: bundle.token.bytecode, pool: bundle.pool.bytecode })));
  const blank = () => ({ fingerprint, actions: {}, pending: null, failures: [] });
  function load() {
    if (!fs.existsSync(recordFile)) return blank();
    const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
    if (record.fingerprint !== fingerprint) throw new Error('已有部署记录属于另一套参数，请使用新的记录目录');
    return record;
  }
  function save(record) {
    fs.mkdirSync(path.dirname(recordFile), { recursive: true });
    fs.writeFileSync(recordFile + '.tmp', JSON.stringify(record, null, 2) + '\n');
    fs.renameSync(recordFile + '.tmp', recordFile);
  }
  const read = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args });
  async function preflight() {
    const [chain, factory, decimals, balance, gasPrice, estimate] = await Promise.all([
      client.getChainId(), read(config.router, publicAbi, 'factory'), read(config.usdt, publicAbi, 'decimals'),
      client.getBalance({ address: config.owner }), client.getGasPrice(),
      client.estimateGas({ account: config.owner, ...transaction('token', blank()), value: 0n }),
    ]);
    if (chain !== config.chainId || !same(factory, config.factory) || decimals !== 18) throw new Error('BSC、Router／Factory 或 USDT 配置不符');
    let previous = null;
    if (!same(config.previousClaimPool, zeroAddress)) {
      const [signer, usdt, lpReceiver, poolBalance, totalClaimed, token] = await Promise.all([
        ...['signer', 'usdt', 'lpReceiver', 'poolBalance', 'totalClaimed', 'token'].map(name => read(config.previousClaimPool, publicAbi, name)),
      ]);
      const owner = await read(config.previousPoolKind === 'launch' ? token : config.previousClaimPool, publicAbi, 'owner');
      const retiredToThisPool = same(signer, load().actions.pool?.address);
      if (!same(owner, config.owner) || (!same(signer, config.signer) && !retiredToThisPool) || !same(usdt, config.usdt) || !same(lpReceiver, config.lpReceiver) || (config.previousToken && !same(token, config.previousToken))) throw new Error('旧领取池配置与本次参数不同，请核对');
      previous = { token, poolBalance: String(poolBalance), totalClaimed: String(totalClaimed) };
      if (config.previousPoolKind === 'launch') {
        const values = await Promise.all(['reservedPayout', 'totalPrepared', 'escrowedLp'].map(name => read(config.previousClaimPool, publicAbi, name)));
        ['reservedPayout', 'totalPrepared', 'escrowedLp'].forEach((name, index) => { previous[name] = String(values[index]); });
      }
    }
    return { chainId: chain, ownerBalanceBnb: formatEther(balance), tokenEstimatedGas: String(estimate), tokenEstimatedFeeBnb: formatEther(estimate * gasPrice), gasPriceWei: String(gasPrice), previous, checkedAt: new Date().toISOString() };
  }
  function transaction(kind, record) {
    const token = record.actions.token?.address, pair = record.pair?.address, pool = record.actions.pool?.address;
    if (!steps.includes(kind)) throw new Error('未知部署步骤');
    let to, data;
    if (kind === 'token') data = encodeDeployData({ ...bundle.token, args: [config.distributionReceiver, config.buybackPool, config.owner] });
    else {
      if (!token) throw new Error('请先核验代币部署');
      if (kind === 'pair') { to = config.factory; data = encodeFunctionData({ abi: factoryAbi, functionName: 'createPair', args: [token, config.usdt] }); }
      if (kind === 'trading') {
        if (!pair) throw new Error('请先创建交易对');
        to = token; data = encodeFunctionData({ abi: bundle.token.abi, functionName: 'configureTrading', args: [config.router, config.usdt, pair] });
      }
      if (kind === 'pool') data = encodeDeployData({ ...bundle.pool, args: [token, config.signer, config.lpReceiver, config.previousClaimPool] });
      if (kind === 'bind') {
        if (!pool) throw new Error('请先核验加池合约部署');
        to = token; data = encodeFunctionData({ abi: bundle.token.abi, functionName: 'configureLaunchPool', args: [pool] });
      }
      if (kind === 'fund') {
        if (!pool) throw new Error('请先核验加池合约部署');
        to = token; data = encodeFunctionData({ abi: bundle.token.abi, functionName: 'transfer', args: [pool, reserve] });
      }
    }
    return { ...(to ? { to } : {}), data };
  }
  async function inspect(record) {
    const state = { token: null, pair: null, pool: null, tradingReady: false, bindReady: false, funded: false, phase: null, complete: false };
    if (await client.getChainId() !== config.chainId) throw new Error('RPC 网络不符');
    const token = record.actions.token?.address;
    if (!token) return state;
    const [code, owner, distribution, buyback, totalSupply, configuredPair, router, usdt, launchPool, phase, claimAt, tradingAt, liquidityEnabled] = await Promise.all([
      client.getCode({ address: token }),
      ...['owner', 'distributionReceiver', 'buybackPool', 'totalSupply', 'tradingPair', 'dexRouter', 'usdt', 'launchPool', 'phase', 'claimStartsAt', 'tradingStartsAt', 'liquidityEnabled'].map(name => read(token, bundle.token.abi, name)),
    ]);
    checkRuntime(code, bundle.token);
    const [walletLimitEnabled, maxWalletAmount] = await Promise.all(['walletLimitEnabled', 'maxWalletAmount'].map(name => read(token, bundle.token.abi, name)));
    if (walletLimitEnabled || maxWalletAmount !== totalSupply) throw new Error('新代币的无持仓上限配置不符');
    if (!same(owner, config.owner) || !same(distribution, config.distributionReceiver) || !same(buyback, config.buybackPool) || totalSupply !== 1_000_000_000n * 10n ** 18n) throw new Error('代币状态与确认参数不符');
    state.token = token; state.walletLimitEnabled = walletLimitEnabled; state.phase = Number(phase); state.claimAt = String(claimAt); state.tradingAt = String(tradingAt); state.liquidityEnabled = liquidityEnabled;
    const pair = await read(config.factory, factoryAbi, 'getPair', [token, config.usdt]);
    if (!same(pair, zeroAddress)) {
      const [factory, first, second] = await Promise.all(['factory', 'token0', 'token1'].map(name => read(pair, pairAbi, name)));
      if (!same(factory, config.factory) || !((same(first, token) && same(second, config.usdt)) || (same(first, config.usdt) && same(second, token)))) throw new Error('交易对资产或 Factory 不符');
      state.pair = pair; record.pair = { ...(record.pair || {}), address: pair };
    }
    if (!same(configuredPair, zeroAddress)) {
      if (!same(configuredPair, state.pair) || !same(router, config.router) || !same(usdt, config.usdt)) throw new Error('代币绑定了不同的交易对');
      state.tradingReady = true;
    }
    const pool = record.actions.pool?.address;
    if (pool) {
      const [poolCode, actualToken, actualUsdt, actualPair, receiver, signer, previous, exempt, poolBalance, seedProvider] = await Promise.all([
        client.getCode({ address: pool }), ...['token', 'usdt', 'tradingPair', 'lpReceiver', 'signer', 'previousPool'].map(name => read(pool, bundle.pool.abi, name)),
        read(token, bundle.token.abi, 'isMaxWalletExempt', [pool]), read(pool, bundle.pool.abi, 'poolBalance'),
        read(pool, bundle.pool.abi, 'seedProvider'),
      ]);
      checkRuntime(poolCode, bundle.pool);
      if (!same(actualToken, token) || !same(actualUsdt, config.usdt) || !same(actualPair, state.pair) || !same(receiver, config.lpReceiver) || !same(signer, config.signer) || !same(previous, config.previousClaimPool)) throw new Error('加池合约参数不符');
      state.pool = pool; state.poolBalance = String(poolBalance);
      state.seedProvider = seedProvider;
      state.bindReady = same(launchPool, pool) && exempt;
      state.funded = config.fundReserve && poolBalance >= reserve;
    }
    if (!same(launchPool, zeroAddress) && !same(launchPool, pool)) throw new Error('代币已绑定其它加池合约');
    state.complete = Boolean(state.token && state.pair && state.tradingReady && state.pool && state.bindReady && (!config.fundReserve || state.funded));
    return state;
  }
  const done = (kind, state) => ({ token: Boolean(state.token), pair: Boolean(state.pair), trading: state.tradingReady, pool: Boolean(state.pool), bind: state.bindReady, fund: state.funded })[kind];
  async function status() {
    const record = load(); const state = await inspect(record); save(record);
    return { record, state };
  }
  async function plan(kind) {
    const { record, state } = await status();
    if (record.pending) throw new Error('上一笔钱包操作尚未核对，请先查询已有交易');
    if (done(kind, state)) throw new Error('该步骤已在链上完成，无需重复发送');
    const index = steps.indexOf(kind);
    if (index < 0 || steps.slice(0, index).some(prior => !done(prior, state))) throw new Error('请先完成前面的部署步骤');
    if (kind === 'fund' && (state.phase !== 0 || BigInt(state.poolBalance) !== 0n)) throw new Error('新池已经开放或已收到部分储备，请核对余额后补足，不重复转入整笔储备');
    const tx = transaction(kind, record);
    const [estimatedGas, gasPrice, balance] = await Promise.all([
      client.estimateGas({ account: config.owner, ...tx, value: 0n }), client.getGasPrice(), client.getBalance({ address: config.owner }),
    ]);
    const gas = (estimatedGas * 120n + 99n) / 100n;
    if (balance < gas * gasPrice) throw new Error('管理员钱包 BNB 不足以支付本笔 GAS');
    return { kind, label: labels[kind], tx: { from: config.owner, ...tx, value: '0x0', chainId: '0x' + BigInt(config.chainId).toString(16), gas: '0x' + gas.toString(16), gasPrice: '0x' + gasPrice.toString(16) }, dataHash: keccak256(tx.data), estimatedFeeBnb: formatEther(estimatedGas * gasPrice), maxFeeBnb: formatEther(gas * gasPrice) };
  }
  async function begin(kind, nonce, dataHash) {
    if (!/^0x[0-9a-f]+$/i.test(nonce)) throw new Error('nonce 必须为十六进制字符串');
    const prepared = await plan(kind);
    if (prepared.dataHash !== dataHash) throw new Error('交易参数已变化，请重新检查');
    const record = load(); record.pending = { kind, nonce, dataHash, status: 'awaiting-wallet', at: new Date().toISOString() }; save(record);
    return record.pending;
  }
  function attachHash(kind, hash) {
    if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('交易哈希格式不正确');
    const record = load();
    if (!record.pending || record.pending.kind !== kind) throw new Error('钱包操作记录不符');
    record.pending.hash = hash; record.pending.status = 'pending'; save(record);
  }
  function cancelled(kind) {
    const record = load();
    if (record.pending?.kind !== kind || record.pending.hash) throw new Error('已有交易哈希，请先查询');
    record.pending = null; save(record);
  }
  async function verify(kind, hash) {
    if (!steps.includes(kind) || !/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('交易类型或哈希无效');
    const record = load();
    if (record.pending && record.pending.kind !== kind) throw new Error('请先核对当前等待中的交易步骤');
    const [tx, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
    if (record.pending && BigInt(record.pending.nonce) !== BigInt(tx.nonce)) throw new Error('交易 nonce 与当前等待记录不符');
    const expected = transaction(kind, record);
    if (!same(tx.from, config.owner) || !((!tx.to && !expected.to) || same(tx.to, expected.to)) || !same(tx.input, expected.data) || tx.value !== 0n) throw new Error('交易发送人、目标或数据与本次部署计划不符');
    if (receipt.status !== 'success') {
      record.failures.push({ kind, hash, at: new Date().toISOString() }); record.pending = null; save(record);
      return { reverted: true, error: '链上执行失败，可以检查原因后重新操作' };
    }
    const head = await client.getBlockNumber({ cacheTime: 0 });
    if (head - receipt.blockNumber + 1n < BigInt(confirmations)) return { pending: true, message: '交易已上链，等待第二个区块确认' };
    const address = kind === 'token' || kind === 'pool' ? receipt.contractAddress : expected.to;
    if (!address) throw new Error('未取得合约地址');
    const verified = { kind, hash, address, blockNumber: String(receipt.blockNumber), gasUsed: String(receipt.gasUsed), verifiedAt: new Date().toISOString() };
    record.actions[kind] = verified;
    const state = await inspect(record);
    if (!done(kind, state)) throw new Error('链上设置尚未达到预期状态');
    if (kind === 'pair') record.pair.hash = hash;
    record.pending = null; save(record);
    return { verified, state, record };
  }
  return { config, fingerprint, kinds: steps, labels, preflight, status, plan, begin, attachHash, cancelled, verify, transaction: kind => transaction(kind, load()) };
}
module.exports = { buildBundle, createSession, labels, kinds };
