/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic local checks; no wallets, RPC, or real funds. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { decodeFunctionData, encodeFunctionData, keccak256, parseUnits, zeroAddress } = require('viem');
const { JSDOM } = require('jsdom');
const { createMigrationSession } = require('./launch-migration-session.cjs');
const owner = '0xf8ada5c5052a47dc6e28a07c8a321fb1ad257d70';
const previousToken = '0xeccbfbb6708ff051e91a2113e4ac4e19b86e26dd';
const previousPool = '0x315913165c095c7f58f3fd220bccc11c3b322d22';
const previousSigner = '0xaa43f3d7c8a008180bbd478b2591cba4356fa82b';
const token = '0xb38d33fc2773798f0b4007d89eb5be51249c75aa';
const pool = '0x10ec832f10ae5092d446d3413a7a2079bc30e2be';
const pair = '0xd91efc4e895ca4a1ae6d49f49cb4076add56f7c6';
const usdt = '0x55d398326f99059ff775485246999027b3197955';
const lpReceiver = '0xfd420403066249b1f963ba616c7b6661008fb9df';
const signer = previousSigner;
const config = { chainId: 56, owner, previousToken, previousPool, previousSigner, token, pool, pair, usdt, signer, lpReceiver, newPoolReserve: '700000000' };
const amounts = { previous: parseUnits('700000000', 18), owner: parseUnits('1000000000', 18), pool: 0n };
const old = { signer: previousSigner, claimed: 0n, unused: amounts.previous };
let nextNonce = 2n;
let currentBlock = 98n;
let sent;
const client = {
  async getChainId() { return 56; },
  async getBlockNumber() { return currentBlock; },
  async getCode() { return '0x6000'; },
  async getGasPrice() { return 50_000_000n; },
  async getBalance() { return parseUnits('1', 18); },
  async estimateGas() { return 90_000n; },
  async getTransaction({ hash }) { assert.equal(hash, sent.hash); return { from: owner, to: sent.tx.to, input: sent.tx.data, value: 0n, nonce: sent.nonce }; },
  async getTransactionReceipt() { return { status: 'success', blockNumber: 99n }; },
  async readContract({ address, functionName, args }) {
    const addr = address.toLowerCase();
    const oldAddress = previousPool.toLowerCase(), tokenAddress = token.toLowerCase(), poolAddress = pool.toLowerCase();
    if (addr === oldAddress) return ({ token: previousToken, owner, signer: old.signer, totalClaimed: old.claimed, poolBalance: amounts.previous, unusedBalance: old.unused })[functionName];
    if (addr === tokenAddress) {
      if (functionName === 'balanceOf') return args[0].toLowerCase() === owner.toLowerCase() ? amounts.owner : 0n;
      return ({ owner, tradingPair: pair, usdt, launchPool: pool, phase: 0, liquidityEnabled: false })[functionName];
    }
    if (addr === poolAddress) return ({ token, usdt, tradingPair: pair, lpReceiver, previousPool, signer, poolBalance: amounts.pool })[functionName];
    assert.equal(addr, zeroAddress);
    return undefined;
  },
};
async function main() {
  const recordFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cabi-migration-')), 'result.json');
  const session = createMigrationSession({ client, config: { ...config }, recordFile });
  const initial = await session.status();
  assert.equal(initial.state.previousBalanceFormatted, '700000000');
  assert.equal(initial.state.poolBalanceFormatted, '0');
  await assert.rejects(() => session.plan('fund'), /前一笔迁移交易/);
  let plan = await session.plan('retire');
  let call = decodeFunctionData({ abi: [ { type: 'function', name: 'setSigner', stateMutability: 'nonpayable', inputs: [{ type: 'address', name: 'newSigner' }], outputs: [] } ], data: plan.tx.data });
  assert.equal(plan.tx.to.toLowerCase(), previousPool.toLowerCase());
  assert.equal(call.args[0].toLowerCase(), pool.toLowerCase());
  await session.begin('retire', '0x2', plan.dataHash); session.cancelled('retire');
  assert.equal((await session.status()).record.pending, null);
  plan = await session.plan('retire');
  await session.begin('retire', '0x2', plan.dataHash);
  sent = { hash: '0x' + '1'.repeat(64), tx: plan.tx, nonce: nextNonce++ };
  session.attachHash('retire', sent.hash);
  assert((await session.verify('retire', sent.hash)).pending);
  currentBlock = 100n; old.signer = pool;
  assert((await session.verify('retire', sent.hash)).verified);
  assert.equal((await session.status()).state.retired, true);

  plan = await session.plan('withdraw');
  call = decodeFunctionData({ abi: [{ type: 'function', name: 'withdrawUnused', stateMutability: 'nonpayable', inputs: [{ type: 'uint256', name: 'amount' }], outputs: [] }], data: plan.tx.data });
  assert.equal(call.args[0], amounts.previous);
  await session.begin('withdraw', '0x3', plan.dataHash);
  sent = { hash: '0x' + '2'.repeat(64), tx: plan.tx, nonce: nextNonce++ };
  session.attachHash('withdraw', sent.hash);
  amounts.previous = 0n; old.unused = 0n;
  const withdrawal = session.verify('withdraw', sent.hash);
  assert((await withdrawal).verified);

  plan = await session.plan('fund');
  call = decodeFunctionData({ abi: [ { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ type: 'address', name: 'to' }, { type: 'uint256', name: 'amount' }], outputs: [{ type: 'bool' }] } ], data: plan.tx.data });
  assert.equal(call.args[0].toLowerCase(), pool.toLowerCase());
  assert.equal(call.args[1], parseUnits('700000000', 18));
  await session.begin('fund', '0x4', plan.dataHash);
  sent = { hash: '0x' + '3'.repeat(64), tx: plan.tx, nonce: nextNonce++ };
  session.attachHash('fund', sent.hash);
  amounts.pool = parseUnits('700000000', 18); amounts.owner -= amounts.pool;
  const funding = session.verify('fund', sent.hash);
  assert((await funding).verified);
  const final = await session.status();
  assert.equal(final.state.funded, true);
  assert.deepEqual(Object.keys(final.record.actions), ['retire', 'withdraw', 'fund']);
  console.log('PASS 旧池地址、签名迁移顺序、7亿旧币回收及7亿新币储备核对');
  console.log('PASS 等待状态恢复、nonce与calldata匹配、两区块确认和重复操作拦截');

  const html = fs.readFileSync(path.resolve('deploy/launch-console/migration.html'), 'utf8');
  const script = fs.readFileSync(path.resolve('deploy/launch-console/migration-wallet.js'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:8790/', runScripts: 'outside-only' });
  const w = dom.window, sentKinds = [];
  let browserState = { retired: false, oldPoolEmpty: false, funded: false };
  let browserRecord = { actions: {}, pending: null };
  let browserPending, browserNonce = 2, rejectOnce = true, cancelled = false, sendRequests = 0;
  const browserTx = kind => {
    const item = kind === 'retire'
      ? { to: previousPool, abi: [{ type: 'function', name: 'setSigner', stateMutability: 'nonpayable', inputs: [{ type: 'address', name: 'newSigner' }], outputs: [] }], functionName: 'setSigner', args: [pool] }
      : kind === 'withdraw'
        ? { to: previousPool, abi: [{ type: 'function', name: 'withdrawUnused', stateMutability: 'nonpayable', inputs: [{ type: 'uint256', name: 'amount' }], outputs: [] }], functionName: 'withdrawUnused', args: [parseUnits('700000000', 18)] }
        : { to: token, abi: [{ type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ type: 'address', name: 'to' }, { type: 'uint256', name: 'amount' }], outputs: [{ type: 'bool' }] }], functionName: 'transfer', args: [pool, parseUnits('700000000', 18)] };
    return { ...item, data: encodeFunctionData(item) };
  };
  const browserManifest = { ...config, kinds: ['retire', 'withdraw', 'fund'], labels: { retire: '停用旧领取池签名', withdraw: '取回旧池代币', fund: '给新池注入新代币储备' }, fingerprint: 'synthetic-migration' };
  w.ethereum = { request: async ({ method, params }) => {
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [owner];
    if (method === 'eth_chainId') return '0x38';
    if (method === 'eth_getTransactionCount') return browserNonce;
    assert.equal(method, 'eth_sendTransaction');
    sendRequests++;
    if (rejectOnce) { rejectOnce = false; throw Object.assign(new Error('User rejected request'), { code: 4001 }); }
    const plan = browserTx(sentKinds.at(-1));
    const tx = params[0];
    assert.equal(tx.to.toLowerCase(), plan.to.toLowerCase());
    assert.equal(tx.data, plan.data);
    assert.equal(typeof tx.nonce, 'string'); assert.equal(tx.nonce, '0x' + browserNonce.toString(16)); browserNonce++;
    sentKinds.push(sentKinds.at(-1));
    return '0x' + 'a'.repeat(64);
  } };
  w.fetch = async (route, options) => {
    if (route === '/manifest.json') return { ok: true, json: async () => browserManifest };
    if (route === '/api/state') return { ok: true, json: async () => ({ state: { ...browserState, previousBalanceFormatted: browserState.oldPoolEmpty ? '0' : '700000000', poolBalanceFormatted: browserState.funded ? '700000000' : '0', targetReserveFormatted: '700000000', ownerTokenBalanceFormatted: browserState.funded ? '300000000' : '1000000000' }, record: browserRecord }) };
    const body = options?.body ? JSON.parse(options.body) : {};
    if (route.startsWith('/api/plan?kind=')) {
      const kind = route.split('=').at(-1), plan = browserTx(kind);
      return { ok: true, json: async () => ({ kind, label: browserManifest.labels[kind], detail: kind, dataHash: keccak256(plan.data), estimatedFeeBnb: '0.001', maxFeeBnb: '0.0012', tx: { from: owner, to: plan.to, data: plan.data, value: '0x0', chainId: '0x38', gas: '0x10000', gasPrice: '0x2' } }) };
    }
    if (route === '/api/begin') { browserPending = { ...body, tx: browserTx(body.kind), status: 'awaiting-wallet' }; return { ok: true, json: async () => ({ pending: browserPending }) }; }
    if (route === '/api/cancel') { assert.equal(browserPending?.kind, body.kind); browserPending = null; browserRecord.pending = null; cancelled = true; return { ok: true, json: async () => ({ cleared: true }) }; }
    if (route === '/api/hash') { browserPending.hash = body.hash; browserRecord.pending = browserPending; return { ok: true, json: async () => ({ saved: true }) }; }
    if (route === '/api/verify') {
      const kind = body.kind; browserState = { ...browserState, ...(kind === 'retire' ? { retired: true } : kind === 'withdraw' ? { oldPoolEmpty: true } : { funded: true }) };
      browserRecord.actions[kind] = { hash: body.hash }; browserRecord.pending = browserPending = null;
      return { ok: true, json: async () => ({ verified: browserRecord.actions[kind], state: browserState, record: browserRecord }) };
    }
    throw new Error('Unexpected migration UI request: ' + route);
  };
  w.eval(script); await w.cabiMigrationReady;
  await w.document.getElementById('connect').onclick();
  for (const kind of browserManifest.kinds) {
    const button = w.document.querySelector(`[data-send="${kind}"]`);
    assert.equal(button.disabled, false, kind + ' is available in order');
    sentKinds.push(kind);
    if (kind === 'retire') {
      await button.onclick();
      assert.equal(cancelled, true);
      assert.equal(browserPending, null);
      assert.equal(button.disabled, false, 'a wallet rejection leaves the step retryable');
      await button.onclick();
    } else await button.onclick();
    assert.equal(button.disabled, true, kind + ' is completed once');
  }
  assert.deepEqual(Object.keys(browserRecord.actions), ['retire', 'withdraw', 'fund']);
  assert.equal(sendRequests, 4);
  assert.equal(sentKinds.filter((kind, index) => index === 0 || sentKinds[index - 1] !== kind).length, 3);
  console.log('PASS 浏览器仅按顺序请求管理员钱包签名，三笔逐一核验且无需暴露私钥');
  dom.window.close();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
