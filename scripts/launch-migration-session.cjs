/* eslint-disable @typescript-eslint/no-require-imports -- Local-only plugin-wallet migration console. */
const fs = require('node:fs');
const { encodeFunctionData, formatEther, getAddress, keccak256, parseAbi, parseUnits } = require('viem');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const previousAbi = parseAbi([
  'function token() view returns(address)', 'function owner() view returns(address)', 'function signer() view returns(address)',
  'function totalClaimed() view returns(uint256)', 'function poolBalance() view returns(uint256)', 'function unusedBalance() view returns(uint256)',
  'function setSigner(address newSigner)', 'function withdrawUnused(uint256 amount)',
]);
const tokenAbi = parseAbi([
  'function owner() view returns(address)', 'function token() view returns(address)', 'function usdt() view returns(address)',
  'function tradingPair() view returns(address)', 'function launchPool() view returns(address)', 'function phase() view returns(uint8)',
  'function liquidityEnabled() view returns(bool)', 'function balanceOf(address) view returns(uint256)', 'function transfer(address,uint256) returns(bool)',
]);
const poolAbi = parseAbi([
  'function token() view returns(address)', 'function usdt() view returns(address)', 'function tradingPair() view returns(address)',
  'function lpReceiver() view returns(address)', 'function previousPool() view returns(address)', 'function signer() view returns(address)',
  'function poolBalance() view returns(uint256)',
]);
const kinds = ['retire', 'withdraw', 'fund'];
const labels = { retire: '停用旧领取池签名', withdraw: '取回旧池代币', fund: '给新池注入新代币储备' };

function createMigrationSession({ client, config, recordFile, confirmations = 2 }) {
  for (const field of ['owner', 'previousToken', 'previousPool', 'previousSigner', 'token', 'pool', 'pair', 'usdt', 'signer', 'lpReceiver']) config[field] = getAddress(config[field]);
  const reserve = parseUnits(config.newPoolReserve, 18);
  const fingerprint = keccak256(Buffer.from(JSON.stringify({ config })));
  const fresh = () => ({ fingerprint, actions: {}, pending: null, failures: [] });
  function load() {
    if (!fs.existsSync(recordFile)) return fresh();
    const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
    if (record.fingerprint !== fingerprint) throw new Error('迁移记录参数不符，已停止操作');
    return record;
  }
  function save(record) {
    fs.mkdirSync(require('node:path').dirname(recordFile), { recursive: true });
    fs.writeFileSync(recordFile + '.tmp', JSON.stringify(record, null, 2) + '\n');
    fs.renameSync(recordFile + '.tmp', recordFile);
  }
  const read = (address, abi, functionName, args = [], blockNumber) => client.readContract({ address, abi, functionName, args, blockNumber });
  async function status() {
    if (await client.getChainId() !== config.chainId) throw new Error('RPC 当前不是 BSC 主网');
    const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
    const [legacyCode, newTokenCode, newPoolCode] = await Promise.all([
      client.getCode({ address: config.previousPool, blockNumber }), client.getCode({ address: config.token, blockNumber }), client.getCode({ address: config.pool, blockNumber }),
    ]);
    if (!legacyCode || legacyCode === '0x' || !newTokenCode || newTokenCode === '0x' || !newPoolCode || newPoolCode === '0x') throw new Error('旧池、新代币或新池链上代码缺失');
    const [oldToken, oldOwner, oldSigner, oldClaimed, oldBalance, oldUnused, tokenOwner, newPool, usdt, pair, phase, liquidityEnabled, ownerTokenBalance, newToken, poolUsdt, poolPair, receiver, previousPool, poolSigner, newBalance] = await Promise.all([
      read(config.previousPool, previousAbi, 'token', [], blockNumber), read(config.previousPool, previousAbi, 'owner', [], blockNumber),
      read(config.previousPool, previousAbi, 'signer', [], blockNumber), read(config.previousPool, previousAbi, 'totalClaimed', [], blockNumber),
      read(config.previousPool, previousAbi, 'poolBalance', [], blockNumber), read(config.previousPool, previousAbi, 'unusedBalance', [], blockNumber),
      read(config.token, tokenAbi, 'owner', [], blockNumber), read(config.token, tokenAbi, 'launchPool', [], blockNumber),
      read(config.token, tokenAbi, 'usdt', [], blockNumber), read(config.token, tokenAbi, 'tradingPair', [], blockNumber),
      read(config.token, tokenAbi, 'phase', [], blockNumber),
      read(config.token, tokenAbi, 'liquidityEnabled', [], blockNumber), read(config.token, tokenAbi, 'balanceOf', [config.owner], blockNumber),
      read(config.pool, poolAbi, 'token', [], blockNumber), read(config.pool, poolAbi, 'usdt', [], blockNumber),
      read(config.pool, poolAbi, 'tradingPair', [], blockNumber), read(config.pool, poolAbi, 'lpReceiver', [], blockNumber),
      read(config.pool, poolAbi, 'previousPool', [], blockNumber), read(config.pool, poolAbi, 'signer', [], blockNumber),
      read(config.pool, poolAbi, 'poolBalance', [], blockNumber),
    ]);
    if (!same(oldToken, config.previousToken) || !same(oldOwner, config.owner)) throw new Error('旧池代币或管理员地址与预期不符');
    if (!same(oldSigner, config.previousSigner) && !same(oldSigner, config.pool)) throw new Error('旧池签名地址与预期不符');
    if (!same(tokenOwner, config.owner) || !same(newPool, config.pool) || !same(usdt, config.usdt) || !same(pair, config.pair)) throw new Error('新代币绑定状态与部署记录不符');
    if (!same(newToken, config.token) || !same(poolUsdt, config.usdt) || !same(poolPair, config.pair) || !same(receiver, config.lpReceiver) || !same(previousPool, config.previousPool) || !same(poolSigner, config.signer)) throw new Error('新池参数与部署记录不符');
    if (Number(phase) !== 0 || liquidityEnabled) throw new Error('代币已不在筹备阶段，已停止迁移');
    if (oldClaimed !== 0n) throw new Error('旧池已有领取记录，不能按整池未领取处理');
    if (oldBalance !== oldUnused) throw new Error('旧池有已分配额度，不能提取全部余额');
    if (newBalance > reserve) throw new Error('新池余额超过设定储备，请先人工核账');
    const record = load();
    const state = {
      blockNumber: String(blockNumber), previousPool: config.previousPool, previousToken: config.previousToken,
      previousSigner: oldSigner, previousBalance: String(oldBalance), previousClaimed: String(oldClaimed),
      token: config.token, pool: config.pool, ownerTokenBalance: String(ownerTokenBalance), poolBalance: String(newBalance),
      previousBalanceFormatted: formatEther(oldBalance), ownerTokenBalanceFormatted: formatEther(ownerTokenBalance),
      poolBalanceFormatted: formatEther(newBalance), targetReserveFormatted: formatEther(reserve),
      targetReserve: String(reserve), retired: same(oldSigner, config.pool), oldPoolEmpty: oldBalance === 0n,
      funded: newBalance === reserve,
    };
    for (const kind of kinds) if (completed(kind, state) && !record.actions[kind]) record.actions[kind] = { kind, observedAt: new Date().toISOString(), blockNumber: state.blockNumber };
    if (record.pending && completed(record.pending.kind, state) && record.pending.hash) {
      record.actions[record.pending.kind] = { kind: record.pending.kind, hash: record.pending.hash, observedAt: new Date().toISOString(), blockNumber: state.blockNumber };
      record.pending = null;
    }
    save(record);
    return { record, state };
  }
  function completed(kind, state) { return ({ retire: state.retired, withdraw: state.oldPoolEmpty, fund: state.funded })[kind] === true; }
  function transaction(kind, state) {
    if (kind === 'retire') return { to: config.previousPool, data: encodeFunctionData({ abi: previousAbi, functionName: 'setSigner', args: [config.pool] }), amount: null, detail: `将旧池签名地址改为新池 ${config.pool}` };
    if (kind === 'withdraw') {
      const amount = BigInt(state.previousBalance);
      if (!amount) throw new Error('旧池余额已经为零');
      return { to: config.previousPool, data: encodeFunctionData({ abi: previousAbi, functionName: 'withdrawUnused', args: [amount] }), amount: String(amount), detail: `从旧池取回 ${formatEther(amount)} 枚旧 CaBi，转回管理员钱包` };
    }
    if (kind === 'fund') {
      const amount = reserve - BigInt(state.poolBalance);
      if (amount <= 0n) throw new Error('新池储备已达到目标，无需重复转账');
      if (BigInt(state.ownerTokenBalance) < amount) throw new Error('管理员钱包的新 CaBi 不足');
      return { to: config.token, data: encodeFunctionData({ abi: tokenAbi, functionName: 'transfer', args: [config.pool, amount] }), amount: String(amount), detail: `向新池转入 ${formatEther(amount)} 枚新 CaBi` };
    }
    throw new Error('未知迁移步骤');
  }
  async function plan(kind) {
    const { record, state } = await status();
    if (!kinds.includes(kind)) throw new Error('未知迁移步骤');
    if (record.pending) throw new Error('上一笔操作等待核对，请先核验已有交易');
    if (completed(kind, state)) throw new Error('该步骤已在链上完成，不要重复提交');
    const index = kinds.indexOf(kind);
    if (kinds.slice(0, index).some(item => !completed(item, state))) throw new Error('请先完成前一笔迁移交易');
    const built = transaction(kind, state);
    const tx = { to: built.to, data: built.data, value: 0n };
    const [estimatedGas, gasPrice, balance] = await Promise.all([
      client.estimateGas({ account: config.owner, ...tx }), client.getGasPrice(), client.getBalance({ address: config.owner }),
    ]);
    const gas = (estimatedGas * 120n + 99n) / 100n;
    if (balance < gas * gasPrice) throw new Error('管理员钱包 BNB 不足以支付本笔 GAS');
    return { kind, label: labels[kind], detail: built.detail, dataHash: keccak256(tx.data), amount: built.amount, estimatedFeeBnb: formatEther(estimatedGas * gasPrice), maxFeeBnb: formatEther(gas * gasPrice), tx: { from: config.owner, to: tx.to, data: tx.data, value: '0x0', chainId: '0x38', gas: '0x' + gas.toString(16), gasPrice: '0x' + gasPrice.toString(16) } };
  }
  async function begin(kind, nonce, dataHash) {
    if (!/^0x[0-9a-f]+$/i.test(nonce)) throw new Error('nonce 必须是十六进制字符串');
    const prepared = await plan(kind);
    if (prepared.dataHash !== dataHash) throw new Error('交易参数已变化，请重新检查');
    const record = load(); record.pending = { kind, nonce, dataHash, tx: prepared.tx, amount: prepared.amount, detail: prepared.detail, status: 'awaiting-wallet', at: new Date().toISOString() }; save(record);
    return record.pending;
  }
  function attachHash(kind, hash) {
    if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('交易哈希格式不正确');
    const record = load();
    if (!record.pending || record.pending.kind !== kind) throw new Error('等待中的交易记录不符');
    record.pending.hash = hash; record.pending.status = 'pending'; save(record);
  }
  function cancelled(kind) {
    const record = load();
    if (record.pending?.kind !== kind || record.pending.hash) throw new Error('已有交易哈希，请先查询');
    record.pending = null; save(record);
  }
  async function verify(kind, hash) {
    if (!kinds.includes(kind) || !/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('迁移步骤或交易哈希无效');
    const record = load();
    if (record.actions[kind]?.hash === hash) return { verified: record.actions[kind], record, state: (await status()).state };
    if (!record.pending || record.pending.kind !== kind) throw new Error('没有对应的等待交易，请刷新链上状态');
    const [tx, receipt, blockNumber] = await Promise.all([
      client.getTransaction({ hash }), client.getTransactionReceipt({ hash }), client.getBlockNumber({ cacheTime: 0 }),
    ]);
    const expected = record.pending.tx;
    if (!same(tx.from, config.owner) || !same(tx.to, expected.to) || !same(tx.input, expected.data) || tx.value !== 0n || BigInt(record.pending.nonce) !== BigInt(tx.nonce)) throw new Error('交易目标、金额、nonce 或发送人与本页计划不符');
    if (receipt.status !== 'success') {
      record.failures.push({ kind, hash, at: new Date().toISOString() }); record.pending = null; save(record);
      return { reverted: true, error: '交易执行失败。迁移状态未推进，可以刷新后检查原因' };
    }
    if (blockNumber - receipt.blockNumber + 1n < BigInt(confirmations)) return { pending: true, message: '交易已上链，等待第二个区块确认' };
    const state = (await status()).state;
    if (!completed(kind, state)) throw new Error('链上状态尚未达到预期；等待记录已保留，请勿重发');
    const verified = { kind, hash, blockNumber: String(receipt.blockNumber), amount: record.pending.amount, verifiedAt: new Date().toISOString() };
    record.actions[kind] = verified; record.pending = null; save(record);
    return { verified, state, record };
  }
  return { config, fingerprint, kinds, labels, status, plan, begin, attachHash, cancelled, verify };
}
module.exports = { createMigrationSession, kinds, labels };
