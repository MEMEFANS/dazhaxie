/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic local checks; no RPC, wallets, or real funds. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { decodeFunctionData, encodeFunctionData, parseAbi, parseUnits, zeroAddress } = require('viem');
const { JSDOM } = require('jsdom');
const { createStage2Session } = require('./launch-stage2-session.cjs');
const owner = '0xf8ada5c5052a47dc6e28a07c8a321fb1ad257d70';
const token = '0xb38d33fc2773798f0b4007d89eb5be51249c75aa';
const pool = '0x10ec832f10ae5092d446d3413a7a2079bc30e2be';
const pair = '0xd91efc4e895ca4a1ae6d49f49cb4076add56f7c6';
const usdt = '0x55d398326f99059ff775485246999027b3197955';
const previousPool = '0x315913165c095c7f58f3fd220bccc11c3b322d22';
const lpReceiver = '0xfd420403066249b1f963ba616c7b6661008fb9df';
const claimAt = 1794103975n, tradingAt = 1794139200n;
const tokenAmount = parseUnits('70000', 18), quoteAmount = parseUnits('100', 18), reserve = parseUnits('700000000', 18);
const config = {
  chainId: 56, owner, token, pool, pair, usdt, previousPool, lpReceiver, seedTokens: '70000', seedUsdt: '100',
  claimStartsAt: String(claimAt), tradingStartsAt: String(tradingAt), claimStartsAtBeijing: '2026-11-08 10:12:55',
  tradingStartsAtBeijing: '2026-11-08 20:00',
};
let currentBlock = 500n, sent, nonce = 2n;
const fixture = {
  tokenOwner: owner, phase: 0, claimStartsAt: 0n, tradingStartsAt: 0n, liquidityEnabled: false,
  ownerTokens: parseUnits('300000000', 18), tokenAllowance: 0n,
  ownerUsdt: parseUnits('500', 18), usdtAllowance: 0n, oldSigner: pool, oldBalance: 0n,
  poolTokens: reserve, pairSupply: 0n, reserveToken: 0n, reserveUsdt: 0n,
  pairTokens: 0n, pairUsdt: 0n, lpBalance: 0n,
};
function sqrt(n) { let x = n, y = (x + 1n) / 2n; while (y < x) { x = y; y = (x + n / x) / 2n; } return x; }
const expectedLp = sqrt(tokenAmount * quoteAmount) - 1000n;
function artifact(kind) {
  if (kind === 'schedule') return { to: token, abi: parseAbi(['function scheduleLaunch(uint64 claimAt,uint64 tradingAt)']), functionName: 'scheduleLaunch', args: [claimAt, tradingAt] };
  if (kind === 'approveToken') return { to: token, abi: parseAbi(['function approve(address spender,uint256 amount) returns(bool)']), functionName: 'approve', args: [pool, tokenAmount] };
  if (kind === 'approveUsdt') return { to: usdt, abi: parseAbi(['function approve(address spender,uint256 amount) returns(bool)']), functionName: 'approve', args: [pool, quoteAmount] };
  if (kind === 'open') return { to: token, abi: parseAbi(['function openLiquidity()']), functionName: 'openLiquidity', args: [] };
  if (kind === 'seed') return { to: pool, abi: parseAbi(['function seedLiquidity(uint256 tokenAmount,uint256 usdtAmount,uint256 minLiquidity,uint256 deadline)']), functionName: 'seedLiquidity', args: [tokenAmount, quoteAmount, expectedLp * 99n / 100n, 0n] };
  throw new Error('Unexpected kind ' + kind);
}
function apply(kind) {
  if (kind === 'schedule') { fixture.claimStartsAt = claimAt; fixture.tradingStartsAt = tradingAt; }
  if (kind === 'approveToken') fixture.tokenAllowance = decodeFunctionData({ abi: artifact(kind).abi, data: sent.tx.data }).args[1];
  if (kind === 'approveUsdt') fixture.usdtAllowance = quoteAmount;
  if (kind === 'open') { fixture.liquidityEnabled = true; fixture.phase = 1; }
  if (kind === 'seed') { fixture.pairSupply = expectedLp; fixture.reserveToken = tokenAmount; fixture.reserveUsdt = quoteAmount; fixture.pairTokens = tokenAmount; fixture.pairUsdt = quoteAmount; fixture.lpBalance = expectedLp; }
}
const client = {
  async getChainId() { return 56; }, async getBlockNumber() { return currentBlock; }, async getGasPrice() { return 50_000_000n; },
  async getBalance() { return parseUnits('1', 18); }, async estimateGas() { return 90_000n; },
  async getCode() { return '0x6000'; }, async getBlock() { return { timestamp: 1793932000n }; },
  async readContract({ address, functionName, args }) {
    const a = address.toLowerCase();
    if (a === token.toLowerCase()) {
      if (functionName === 'balanceOf') return args[0].toLowerCase() === owner.toLowerCase() ? fixture.ownerTokens : fixture.pairTokens;
      return { owner: fixture.tokenOwner, launchPool: pool, tradingPair: pair, usdt, phase: fixture.phase, claimStartsAt: fixture.claimStartsAt, tradingStartsAt: fixture.tradingStartsAt, liquidityEnabled: fixture.liquidityEnabled, allowance: fixture.tokenAllowance }[functionName];
    }
    if (a === usdt.toLowerCase()) {
      if (functionName === 'balanceOf') return args[0].toLowerCase() === owner.toLowerCase() ? fixture.ownerUsdt : fixture.pairUsdt;
      return { decimals: 18, allowance: fixture.usdtAllowance }[functionName];
    }
    if (a === previousPool.toLowerCase()) return { signer: fixture.oldSigner, poolBalance: fixture.oldBalance }[functionName];
    if (a === pool.toLowerCase()) return { token, usdt, tradingPair: pair, lpReceiver, previousPool, poolBalance: fixture.poolTokens, previewSeed: [quoteAmount, expectedLp] }[functionName];
    if (a === pair.toLowerCase()) return { token0: token, token1: usdt, totalSupply: fixture.pairSupply, getReserves: [fixture.reserveToken, fixture.reserveUsdt, 0], balanceOf: fixture.lpBalance }[functionName];
    throw new Error('Unknown fixture contract ' + address);
  },
  async getTransaction({ hash }) { assert.equal(hash, sent.hash); return { from: owner, to: sent.tx.to, input: sent.tx.data, value: 0n, nonce: sent.nonce }; },
  async getTransactionReceipt() {
    return { status: 'success', blockNumber: sent.receiptBlock };
  },
};
async function main() {
  const freshClient = {
    ...client,
    async getCode(args) {
      assert(![zeroAddress, previousPool].includes(args.address.toLowerCase()), 'fresh launch must not read old or zero-address code');
      return client.getCode(args);
    },
    async readContract(args) {
      assert(![zeroAddress, previousPool].includes(args.address.toLowerCase()), 'fresh launch must not read old-pool state');
      if (args.address.toLowerCase() === pool && args.functionName === 'previousPool') return zeroAddress;
      return client.readContract(args);
    },
  };
  const fresh = createStage2Session({ client: freshClient, config: { ...config, previousPool: zeroAddress }, recordFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cabi-stage2-fresh-')), 'result.json') });
  assert.equal((await fresh.status()).state.phase, 0);
  assert.equal((await fresh.plan('schedule')).tx.to.toLowerCase(), token);
  console.log('PASS 独立新池可设置时间与准备初始加池，不读取或要求清空旧测试池');
  const funder = '0x1111111111111111111111111111111111111111';
  let assigned = zeroAddress;
  const delegatedClient = { ...freshClient, async readContract(args) {
    if (args.address.toLowerCase() === pool && args.functionName === 'seedProvider') return assigned;
    return freshClient.readContract(args);
  } };
  const delegated = createStage2Session({ client: delegatedClient, config: { ...config, previousPool: zeroAddress, seedProvider: funder }, recordFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cabi-stage2-delegated-')), 'result.json') });
  assert.deepEqual(delegated.kinds, ['provider', 'schedule', 'open']);
  const providerPlan = await delegated.plan('provider');
  assert.equal(decodeFunctionData({ abi: parseAbi(['function setSeedProvider(address)']), data: providerPlan.tx.data }).args[0].toLowerCase(), funder);
  assert.equal(providerPlan.tx.from.toLowerCase(), owner);
  assigned = funder; fixture.claimStartsAt = claimAt; fixture.tradingStartsAt = tradingAt;
  const delegatedState = await delegated.status();
  assert.equal(delegatedState.state.ownerTokenBalance, '0');
  assert.equal(delegatedState.state.ownerUsdtBalance, '0');
  assert.equal((await delegated.plan('open')).tx.from.toLowerCase(), owner);
  fixture.claimStartsAt = 0n; fixture.tradingStartsAt = 0n;
  console.log('PASS 管理员只指定出资钱包和开放时间，出资钱包尚未转入资产也可完成筹备设置');
  assert.throws(() => createStage2Session({ client, config: { ...config, claimStartsAt: null }, recordFile: 'unused.json' }), /请先设置本次领取和交易开放时间/);
  assert.throws(() => createStage2Session({ client, config: { ...config, tradingStartsAt: String(claimAt - 1n) }, recordFile: path.join(os.tmpdir(), 'cabi-stage2-invalid-time.json') }), /交易开放时间早于领取时间/);
  assert.throws(() => createStage2Session({ client, config: { ...config, tradingStartsAtBeijing: '2026-11-08 21:00' }, recordFile: path.join(os.tmpdir(), 'cabi-stage2-mismatched-time.json') }), /北京时间显示和交易时间戳不一致/);
  const recoveryFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cabi-stage2-recovery-')), 'result.json');
  const recovery = createStage2Session({ client, config: { ...config }, recordFile: recoveryFile });
  const allowanceHash = '0x' + '9'.repeat(64);
  const expectedApprove = encodeFunctionData({ abi: artifact('approveToken').abi, functionName: 'approve', args: [pool, tokenAmount] });
  const unexpectedApprove = encodeFunctionData({ abi: artifact('approveToken').abi, functionName: 'approve', args: [pool, parseUnits('300000000', 18)] });
  fs.writeFileSync(recoveryFile, JSON.stringify({ fingerprint: recovery.fingerprint, actions: {}, pending: { kind: 'approveToken', nonce: '0x14', hash: allowanceHash, tx: { to: token, data: expectedApprove, value: '0x0' } }, failures: [] }));
  fixture.claimStartsAt = claimAt; fixture.tradingStartsAt = tradingAt;
  fixture.tokenAllowance = parseUnits('300000000', 18);
  currentBlock = 900n;
  sent = { hash: allowanceHash, tx: { to: token, data: unexpectedApprove, value: 0n }, nonce: 20n, receiptBlock: 899n };
  let recovered = await recovery.status();
  assert.equal(recovered.record.pending, null);
  assert.equal(recovered.record.failures[0].actualAmount, String(parseUnits('300000000', 18)));
  assert.equal(recovered.state.tokenApproved, false);
  let revokePlan = await recovery.plan('approveToken');
  let decodedRevoke = decodeFunctionData({ abi: artifact('approveToken').abi, data: revokePlan.tx.data });
  assert.equal(decodedRevoke.args[1], 0n);
  fixture.tokenAllowance = 0n;
  recovered = await recovery.status();
  const exactPlan = await recovery.plan('approveToken');
  const decodedExact = decodeFunctionData({ abi: artifact('approveToken').abi, data: exactPlan.tx.data });
  assert.equal(decodedExact.args[1], tokenAmount);
  const revokeNonce = '0x15';
  fixture.tokenAllowance = parseUnits('300000000', 18);
  await recovery.begin('approveToken', revokeNonce, revokePlan.dataHash);
  const revokeHash = '0x' + '8'.repeat(64);
  sent = { kind: 'approveToken', hash: revokeHash, tx: revokePlan.tx, nonce: BigInt(revokeNonce), receiptBlock: 901n };
  recovery.attachHash('approveToken', revokeHash);
  fixture.tokenAllowance = 0n; currentBlock = 901n;
  assert((await recovery.verify('approveToken', revokeHash)).pending);
  currentBlock++;
  const revokeResult = await recovery.verify('approveToken', revokeHash);
  assert.equal(revokeResult.intermediate, true);
  assert.equal(revokeResult.state.tokenApproved, false);
  assert.equal(revokeResult.record.pending, null);
  assert.equal(revokeResult.record.actions.approveToken, undefined);
  assert.equal(revokeResult.record.resets[0].hash, revokeHash);
  const unlockedExactPlan = await recovery.plan('approveToken');
  assert.equal(decodeFunctionData({ abi: artifact('approveToken').abi, data: unlockedExactPlan.tx.data }).args[1], tokenAmount);
  console.log('PASS 撤销超额 CaBi 授权经两区块确认后解除待核对锁，并解锁精确授权步骤');
  console.log('PASS 超额 CaBi 授权会清除错误待处理项，并先撤销再精确授权');
  fixture.tokenAllowance = 0n; fixture.claimStartsAt = 0n; fixture.tradingStartsAt = 0n; currentBlock = 98n; sent = undefined;
  const recordFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cabi-stage2-')), 'result.json');
  const session = createStage2Session({ client, config: { ...config }, recordFile });
  let state = await session.status();
  assert.equal(state.state.phase, 0); assert.equal(state.state.poolBalance, String(reserve));
  await assert.rejects(() => session.plan('open'), /前一个步骤/);
  await assert.rejects(() => session.plan('seed'), /前一个步骤/);
  for (const [i, kind] of ['schedule', 'approveToken', 'approveUsdt', 'open', 'seed'].entries()) {
    const plan = await session.plan(kind), decoded = decodeFunctionData({ abi: artifact(kind).abi, data: plan.tx.data });
    assert.equal(plan.tx.to.toLowerCase(), artifact(kind).to.toLowerCase());
    assert.equal(decoded.functionName, artifact(kind).functionName);
    if (kind === 'schedule') assert.deepEqual(decoded.args, [claimAt, tradingAt]);
    if (kind === 'approveToken') { assert.equal(decoded.args[0].toLowerCase(), pool); assert.equal(decoded.args[1], tokenAmount); }
    if (kind === 'approveUsdt') { assert.equal(decoded.args[0].toLowerCase(), pool); assert.equal(decoded.args[1], quoteAmount); }
    if (kind === 'seed') assert.deepEqual(decoded.args.slice(0, 3), [tokenAmount, quoteAmount, expectedLp * 99n / 100n]);
    const nonceHex = '0x' + (nonce++).toString(16);
    await session.begin(kind, nonceHex, plan.dataHash);
    const hash = '0x' + (i + 1).toString(16).padStart(64, '0');
    sent = { kind, hash, tx: plan.tx, plan: artifact(kind), nonce: BigInt(nonceHex), receiptBlock: BigInt(600 + i) };
    session.attachHash(kind, hash);
    apply(kind); currentBlock = sent.receiptBlock;
    assert((await session.verify(kind, hash)).pending);
    currentBlock++;
    const result = await session.verify(kind, hash);
    assert(result.verified, kind);
    state = await session.status();
    assert.equal(state.record.pending, null);
    for (const prior of ['schedule', 'approveToken', 'approveUsdt', 'open'].slice(0, i + 1)) assert.equal(state.record.actions[prior]?.kind, prior);
  }
  assert.equal(state.state.seeded, true); assert.equal(state.state.phase, 1);
  assert.equal(state.state.reserveToken, String(tokenAmount)); assert.equal(state.state.reserveUsdt, String(quoteAmount));
  assert.equal(state.state.ownerLpBalance, String(expectedLp));
  assert.equal(state.state.claimStartsAt, String(claimAt)); assert.equal(state.state.tradingStartsAt, String(tradingAt));
  assert.equal(state.state.tokenApproved, true); assert.equal(state.state.usdtApproved, true);
  console.log('PASS 48小时领取时间、北京时间交易时间及开启组 LP 前精确双资产授权');
  console.log('PASS 70,000 新 CaBi＋100 USDT 由专用池加入并按 99% 最低 LP 输出核验');
  console.log('PASS 阶段顺序、钱包交易 nonce、两区块确认和持久化核验记录');

  const html = fs.readFileSync(path.resolve('deploy/launch-stage2-console/index.html'), 'utf8');
  const script = fs.readFileSync(path.resolve('deploy/launch-stage2-console/wallet.js'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:8791/', runScripts: 'outside-only' });
  const w = dom.window;
  const failedHash = '0x' + 'f'.repeat(64);
  const resetHash = '0x' + '8'.repeat(64);
  w.localStorage.setItem('cabi-launch-stage2:test', JSON.stringify({ kind: 'approveToken', hash: resetHash }));
  w.ethereum = { request: async ({ method }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [owner];
    if (method === 'eth_chainId') return '0x38';
    throw new Error('The browser simulation does not send live wallet transactions');
  } };
  w.fetch = async route => {
    const body = route === '/manifest.json'
      ? { ...config, kinds: ['schedule', 'approveToken', 'approveUsdt', 'open', 'seed'], labels: { schedule: '设置时间', approveToken: '授权 CaBi', approveUsdt: '授权 USDT', open: '开启组 LP', seed: '初始加池' }, fingerprint: 'test' }
      : { state: { scheduleSet: true, tokenApproved: false, usdtApproved: false, liquidityEnabled: false, seeded: false, tokenAllowance: String(parseUnits('300000000', 18)), tokenAmount: String(tokenAmount), ownerTokenBalanceFormatted: '300000000', ownerUsdtBalanceFormatted: '500', poolBalanceFormatted: '700000000', estimatedLp: String(expectedLp) }, record: { actions: { schedule: { kind: 'schedule' } }, pending: null, failures: [{ hash: failedHash }], resets: [{ hash: resetHash }] } };
    return { ok: true, json: async () => body };
  };
  w.eval(script); await w.cabiLaunchStage2Ready;
  assert.equal(w.document.getElementById('claimTime').textContent, '2026-11-08 10:12:55（北京时间）');
  assert.equal(w.document.querySelector('[data-send="schedule"]').disabled, true);
  await w.document.getElementById('connect').onclick();
  assert.equal(w.document.querySelector('[data-send="approveToken"]').disabled, false);
  assert.equal(w.document.querySelector('[data-send="approveToken"]').textContent, '撤销多余授权');
  assert.equal(w.localStorage.getItem('cabi-launch-stage2:test'), null);
  assert.equal(w.document.querySelector('[data-send="seed"]').disabled, true);
  console.log('PASS 本机页面显示已核对开放时间，未连接管理员钱包时禁止交易');
  dom.window.close();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
