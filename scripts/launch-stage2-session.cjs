/* eslint-disable @typescript-eslint/no-require-imports -- Local-only launch transactions; the browser wallet signs. */
const fs = require('node:fs');
const path = require('node:path');
const { decodeFunctionData, encodeFunctionData, formatEther, formatUnits, getAddress, keccak256, parseAbi, parseUnits } = require('viem');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const tokenAbi = parseAbi([
  'function owner() view returns(address)', 'function launchPool() view returns(address)', 'function tradingPair() view returns(address)',
  'function usdt() view returns(address)', 'function phase() view returns(uint8)', 'function claimStartsAt() view returns(uint64)',
  'function tradingStartsAt() view returns(uint64)', 'function liquidityEnabled() view returns(bool)', 'function balanceOf(address) view returns(uint256)',
  'function allowance(address,address) view returns(uint256)', 'function approve(address,uint256) returns(bool)',
  'function scheduleLaunch(uint64,uint64)', 'function openLiquidity()',
]);
const erc20Abi = parseAbi([
  'function decimals() view returns(uint8)', 'function balanceOf(address) view returns(uint256)',
  'function allowance(address,address) view returns(uint256)', 'function approve(address,uint256) returns(bool)',
]);
const poolAbi = parseAbi([
  'function token() view returns(address)', 'function usdt() view returns(address)', 'function tradingPair() view returns(address)',
  'function lpReceiver() view returns(address)', 'function previousPool() view returns(address)', 'function poolBalance() view returns(uint256)',
  'function previewSeed(uint256) view returns(uint256,uint256)', 'function seedLiquidity(uint256,uint256,uint256,uint256)',
]);
const previousPoolAbi = parseAbi(['function signer() view returns(address)', 'function poolBalance() view returns(uint256)']);
const pairAbi = parseAbi([
  'function token0() view returns(address)', 'function token1() view returns(address)', 'function totalSupply() view returns(uint256)',
  'function getReserves() view returns(uint112,uint112,uint32)', 'function balanceOf(address) view returns(uint256)',
]);
const kinds = ['schedule', 'approveToken', 'approveUsdt', 'open', 'seed'];
const labels = {
  schedule: '设置领取与交易时间', approveToken: '授权 70,000 枚 CaBi', approveUsdt: '授权 100 USDT',
  open: '开启组 LP', seed: '首次加入 100 USDT＋70,000 CaBi',
};

function createStage2Session({ client, config, recordFile, confirmations = 2 }) {
  for (const field of ['owner', 'token', 'pool', 'pair', 'usdt', 'previousPool', 'lpReceiver']) config[field] = getAddress(config[field]);
  const tokenAmount = parseUnits(config.seedTokens, 18), quoteAmount = parseUnits(config.seedUsdt, 18);
  const claimAt = BigInt(config.claimStartsAt), tradingAt = BigInt(config.tradingStartsAt);
  if (tradingAt < claimAt) throw new Error('交易开放时间早于领取时间');
  for (const [time, text] of [[claimAt, config.claimStartsAtBeijing], [tradingAt, config.tradingStartsAtBeijing]]) {
    const iso = text.replace(' ', 'T') + (text.length === 16 ? ':00' : '') + '+08:00';
    if (BigInt(Date.parse(iso) / 1000) !== time) throw new Error('北京时间显示和交易时间戳不一致');
  }
  const cachedPlans = new Map();
  const fingerprint = keccak256(Buffer.from(JSON.stringify({ ...config, kind: 'cabi-stage2-v1' })));
  const empty = () => ({ fingerprint, actions: {}, pending: null, failures: [], resets: [] });
  function load() {
    if (!fs.existsSync(recordFile)) return empty();
    const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
    if (record.fingerprint !== fingerprint) throw new Error('操作记录参数不符，已停止操作');
    return record;
  }
  function save(record) {
    fs.mkdirSync(path.dirname(recordFile), { recursive: true });
    fs.writeFileSync(recordFile + '.tmp', JSON.stringify(record, null, 2) + '\n');
    fs.renameSync(recordFile + '.tmp', recordFile);
  }
  const read = (address, abi, functionName, args = [], blockNumber) => client.readContract({ address, abi, functionName, args, blockNumber });
  async function status() {
    if (await client.getChainId() !== config.chainId) throw new Error('RPC 当前不是 BSC 主网');
    const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
    const [tokenCode, poolCode, pairCode, previousCode] = await Promise.all([
      client.getCode({ address: config.token, blockNumber }), client.getCode({ address: config.pool, blockNumber }),
      client.getCode({ address: config.pair, blockNumber }), client.getCode({ address: config.previousPool, blockNumber }),
    ]);
    if ([tokenCode, poolCode, pairCode, previousCode].some(code => !code || code === '0x')) throw new Error('目标合约链上代码缺失');
    const [owner, launchPool, tradingPair, configuredUsdt, phase, scheduledClaim, scheduledTrading, liquidityEnabled,
      ownerTokens, tokenAllowance, usdtDecimals, ownerUsdt, usdtAllowance, oldSigner, oldBalance, poolToken, poolUsdt,
      poolPair, receiver, previousPool, poolTokens, token0, token1, reserves, pairSupply, pairTokens, pairUsdt, lpOwner,
      seedPreview, block] = await Promise.all([
      read(config.token, tokenAbi, 'owner', [], blockNumber), read(config.token, tokenAbi, 'launchPool', [], blockNumber),
      read(config.token, tokenAbi, 'tradingPair', [], blockNumber), read(config.token, tokenAbi, 'usdt', [], blockNumber),
      read(config.token, tokenAbi, 'phase', [], blockNumber), read(config.token, tokenAbi, 'claimStartsAt', [], blockNumber),
      read(config.token, tokenAbi, 'tradingStartsAt', [], blockNumber), read(config.token, tokenAbi, 'liquidityEnabled', [], blockNumber),
      read(config.token, tokenAbi, 'balanceOf', [config.owner], blockNumber), read(config.token, tokenAbi, 'allowance', [config.owner, config.pool], blockNumber),
      read(config.usdt, erc20Abi, 'decimals', [], blockNumber), read(config.usdt, erc20Abi, 'balanceOf', [config.owner], blockNumber),
      read(config.usdt, erc20Abi, 'allowance', [config.owner, config.pool], blockNumber),
      read(config.previousPool, previousPoolAbi, 'signer', [], blockNumber), read(config.previousPool, previousPoolAbi, 'poolBalance', [], blockNumber),
      read(config.pool, poolAbi, 'token', [], blockNumber), read(config.pool, poolAbi, 'usdt', [], blockNumber),
      read(config.pool, poolAbi, 'tradingPair', [], blockNumber), read(config.pool, poolAbi, 'lpReceiver', [], blockNumber),
      read(config.pool, poolAbi, 'previousPool', [], blockNumber), read(config.pool, poolAbi, 'poolBalance', [], blockNumber),
      read(config.pair, pairAbi, 'token0', [], blockNumber), read(config.pair, pairAbi, 'token1', [], blockNumber),
      read(config.pair, pairAbi, 'getReserves', [], blockNumber), read(config.pair, pairAbi, 'totalSupply', [], blockNumber),
      read(config.token, erc20Abi, 'balanceOf', [config.pair], blockNumber), read(config.usdt, erc20Abi, 'balanceOf', [config.pair], blockNumber),
      read(config.pair, pairAbi, 'balanceOf', [config.owner], blockNumber), read(config.pool, poolAbi, 'previewSeed', [tokenAmount], blockNumber),
      client.getBlock({ blockNumber }),
    ]);
    if (!same(owner, config.owner) || !same(launchPool, config.pool) || !same(tradingPair, config.pair) || !same(configuredUsdt, config.usdt)) throw new Error('代币 owner、交易对或加池合约与公开配置不符');
    if (!same(poolToken, config.token) || !same(poolUsdt, config.usdt) || !same(poolPair, config.pair) || !same(receiver, config.lpReceiver) || !same(previousPool, config.previousPool)) throw new Error('加池合约参数与公开配置不符');
    if (Number(usdtDecimals) !== 18 || !((same(token0, config.token) && same(token1, config.usdt)) || (same(token1, config.token) && same(token0, config.usdt)))) throw new Error('BSC USDT 精度或交易对资产不符');
    if (!same(oldSigner, config.pool) || oldBalance !== 0n) throw new Error('旧领取池尚未停用或余额尚未取空');
    const isToken0 = same(token0, config.token);
    const [r0, r1] = reserves;
    const reserveToken = isToken0 ? r0 : r1, reserveUsdt = isToken0 ? r1 : r0;
    if (pairSupply === 0n ? reserveToken !== 0n || reserveUsdt !== 0n : reserveToken === 0n || reserveUsdt === 0n) throw new Error('交易对储备与 LP 供应量状态不一致');
    if (BigInt(poolTokens) !== parseUnits('700000000', 18)) throw new Error('新池必须恰好有 7 亿枚新 CaBi 储备');
    if (pairSupply === 0n && (pairTokens !== 0n || pairUsdt !== 0n)) throw new Error('空池内有未同步资产，拒绝自动操作');
    const seeded = pairSupply > 0n;
    if (seeded && (reserveToken !== tokenAmount || reserveUsdt !== quoteAmount || pairTokens !== reserveToken || pairUsdt !== reserveUsdt || lpOwner === 0n)) throw new Error('交易对已有流动性但数量或接收地址不符，请人工核对');
    if (BigInt(phase) >= 3) throw new Error('公开交易已经开放，拒绝执行筹备阶段操作');
    if (liquidityEnabled && (scheduledClaim !== claimAt || scheduledTrading !== tradingAt)) throw new Error('已锁定的开放时间与本次计划不符');
    if (pairSupply === 0n && (BigInt(poolTokens) !== parseUnits('700000000', 18) || BigInt(ownerTokens) < tokenAmount || BigInt(ownerUsdt) < quoteAmount)) throw new Error('新池储备或管理员钱包余额不足');
    if (seedPreview[0] !== quoteAmount || (pairSupply === 0n && seedPreview[1] === 0n)) throw new Error('初始加池预估与 100 USDT＋70,000 CaBi 不一致');
    const record = load();
    await reconcileUnexpectedApproval(record, { tokenAllowance, blockNumber });
    const state = {
      blockNumber: String(blockNumber), phase: Number(phase), liquidityEnabled, claimStartsAt: String(scheduledClaim),
      tradingStartsAt: String(scheduledTrading), now: String(block.timestamp),
      claimStartsAtConfigured: config.claimStartsAt, tradingStartsAtConfigured: config.tradingStartsAt,
      ownerTokenBalance: String(ownerTokens), ownerTokenBalanceFormatted: formatEther(ownerTokens),
      ownerUsdtBalance: String(ownerUsdt), ownerUsdtBalanceFormatted: formatUnits(ownerUsdt, 18),
      tokenAllowance: String(tokenAllowance), usdtAllowance: String(usdtAllowance), tokenAmount: String(tokenAmount),
      quoteAmount: String(quoteAmount), poolBalance: String(poolTokens), poolBalanceFormatted: formatEther(poolTokens),
      pairSupply: String(pairSupply), reserveToken: String(reserveToken), reserveUsdt: String(reserveUsdt),
      ownerLpBalance: String(lpOwner), estimatedLp: String(seedPreview[1]), usdtRequired: String(seedPreview[0]),
      seeded, scheduleSet: scheduledClaim === claimAt && scheduledTrading === tradingAt,
      tokenApproved: seeded || tokenAllowance === tokenAmount, usdtApproved: seeded || usdtAllowance === quoteAmount,
    };
    const done = completion(state);
    for (const kind of kinds) if (done[kind] && record.pending?.kind !== kind && !record.actions[kind]) record.actions[kind] = { kind, observedAt: new Date().toISOString(), blockNumber: state.blockNumber };
    save(record);
    return { record, state };
  }
  async function reconcileUnexpectedApproval(record, state) {
    const pending = record.pending;
    if (pending?.kind !== 'approveToken' || !pending.hash || state.tokenAllowance <= tokenAmount) return;
    try {
      const [tx, receipt, head] = await Promise.all([
        client.getTransaction({ hash: pending.hash }), client.getTransactionReceipt({ hash: pending.hash }),
        client.getBlockNumber({ cacheTime: 0 }),
      ]);
      const decoded = decodeFunctionData({ abi: tokenAbi, data: tx.input });
      if (receipt.status !== 'success' || head - receipt.blockNumber + 1n < BigInt(confirmations)
        || !same(tx.from, config.owner) || !same(tx.to, config.token) || tx.value !== 0n
        || BigInt(tx.nonce) !== BigInt(pending.nonce) || decoded.functionName !== 'approve'
        || !same(decoded.args[0], config.pool) || decoded.args[1] === tokenAmount || state.tokenAllowance !== decoded.args[1]) return;
      record.failures.push({
        kind: 'approveToken', hash: pending.hash, expectedAmount: String(tokenAmount), actualAmount: String(decoded.args[1]),
        reason: 'approval amount differed from the exact limit; revoke it and approve the exact amount', at: new Date().toISOString(),
      });
      record.pending = null;
    } catch {
      // Keep the pending record if the transaction cannot be identified safely.
    }
  }
  function completion(state) {
    return { schedule: state.scheduleSet, approveToken: state.tokenApproved, approveUsdt: state.usdtApproved, open: state.liquidityEnabled, seed: state.seeded };
  }
  function transaction(kind, state, fixedDeadline) {
    if (kind === 'schedule') return { to: config.token, data: encodeFunctionData({ abi: tokenAbi, functionName: 'scheduleLaunch', args: [claimAt, tradingAt] }), detail: `领取 ${config.claimStartsAtBeijing}（北京时间）；交易 ${config.tradingStartsAtBeijing}（北京时间）` };
    if (kind === 'approveToken') {
      if (BigInt(state.tokenAllowance) !== 0n && BigInt(state.tokenAllowance) !== tokenAmount) {
        return { to: config.token, data: encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [config.pool, 0n] }), detail: '撤销当前多余的 CaBi 授权，之后再精确授权 70,000 枚' };
      }
      return { to: config.token, data: encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [config.pool, tokenAmount] }), detail: '仅授权新池使用 70,000 枚新 CaBi' };
    }
    if (kind === 'approveUsdt') return { to: config.usdt, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [config.pool, quoteAmount] }), detail: '仅授权新池使用 100 USDT' };
    if (kind === 'open') return { to: config.token, data: encodeFunctionData({ abi: tokenAbi, functionName: 'openLiquidity' }), detail: '开启组 LP，并永久锁定领取与交易时间' };
    if (kind === 'seed') {
      const deadline = fixedDeadline ? BigInt(fixedDeadline) : BigInt(state.now) + 1800n;
      if (deadline <= BigInt(state.now) + 60n) throw new Error('加池交易预览已过期，请重新检查');
      const minimum = BigInt(state.estimatedLp) * 99n / 100n;
      if (!minimum) throw new Error('预估 LP 为零');
      return { to: config.pool, data: encodeFunctionData({ abi: poolAbi, functionName: 'seedLiquidity', args: [tokenAmount, quoteAmount, minimum, deadline] }), deadline: String(deadline), detail: `经新池添加 70,000 新 CaBi＋100 USDT；最少 LP ${formatEther(minimum)}（预估 99%）` };
    }
    throw new Error('未知操作');
  }
  async function plan(kind, fixedDeadline) {
    const { record, state } = await status();
    if (!kinds.includes(kind)) throw new Error('未知操作');
    if (record.pending) throw new Error('上一笔操作尚未核对，请先查询交易状态');
    const done = completion(state);
    if (done[kind]) throw new Error('该步骤已在链上完成，不要重复提交');
    const index = kinds.indexOf(kind);
    if (kinds.slice(0, index).some(item => !done[item])) throw new Error('请先完成前一个步骤');
    if (kind === 'schedule' && state.liquidityEnabled) throw new Error('组 LP 已开启，时间已锁定');
    if (kind === 'open' && (!done.schedule || !done.approveToken || !done.approveUsdt)) throw new Error('先确认时间和两项精确授权');
    if (kind === 'seed' && (!state.liquidityEnabled || !done.approveToken || !done.approveUsdt || state.seeded)) throw new Error('先开启组 LP 并完成两项授权');
    const call = transaction(kind, state, fixedDeadline);
    const [estimatedGas, gasPrice, nativeBalance] = await Promise.all([
      client.estimateGas({ account: config.owner, to: call.to, data: call.data, value: 0n }),
      client.getGasPrice(), client.getBalance({ address: config.owner }),
    ]);
    const gas = (estimatedGas * 120n + 99n) / 100n;
    if (nativeBalance < gas * gasPrice) throw new Error('管理员钱包 BNB 不足以支付本笔 GAS');
    const result = { kind, label: labels[kind], detail: call.detail, deadline: call.deadline, dataHash: keccak256(call.data), estimatedFeeBnb: formatEther(estimatedGas * gasPrice), maxFeeBnb: formatEther(gas * gasPrice), tx: { from: config.owner, to: call.to, data: call.data, value: '0x0', chainId: '0x' + BigInt(config.chainId).toString(16), gas: '0x' + gas.toString(16), gasPrice: '0x' + gasPrice.toString(16) } };
    cachedPlans.set(result.dataHash, result);
    return result;
  }
  async function begin(kind, nonce, dataHash) {
    if (!/^0x[0-9a-f]+$/i.test(nonce)) throw new Error('nonce 必须是十六进制字符串');
    const prior = cachedPlans.get(dataHash);
    if (!prior || prior.kind !== kind) throw new Error('交易预览已失效，请刷新页面重新检查');
    const planned = await plan(kind, prior.deadline);
    if (planned.dataHash !== dataHash) throw new Error('链上计划已变化，请重新刷新检查');
    const record = load(); record.pending = { kind, nonce, dataHash, tx: planned.tx, detail: planned.detail, status: 'awaiting-wallet', at: new Date().toISOString() }; save(record);
    return record.pending;
  }
  function attachHash(kind, hash) {
    if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('交易哈希格式不正确');
    const record = load(); if (!record.pending || record.pending.kind !== kind) throw new Error('待核对操作不符');
    record.pending.hash = hash; record.pending.status = 'pending'; save(record);
  }
  function cancelled(kind) {
    const record = load(); if (record.pending?.kind !== kind || record.pending.hash) throw new Error('已有交易哈希，请先核对');
    record.pending = null; save(record);
  }
  async function verify(kind, hash) {
    if (!kinds.includes(kind) || !/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('操作类型或交易哈希无效');
    const record = load();
    if (record.actions[kind]?.hash === hash) return { verified: record.actions[kind], record, state: (await status()).state };
    if (!record.pending || record.pending.kind !== kind) throw new Error('没有对应待核对交易，请先刷新链上状态');
    const [tx, receipt, head] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash }), client.getBlockNumber({ cacheTime: 0 })]);
    if (!same(tx.from, config.owner) || !same(tx.to, record.pending.tx.to) || !same(tx.input, record.pending.tx.data) || tx.value !== 0n || BigInt(tx.nonce) !== BigInt(record.pending.nonce)) throw new Error('交易发送人、目标、金额或 nonce 与页面计划不符');
    if (receipt.status !== 'success') {
      record.failures.push({ kind, hash, at: new Date().toISOString() }); record.pending = null; save(record);
      return { reverted: true, error: '链上执行失败。状态未推进，可以刷新后重新检查' };
    }
    if (head - receipt.blockNumber + 1n < BigInt(confirmations)) return { pending: true, message: '交易已上链，等待第二个区块确认' };
    const state = (await status()).state;
    if (kind === 'approveToken' && state.tokenAllowance === '0') {
      const reset = decodeFunctionData({ abi: tokenAbi, data: record.pending.tx.data });
      if (same(record.pending.tx.to, config.token) && reset.functionName === 'approve'
        && same(reset.args[0], config.pool) && reset.args[1] === 0n) {
        record.resets ||= [];
        record.resets.push({ kind: 'approveToken', hash, blockNumber: String(receipt.blockNumber), verifiedAt: new Date().toISOString() });
        record.pending = null;
        save(record);
        return {
          intermediate: true, state, record,
          message: '多余 CaBi 授权已撤销。请继续点击“授权 CaBi”，并在钱包确认精确的 70,000 枚授权。',
        };
      }
    }
    if (!completion(state)[kind]) throw new Error('链上状态尚未达到目标；等待记录已保留，请勿重复发送');
    const verified = { kind, hash, blockNumber: String(receipt.blockNumber), verifiedAt: new Date().toISOString() };
    record.actions[kind] = verified; record.pending = null; save(record);
    return { verified, state, record };
  }
  return { config, fingerprint, kinds, labels, status, plan, begin, attachHash, cancelled, verify };
}
module.exports = { createStage2Session, kinds, labels };
