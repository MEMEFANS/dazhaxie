/* eslint-disable @typescript-eslint/no-require-imports -- Isolated server-side verification. */
// 使用临时 SQLite 与合成链上数据，不读取 .env、私钥、公共 RPC，不发起真实交易。
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const viem = require('viem');
const ROOT = path.resolve(__dirname, '..');
const A = '0x1111111111111111111111111111111111111111', B = '0x2222222222222222222222222222222222222222';
const C = '0x3333333333333333333333333333333333333333', R = '0x4444444444444444444444444444444444444444';
const D = '0x5555555555555555555555555555555555555555', USDT = '0x6666666666666666666666666666666666666666';
const TOKEN = '0x7777777777777777777777777777777777777777', POOL = '0x8888888888888888888888888888888888888888';
const PAYEE = '0x9999999999999999999999999999999999999999';
const unit = 10n ** 18n, hash = n => '0x' + n.toString(16).padStart(64, '0');
const results = [];
function pass(name) { results.push(name); console.log('PASS ' + name); }
function load(file, replacements = {}) {
  const filename = path.join(ROOT, file), runtimeModule = { exports: {} };
  const javascript = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  vm.runInNewContext(javascript, { module: runtimeModule, exports: runtimeModule.exports, require: name => Object.hasOwn(replacements, name) ? replacements[name] : require(name), console, process, setTimeout, clearTimeout, URL, Date, globalThis: globalThis }, { filename });
  return runtimeModule.exports;
}
class AdminRequestError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'AdminRequestError'; this.status = status; }
}
function assertStatus(fn, status, name) {
  return assert.rejects(fn, error => {
    assert(error instanceof Error, name + ' should throw');
    assert.equal(error.status, status, name + ' status');
    return true;
  });
}

// 临时数据库目录，运行结束后删除。
const dataDir = path.join(os.tmpdir(), 'cabi-subscription-test-' + process.pid + '-' + Date.now());
fs.mkdirSync(dataDir, { recursive: true });

const constants = load('src/lib/constants.ts');
const teamTree = load('src/lib/team-tree.ts', { './constants.ts': constants });
const merkle = load('src/lib/merkle.ts');
const referralRows = [
  { address: R, parent: null }, { address: A, parent: R }, { address: B, parent: R }, { address: C, parent: A },
];
const dbModule = load('src/lib/server/subscription-db.ts', {
  'server-only': {},
  '../constants': constants,
  '../team-tree': teamTree,
  '../merkle': merkle,
  './redemption-db': {
    encryptShipping: value => JSON.stringify(value),
    decryptShipping: value => JSON.parse(value),
  },
  '../chain-config': { chainConfig: { id: 56 } },
  './admin-db': { adminDataDirectory: () => dataDir },
  './admin-session': { AdminRequestError },
  './referral-db': { referralTreeRows: () => referralRows },
});

// 合成链上客户端：所有返回值由 chainState 控制。
const chainState = {
  chainId: 56, blockNumber: 102n, receipt: null, transaction: null, multicall: [],
};
const chainClient = {
  getChainId: async () => chainState.chainId,
  getBlockNumber: async () => chainState.blockNumber,
  getTransactionReceipt: async () => { if (!chainState.receipt) throw new Error('not found'); return chainState.receipt; },
  getTransaction: async () => chainState.transaction,
  readContract: async request => {
    if (request.functionName === 'decimals') return 6;
    throw new Error('unexpected read ' + request.functionName);
  },
  multicall: async request => chainState.multicall.slice(0, request.contracts.length),
};
const settings = { subscribePayee: PAYEE, subscribeLocked: false };
const chainModule = load('src/lib/server/subscription-chain.ts', {
  'server-only': {},
  '../chain-config': {
    appChain: { id: 56 }, chainConfig: { id: 56, rpcUrls: ['http://isolated.fixture'] }, chainConfigurationValid: true,
    contracts: { usdt: USDT, token: TOKEN, claimPool: POOL },
  },
  '../constants': constants,
  './admin-db': { readOperationalSettings: () => ({ ...settings }), normalizePayee: value => value },
  './admin-session': { AdminRequestError },
  './subscription-db': dbModule,
  viem: { ...viem, createPublicClient: () => chainClient },
});

function order(address, shares, index) {
  return dbModule.createSubscriptionOrder({
    address,
    shares,
    amount: BigInt(shares) * 50n * 10n ** 6n,
    txHash: hash(index),
    shipping: { name: '测试用户', phone: '13800138000', address: '测试省测试市测试路 1 号' },
  });
}

(async () => {
  try {
    // ---------------------------------------------------------- 认购单记账
    const first = order(A, 2, 1);
    assert.equal(first.shares, 2);
    assert.equal(dbModule.globalSold(), 2);
    assert.equal(dbModule.purchasedOf(A), 2);
    assert.equal(dbModule.purchasedOf(B), 0);
    await assertStatus(async () => order(A, 2, 1), 409, 'same hash');
    assert.equal(dbModule.globalSold(), 2, 'duplicate hash must not be recorded');
    assert(dbModule.subscriptionOrderByHash(hash(1)));
    order(B, 1, 2); order(C, 2, 3); order(C, 1, 4);
    assert.equal(dbModule.globalSold(), 6);
    assert.equal(dbModule.purchasedOf(C), 3);
    const list = dbModule.listAddressSubscriptions(C);
    assert.equal(list.length, 2);
    const searched = dbModule.searchSubscriptions({ q: A.slice(0, 10), page: 1, pageSize: 2 });
    assert.equal(searched.items.length, 1);
    assert.equal(searched.total, 1);
    assert.equal(searched.globalSold, 6);
    pass('subscription orders persist, aggregate globalSold/purchased and reject duplicate transaction hashes');

    // ---------------------------------------------------------- 销售价格档位
    assert.equal(constants.subscriptionUnitPrice(0), 50);
    assert.equal(constants.subscriptionUnitPrice(4999), 50);
    assert.equal(constants.subscriptionUnitPrice(5000), 55);
    assert.equal(constants.subscriptionUnitPrice(9999), 55);
    assert.equal(constants.subscriptionUnitPrice(10000), 60);
    assert.equal(constants.subscriptionUnitPrice(14999), 60);
    assert.equal(constants.subscriptionUnitPrice(15000), 70);
    assert.equal(constants.subscriptionUnitPrice(19999), 70);
    pass('subscription price tiers switch at 5000, 10000 and 15000 sold shares');

    // ---------------------------------------------------------- 奖励与批次
    const targets = dbModule.computeClaimTargets();
    const byAddress = new Map(targets.map(item => [item.address.toLowerCase(), item]));
    assert.equal(byAddress.get(C).shares, 3);
    assert.equal(byAddress.get(A).shares, 3); // 本人 2 + 直推每 3 份 1 份
    assert.equal(byAddress.get(B).shares, 1);
    assert.equal(byAddress.get(R).shares, 1); // 直推 3 份 = 1 份；无极差
    assert.equal(byAddress.get(A).tokens, 3n * 35000n * unit);
    assert.equal(byAddress.get(A).reason.length, 3);
    const created = dbModule.createClaimRootBatch({ note: 'first' });
    assert.equal(created.items.length, 4);
    assert.equal(created.total, 8n * 35000n * unit);
    const itemA = created.items.find(item => item.address.toLowerCase() === A.toLowerCase());
    assert(itemA, 'Merkle batch contains the subscriber entitlement');
    assert(merkle.verifyMerkleProof(itemA.proof, created.root, merkle.claimLeaf(BigInt(created.epoch), itemA.address, BigInt(itemA.amount))));
    pass('claim targets are derived from orders + every-three-share direct reward + team differential');
    assert.equal(created.batch.status, 'pending');
    assert.equal(created.batch.addresses, 4);
    assert.equal(dbModule.listClaimRootItems(created.batch.id).length, 4);
    pass('Merkle root batch persists cumulative allocations and valid per-address proofs');

    await assertStatus(async () => dbModule.markClaimRootBatch(created.batch.id, 'applied', '0x1234'), 400, 'bad hash');
    const applied = dbModule.markClaimRootBatch(created.batch.id, 'applied', hash(9));
    assert.equal(applied.status, 'applied');
    assert.equal(applied.txHash, hash(9));
    const replay = dbModule.markClaimRootBatch(created.batch.id, 'applied', hash(10));
    assert.equal(replay.status, 'applied');
    assert.equal(replay.txHash, hash(9), 're-applying must be idempotent');
    assert.equal(dbModule.nextClaimRootEpoch(), 2);
    pass('root publication registration requires a valid transaction hash and repeated application is idempotent');

    // 新认购 D 后生成下一版累计额度 root；失败批次可重新登记。
    referralRows.push({ address: D, parent: R });
    order(D, 2, 5);
    const nextRoot = dbModule.createClaimRootBatch();
    assert.equal(nextRoot.epoch, 2);
    assert.equal(nextRoot.items.length, 5);
    assert.equal(nextRoot.items.find(item => item.address.toLowerCase() === D.toLowerCase()).amount, (2n * 35000n * unit).toString());
    const retry = dbModule.createClaimRootBatch({ skipClaimed: new Set([D.toLowerCase()]) });
    dbModule.markClaimRootBatch(retry.batch.id, 'failed');
    const pendingD = dbModule.createClaimRootBatch();
    assert.equal(pendingD.batch.status, 'pending');
    assert.equal(pendingD.epoch, 4);
    await assertStatus(async () => dbModule.createClaimRootBatch({ skipClaimed: new Set([A.toLowerCase(), B.toLowerCase(), C.toLowerCase(), D.toLowerCase(), R.toLowerCase()]) }), 409, 'all recipients skipped');
    pass('new orders enter a fresh cumulative epoch, proofs can omit claimed wallets, and failed batches can be retried');

    // 硬顶在同一个写事务内复核。
    dbModule.subscriptionDatabase().prepare('INSERT INTO subscription_orders (id, chain_id, address, shares, amount, tx_hash, status, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('seed-hard-cap', 56, B, 19999, '0', hash(6), 'confirmed', Date.now());
    assert.equal(dbModule.globalSold(), 20007);
    await assertStatus(async () => order(D, 1, 7), 409, 'hard cap');
    assert.equal(dbModule.globalSold(), 20007);
    dbModule.subscriptionDatabase().prepare("DELETE FROM subscription_orders WHERE id='seed-hard-cap'").run();
    assert.equal(dbModule.globalSold(), 8);
    pass('hard cap 20000 is enforced inside the write transaction and over-cap orders are rejected');

    // ------------------------------------------------------------- 核验
    const config = await chainModule.readSubscribeConfig(A);
    assert.equal(config.configured, true);
    assert.equal(config.enabled, true);
    assert.equal(config.payee.toLowerCase(), PAYEE);
    assert.equal(config.unitPrice, 50);
    assert.equal(config.tokensPerShare, 35000);
    assert.equal(config.minShares, 1);
    assert.equal(config.maxShares, 2);
    assert.equal(config.hardCap, 20000);
    assert.equal(config.softCap, 10000);
    assert.equal(config.purchased, 2);
    assert.equal(config.usdtDecimals, 6);
    assert.equal(await chainModule.assertSharesAllowed(2), 2);
    for (const bad of [0, 3, 1.5, '2']) await assertStatus(async () => chainModule.assertSharesAllowed(bad), 400, 'shares ' + bad);
    settings.subscribeLocked = true;
    const locked = await chainModule.readSubscribeConfig(A);
    assert.equal(locked.enabled, false);
    assert.equal(locked.locked, true);
    settings.subscribeLocked = false;
    pass('subscribe config exposes 50 USDT/share, 1-2 shares, 20000 hard cap, 10000 soft cap and lock state');

    const transferData = viem.encodeFunctionData({ abi: viem.erc20Abi, functionName: 'transfer', args: [PAYEE, 100n * 10n ** 6n] });
    function transferLog(from, to, value) {
      return {
        address: USDT,
        topics: viem.encodeEventTopics({ abi: viem.erc20Abi, eventName: 'Transfer', args: { from, to } }),
        data: viem.encodeAbiParameters([{ type: 'uint256' }], [value]),
      };
    }
    function liveTransfer(overrides = {}) {
      chainState.blockNumber = 102n;
      chainState.receipt = { status: 'success', blockNumber: 100n, logs: [transferLog(overrides.logFrom || A, overrides.logTo || PAYEE, overrides.logValue ?? 100n * 10n ** 6n)] };
      chainState.transaction = { from: overrides.from || A, to: overrides.to || USDT, value: 0n, input: overrides.data || transferData };
    }
    liveTransfer();
    assert.equal(await chainModule.verifySubscriptionTransfer({ address: A, hash: hash(11), shares: 2 }), 100n * 10n ** 6n);
    liveTransfer({ from: B }); await assertStatus(() => chainModule.verifySubscriptionTransfer({ address: A, hash: hash(11), shares: 2 }), 400, 'wrong from');
    liveTransfer({ to: PAYEE }); await assertStatus(() => chainModule.verifySubscriptionTransfer({ address: A, hash: hash(11), shares: 2 }), 400, 'wrong to');
    liveTransfer({ data: viem.encodeFunctionData({ abi: viem.erc20Abi, functionName: 'transfer', args: [PAYEE, 50n * 10n ** 6n] }) });
    await assertStatus(() => chainModule.verifySubscriptionTransfer({ address: A, hash: hash(11), shares: 2 }), 400, 'wrong amount');
    liveTransfer({ logTo: B }); await assertStatus(() => chainModule.verifySubscriptionTransfer({ address: A, hash: hash(11), shares: 2 }), 400, 'wrong event');
    liveTransfer({ logValue: 50n * 10n ** 6n }); await assertStatus(() => chainModule.verifySubscriptionTransfer({ address: A, hash: hash(11), shares: 2 }), 400, 'wrong event value');
    liveTransfer(); chainState.blockNumber = 100n;
    await assertStatus(() => chainModule.verifySubscriptionTransfer({ address: A, hash: hash(11), shares: 2 }), 202, 'confirmations');
    chainState.blockNumber = 102n; chainState.receipt = { status: 'reverted', blockNumber: 100n, logs: [] };
    await assertStatus(() => chainModule.verifySubscriptionTransfer({ address: A, hash: hash(11), shares: 2 }), 409, 'reverted');
    chainState.receipt = null;
    await assertStatus(() => chainModule.verifySubscriptionTransfer({ address: A, hash: hash(11), shares: 2 }), 202, 'pending');
    liveTransfer();
    await assertStatus(() => chainModule.verifySubscriptionTransfer({ address: A, hash: '0x12', shares: 2 }), 400, 'bad hash');
    settings.subscribeLocked = true;
    await assertStatus(() => chainModule.verifySubscriptionTransfer({ address: A, hash: hash(11), shares: 2 }), 403, 'locked');
    settings.subscribeLocked = false; settings.subscribePayee = '';
    await assertStatus(() => chainModule.verifySubscriptionTransfer({ address: A, hash: hash(11), shares: 2 }), 503, 'no payee');
    settings.subscribePayee = PAYEE;
    pass('USDT transfer verification requires success, 2 confirmations, from/to/amount and a matching Transfer event');

    const persistedItem = dbModule.claimRootItem(pendingD.batch.id, D);
    assert(persistedItem);
    assert(merkle.verifyMerkleProof(persistedItem.proof, pendingD.root, merkle.claimLeaf(BigInt(pendingD.epoch), D, BigInt(persistedItem.amount))));
    assert.equal(dbModule.claimRootBatchByRoot(pendingD.root, pendingD.epoch).id, pendingD.batch.id);
    pass('current root lookups return the persisted wallet proof and match its epoch');

    console.log(results.length + ' subscription server checks passed.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* SQLite 句柄随进程退出释放，清理失败不影响断言结果。 */ }
  }
})();
