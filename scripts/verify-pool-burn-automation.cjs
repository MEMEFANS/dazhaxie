/* eslint-disable @typescript-eslint/no-require-imports -- Offline tests with real SQLite/encryption/signing and mocked RPC. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomBytes } = require('node:crypto');
const { generatePrivateKey, privateKeyToAccount } = require('viem/accounts');
const { parseEther, parseGwei, parseTransaction, encodeEventTopics, encodeAbiParameters } = require('viem');
const { abi, openStore, status, saveConfiguration, setEnabled, tick } = require('../src/lib/server/pool-burn-automation.cjs');

const context = { chainId: 56, token: '0x1111111111111111111111111111111111111111', quote: '0x2222222222222222222222222222222222222222', rpcUrls: [] };
const pair = '0x3333333333333333333333333333333333333333';
const env = { ADMIN_SESSION_SECRET: randomBytes(32).toString('hex') }, key = generatePrivateKey(), account = privateKeyToAccount(key);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cabi-burn-test-'));
const stores = [];
let tests = 0;
function fixture() {
  const directory = path.join(root, String(stores.length)), store = openStore(directory); stores.push(store);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const state = { due: true, balance: parseEther('0.003'), gasPrice: parseGwei('0.1'), nonce: 2, latestNonce: 2, chainId: 56,
    next: now - 1n, last: now - 28801n, total: 0n, receipt: null, sent: [], simulationError: false, timeout: false };
  const client = {
    getChainId: async () => state.chainId,
    getBlockNumber: async () => 100n,
    getBlock: async ({ blockNumber }) => ({ timestamp: now, hash: '0x' + 'a'.repeat(64), number: blockNumber }),
    readContract: async ({ functionName }) => ({ POOL_BURN_INTERVAL: 28800n, POOL_BURN_BPS: 100n, tradingPair: pair, usdt: context.quote, nextPoolBurnTime: state.next,
      lastPoolBurnTime: state.last, totalPoolBurned: state.total, previewPoolBurn: [10n ** 18n, state.next, state.due] })[functionName],
    getBalance: async () => state.balance,
    getGasPrice: async () => state.gasPrice,
    getTransactionCount: async ({ blockTag }) => blockTag === 'pending' ? state.nonce : state.latestNonce,
    simulateContract: async request => { assert.equal(request.functionName, 'burnPool'); if (state.simulationError) throw new Error('reverted'); },
    estimateContractGas: async () => 100000n,
    getTransactionReceipt: async () => { if (state.receipt) return state.receipt; const e = new Error('missing'); e.name = 'TransactionReceiptNotFoundError'; throw e; },
    sendRawTransaction: async ({ serializedTransaction }) => {
      const pending = store.pending(); assert(pending, 'signed intent must be durably saved before broadcast');
      const tx = parseTransaction(serializedTransaction); assert.equal(tx.chainId, 56); assert.equal(tx.to.toLowerCase(), context.token.toLowerCase()); assert.equal(tx.value || 0n, 0n); assert.equal(tx.nonce, 2);
      state.sent.push(serializedTransaction);
      if (state.timeout) throw new Error('RPC request timed out with sensitive request material');
      return pending.hash;
    },
    getTransaction: async () => {
      const tx = parseTransaction(state.sent[0]);
      return { from: account.address, to: tx.to, input: tx.data, value: tx.value || 0n, nonce: tx.nonce };
    },
  };
  const save = () => saveConfiguration(store, context, { privateKey: key, maxGasGwei: '1', revision: store.config()?.revision || 0 }, 'qa', env);
  const run = () => tick(store, context, env, client);
  const enable = () => setEnabled(store, context, true, store.config().revision, 'qa', env, client);
  const pause = () => setEnabled(store, context, false, store.config().revision, 'qa', env, client);
  async function ready() { save(); await run(); await enable(); }
  function receipt(result = 'success') {
    state.receipt = { transactionHash: store.pending().hash, blockNumber: 99n, blockHash: '0x' + 'a'.repeat(64), status: result,
      logs: result !== 'success' ? [] : [{ address: context.token, topics: encodeEventTopics({ abi, eventName: 'PoolBurned', args: { pair } }),
        data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [10n ** 18n, 100n * 10n ** 18n, now]) }] };
  }
  return { directory, store, state, client, save, run, enable, pause, ready, receipt };
}
async function test(name, fn) { await fn(); tests++; console.log('PASS ' + name); }
async function main() {
  await test('default is unconfigured and never signs or sends a transaction', async () => {
    const f = fixture(); await f.run(); assert.equal(status(f.store, context).config, null); assert.equal(f.state.sent.length, 0); assert.equal(f.store.worker().status, 'unconfigured');
  });
  await test('wallet encrypted at rest, redacted from responses/audit, saves paused; stale revisions rejected', async () => {
    const f = fixture(); f.save(); const raw = JSON.stringify(f.store.config()); assert(!raw.includes(key)); assert(!JSON.stringify(status(f.store, context)).includes('encrypted')); assert.equal(f.store.config().enabled, false);
    assert(!JSON.stringify(f.store.db.prepare('SELECT * FROM audit').all()).includes(key));
    assert.throws(() => saveConfiguration(f.store, context, { privateKey: key, maxGasGwei: '1', revision: 0 }, 'qa', env), /已更新/);
    await f.run(); assert.equal(f.state.sent.length, 0); assert.equal(status(f.store, context).config.address, account.address);
  });
  await test('invalid keys, zero/excessive gas ceilings and stale worker cannot enable', async () => {
    const f = fixture();
    for (const privateKey of ['bad', '0x' + '0'.repeat(64)]) assert.throws(() => saveConfiguration(f.store, context, { privateKey, maxGasGwei: '1', revision: 0 }, 'qa', env));
    for (const maxGasGwei of ['0', '5.01', '100', '-1', 'NaN']) assert.throws(() => saveConfiguration(f.store, context, { privateKey: key, maxGasGwei, revision: 0 }, 'qa', env));
    f.save(); await assert.rejects(f.enable(), /定时服务/); await f.run(); f.state.balance = 0n; await assert.rejects(f.enable(), /BNB/);
  });
  await test('different encryption key and context prevent reuse; replacing contracts pauses automation', async () => {
    const f = fixture(); await f.ready();
    await assert.rejects(setEnabled(f.store, context, true, f.store.config().revision, 'qa', { ADMIN_SESSION_SECRET: 'different'.repeat(8) }, f.client), /解密/);
    await tick(f.store, { ...context, token: pair }, env, f.client); assert.equal(f.state.sent.length, 0); assert.equal(f.store.config().enabled, false);
  });
  await test('not due, low balance, high gas, failed simulation, wrong network and busy wallet never broadcast', async () => {
    for (const patch of [{ due: false }, { balance: 0n }, { gasPrice: parseGwei('2') }, { simulationError: true }, { chainId: 97 }, { nonce: 3 }]) {
      const f = fixture(); await f.ready(); Object.assign(f.state, patch); await f.run(); assert.equal(f.state.sent.length, 0, JSON.stringify(patch, (_, v) => typeof v === 'bigint' ? String(v) : v));
    }
  });
  await test('lease prevents concurrent runners, and pause/config revision during simulation prevents signing intent', async () => {
    const f = fixture(); await f.ready(); const lease = f.store.lease(); await f.run(); assert.equal(f.state.sent.length, 0); f.store.release(lease);
    f.client.simulateContract = async () => f.pause(); await f.run(); assert.equal(f.state.sent.length, 0); assert.equal(f.store.pending(), null);
  });
  await test('durable signed hash survives timeout/restart; only identical transaction bytes are retried', async () => {
    const f = fixture(); await f.ready(); f.state.timeout = true; await f.run();
    const hash = f.store.pending().hash; assert.equal(f.state.sent.length, 1); assert(!JSON.stringify(status(f.store, context)).includes('encryptedRaw'));
    assert(!JSON.stringify(status(f.store, context)).includes('sensitive request material'));
    await f.pause(); f.state.timeout = false;
    const reopened = openStore(f.directory);
    try { await tick(reopened, context, env, f.client); } finally { reopened.close(); }
    assert.equal(f.state.sent.length, 2); assert.equal(f.state.sent[0], f.state.sent[1]); assert.equal(f.store.pending().hash, hash);
    assert.throws(f.save, /等待核对/); f.receipt(); await f.run(); assert.equal(f.store.pending(), null); assert.equal(status(f.store, context).history[0].status, 'confirmed');
    assert.equal(status(f.store, context).history[0].amount, (10n ** 18n).toString()); await f.run(); assert.equal(f.state.sent.length, 2);
  });
  await test('reverted or invalid receipts pause automatically; stolen nonce remains unresolved and cannot be resent', async () => {
    for (const kind of ['reverted', 'invalid', 'nonce']) {
      const f = fixture(); await f.ready(); await f.run();
      if (kind === 'nonce') f.state.latestNonce = 3;
      else { f.receipt(kind === 'reverted' ? 'reverted' : 'success'); if (kind === 'invalid') f.state.receipt.logs = []; }
      await f.run(); assert.equal(f.store.config().enabled, false); assert.equal(f.state.sent.length, 1);
      if (kind === 'nonce') assert(f.store.pending()); else assert.equal(status(f.store, context).history[0].status, kind);
    }
  });
  await test('two confirmations and canonical receipt block required before recording success', async () => {
    const f = fixture(); await f.ready(); await f.run(); f.receipt(); f.state.receipt.blockNumber = 100n; await f.run(); assert(f.store.pending());
    f.state.receipt.blockNumber = 99n; f.state.receipt.blockHash = '0x' + 'b'.repeat(64); await f.run(); assert(f.store.pending());
    f.state.receipt.blockHash = '0x' + 'a'.repeat(64); await f.run(); assert.equal(f.store.pending(), null);
  });
  console.log(tests + ' automation checks passed; no network or real funds used.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { stores.forEach(store => store.close()); fs.rmSync(root, { recursive: true, force: true }); });
