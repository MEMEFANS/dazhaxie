/* eslint-disable @typescript-eslint/no-require-imports -- Isolated SQLite and RPC fixtures, never public-chain writes. */
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const viem = require('viem'), accounts = require('viem/accounts');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cabi-lp-access-'));
const env = { ...process.env, CABI_DATA_DIR: dir, CLAIM_SIGNER_PRIVATE_KEY: accounts.generatePrivateKey() };
const token = '0x1111111111111111111111111111111111111111', pool = '0x2222222222222222222222222222222222222222', usdt = '0x3333333333333333333333333333333333333333', wallet = '0x4444444444444444444444444444444444444444';
const root = path.resolve(__dirname, '..'), globals = {};
function load(file, replacements = {}) {
  const m = { exports: {} }, filename = path.join(root, file);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { module: m, exports: m.exports, require: name => name in replacements ? replacements[name] : require(name), process: { env }, globalThis: globals, console, Date, URL, Request, Response, setTimeout, clearTimeout, Buffer }, { filename });
  return m.exports;
}
class AdminRequestError extends Error { constructor(message, status) { super(message); this.status = status; } }
let authed = true;
const auth = {
  AdminRequestError, requireCurrentAdmin: async () => { if (!authed) throw new AdminRequestError('login', 401); return { account: 'qa' }; },
  assertSameOrigin: req => { if (req.headers.get('origin') !== 'https://fixture.invalid') throw new AdminRequestError('origin', 403); },
  readJsonObject: req => req.json(), adminErrorResponse: e => Response.json({ error: e.message }, { status: e.status || 500 }),
};
const db = load('src/lib/server/admin-db.ts', { 'server-only': {}, '../constants': { BURN_ADDRESS: viem.zeroAddress } });
const config = { chainConfigurationValid: true, chainConfig: { id: 56, rpcUrls: ['http://isolated.invalid'] }, appChain: { id: 56 }, contracts: { token, claimPool: pool, usdt } };
let phase = 'lp', rpcError = false;
const client = {
  getChainId: async () => { if (rpcError) throw new Error('offline'); return 56; },
  getBlock: async () => ({ number: 100n, timestamp: BigInt(Math.floor(Date.now() / 1000)) }),
  readContract: async ({ functionName, blockNumber }) => {
    assert.equal(blockNumber, 100n);
    const now = BigInt(Math.floor(Date.now() / 1000));
    return { liquidityEnabled: phase !== 'setup', isClaimOpen: phase === 'trading', isTradingOpen: phase === 'trading',
      claimStartsAt: phase === 'trading' ? now - 100n : now + 100n, tradingStartsAt: phase === 'trading' ? now - 50n : now + 200n,
      launchPool: pool, token, usdt }[functionName];
  },
};
const access = load('src/lib/server/liquidity-access.ts', { 'server-only': {}, '../chain-config': config, './admin-db': db, './admin-session': auth, viem: { ...viem, createPublicClient: () => client } });
const route = load('src/app/api/admin/liquidity/route.ts', { '@/lib/server/admin-session': auth, '@/lib/server/admin-db': db, '@/lib/server/liquidity-access': access });
function post(enabled, revision = access.liquiditySettings().revision, scope = access.liquidityScope(), origin = 'https://fixture.invalid') {
  return route.POST(new Request('https://fixture.invalid/api/admin/liquidity', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ enabled, revision, scope }) }));
}
let count = 0;
async function test(name, fn) { await fn(); count++; console.log('PASS ' + name); }
async function main() {
  await test('persisted switch is isolated from subscription/redemption settings and other contract scopes', async () => {
    const before = db.readOperationalSettings(), s = access.liquiditySettings(); assert.equal(s.enabled, true);
    assert.equal((await post(false)).status, 200); assert.equal(access.liquiditySettings().enabled, false); assert.deepEqual(db.readOperationalSettings(), before);
    assert.equal(db.readLiquidityAccess('another-chain-token-pool').enabled, true); assert.equal((await post(true)).status, 200);
  });
  await test('unauthenticated, cross-origin and stale-config writes rejected', async () => {
    authed = false; assert.equal((await route.GET()).status, 401); assert.equal((await post(false)).status, 401); authed = true;
    assert.equal((await post(false, access.liquiditySettings().revision, access.liquidityScope(), 'https://evil.invalid')).status, 403);
    assert.equal((await post(false, 0)).status, 409); assert.equal((await post(false, 2, 'wrong-scope')).status, 400);
  });
  await test('pause remains available when RPC is down, opening fails closed', async () => {
    rpcError = true; assert.equal((await post(false)).status, 200); assert.equal((await post(true)).status, 503);
    assert.equal((await access.liquidityAccessStatus()).available, false); rpcError = false;
    assert.equal((await post(true)).status, 200); assert.equal((await access.liquidityAccessStatus()).available, true);
  });
  await test('setup and trading phases cannot be reopened by website switch; prepare guards track revisions', async () => {
    phase = 'trading'; assert.equal((await access.liquidityAccessStatus()).available, false); assert.equal((await post(true)).status, 409);
    await assert.rejects(access.assertLiquidityPreparationOpen(), /阶段已结束/);
    phase = 'setup'; assert.equal((await post(true)).status, 409); phase = 'lp';
    const before = await access.assertLiquidityPreparationOpen(); await post(false); await post(true);
    assert.throws(() => access.assertLiquidityWebsiteOpen(before.revision), /设置已变化/);
  });
  await test('authorization issuance and cached-signature reuse both respect pause; receipt path remains open', async () => {
    const signer = accounts.privateKeyToAccount(env.CLAIM_SIGNER_PRIVATE_KEY), units = 35000n * 10n ** 18n;
    let signHook = null, reuse = null, saved = 0, nonce = 0;
    const signAccount = { ...signer, signTypedData: async request => { if (signHook) await signHook(); return signer.signTypedData(request); } };
    const signingClient = { getCode: async () => '0x6000', getChainId: async () => 56, readContract: async ({ functionName }) => ({ token, preparedOf: 0n, signer: signer.address, lpReceiver: wallet, usdt, usdtDecimals: 18, balanceOf: viem.parseEther('1000') })[functionName],
      getTransactionReceipt: async () => ({ status: 'success', logs: [{ address: pool, topics: viem.encodeEventTopics({ abi: viem.parseAbi(['event LiquidityPrepared(address indexed user,uint256 amount,uint256 payout,uint256 lpTokens,uint256 usdtPaid,uint256 liquidity,uint256 nonce)']), eventName: 'LiquidityPrepared', args: { user: wallet } }), data: viem.encodeAbiParameters(Array.from({ length: 6 }, () => ({ type: 'uint256' })), [units, units * 70n / 100n, units * 30n / 100n, 15n * 10n ** 18n, 1n, 1n]) }] }) };
    const claim = load('src/lib/server/claim-auth.ts', { 'server-only': {}, '../chain-config': config, './admin-session': auth, './liquidity-access': access,
      viem: { ...viem, createPublicClient: () => signingClient }, 'viem/accounts': { privateKeyToAccount: () => signAccount },
      './subscription-db': { countAuthorizationsSince: () => 0, entitlementTokens: () => units, localClaimedTokens: () => 0n, latestOpenAuthorization: () => reuse,
        nextAuthorizationNonce: () => String(++nonce), saveClaimAuthorization: () => { saved++; }, getClaimAuthorization: () => ({ amount: String(units) }), markAuthorizationClaimed: () => ({ recorded: true }) } });
    await post(false); await assert.rejects(claim.issueClaimAuthorization(wallet), /已暂停/); assert.equal(saved, 0);
    await post(true); const issued = await claim.issueClaimAuthorization(wallet); assert.equal(saved, 1); reuse = issued;
    await post(false); await assert.rejects(claim.issueClaimAuthorization(wallet), /已暂停/); assert.equal(saved, 1);
    assert.equal((await claim.recordClaimReceipt(wallet, '1', '0x' + '1'.repeat(64))).recorded, true);
    await post(true); assert.equal((await claim.issueClaimAuthorization(wallet)).nonce, issued.nonce); assert.equal(saved, 1);
    reuse = null; signHook = () => post(false); await assert.rejects(claim.issueClaimAuthorization(wallet), /已暂停/); assert.equal(saved, 1);
  });
  console.log(count + ' liquidity access checks passed; no live transactions.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { globals.cabiAdminDatabase?.db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
