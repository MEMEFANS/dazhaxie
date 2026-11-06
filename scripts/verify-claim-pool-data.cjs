/* eslint-disable @typescript-eslint/no-require-imports -- Isolated LaunchPool read fixture. */
// 用合成只读客户端验证 CaBiLaunchPool 的「先组 LP、后领取」数据读取，不连接真实节点。
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), viem = require('viem');
const ROOT = path.resolve(__dirname, '..');
const POOL = '0x1111111111111111111111111111111111111111', TOKEN = '0x2222222222222222222222222222222222222222';
const USDT = '0x3333333333333333333333333333333333333333', SIGNER = '0x4444444444444444444444444444444444444444', LP = '0x5555555555555555555555555555555555555555', A = '0x6666666666666666666666666666666666666666';
const ZERO = viem.zeroAddress, unit = 10n ** 18n, results = [];
function pass(name) { results.push(name); console.log('PASS ' + name); }
let state;
function resetState() { state = { chainId: 56, block: 100n, code: '0x6000', token: TOKEN, lpReady: true, configured: true, authenticated: true, claimable: 35000n * unit, entitlement: 35000n * unit, prepared: 0n, claimed: 0n, poolBalance: 1000000n * unit, actualBalance: 1000000n * unit, claimOpen: false }; }
const client = {
  getChainId: async () => state.chainId, getBlock: async () => ({ number: state.block }), getCode: async () => state.code,
  readContract: async request => { const { functionName, args } = request; switch (functionName) {
    case 'token': return state.token; case 'usdt': return state.lpReady ? USDT : ZERO; case 'signer': return SIGNER; case 'lpReceiver': return state.lpReady ? LP : ZERO; case 'usdtDecimals': return 6; case 'isClaimOpen': return state.claimOpen; case 'decimals': return 18;
    case 'poolBalance': return state.poolBalance; case 'totalPrepared': return state.prepared; case 'totalClaimed': return state.claimed; case 'totalLpTokens': return 10500n * unit; case 'totalUsdtCharged': return 15n * 10n ** 6n;
    case 'balanceOf': return args[0].toLowerCase() === POOL.toLowerCase() ? state.actualBalance : 123n * unit; case 'preparedOf': return state.prepared; case 'claimedHere': return state.claimed; case 'allowance': return 0n; case 'maxWalletAmount': return 200000n * unit; case 'isMaxWalletExempt': return false;
    case 'previewPrepare': return [24500n * unit, 10500n * unit, 15n * 10n ** 6n, 100n * unit]; default: throw new Error('unexpected ' + functionName);
  } },
};
function mockFetch() { const body = state.authenticated ? { configured: state.configured, claimPool: POOL, chainId: 56, authenticated: true, signer: SIGNER, claimable: String(state.claimable), entitlement: String(state.entitlement) } : { configured: state.configured, claimPool: POOL, chainId: 56, authenticated: false, claimable: null }; return Promise.resolve({ ok: true, status: 200, json: async () => body }); }
const chainConfig = { chainConfigurationValid: true, appChain: { id: 56 }, chainConfig: { id: 56, rpcUrls: ['http://isolated.fixture'] }, contracts: { claimPool: POOL, token: TOKEN, usdt: USDT } };
function load() { const filename = path.join(ROOT, 'src/lib/claim-pool-data.ts'), runtimeModule = { exports: {} }; const javascript = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText; vm.runInNewContext(javascript, { module: runtimeModule, exports: runtimeModule.exports, require: name => name === './chain-config' ? chainConfig : name === 'viem' ? { ...viem, createPublicClient: () => client } : require(name), fetch: mockFetch, console, setTimeout, clearTimeout, Date, Error, Map, Set, BigInt, Promise }, { filename }); return runtimeModule.exports; }
(async () => { try {
  const module_ = load(); resetState(); const data = await module_.fetchClaimPoolData(A);
  assert.equal(data.token, TOKEN); assert.equal(data.usdt, USDT); assert.equal(data.lpReady, true); assert.equal(data.claimOpen, false); assert.equal(data.preview.amount, 35000n * unit); assert.equal(data.preview.payout, 24500n * unit); assert.equal(data.preview.lpTokens, 10500n * unit); assert.equal(data.preview.usdtRequired, 15n * 10n ** 6n); assert.equal(data.server.claimable, 35000n * unit); assert.equal(data.prepared, 0n); pass('reads LaunchPool state and the fixed 70/30 preparation preview');
  state.prepared = 35000n * unit; state.claimOpen = true; const prepared = await module_.fetchClaimPoolData(A); assert.equal(prepared.prepared, 35000n * unit); assert.equal(prepared.claimOpen, true); pass('reports prepared amount and claim-open state for the second wallet action');
  resetState(); state.lpReady = false; const missing = await module_.fetchClaimPoolData(A); assert.equal(missing.lpReady, false); assert.equal(missing.preview, undefined); pass('missing USDT or LP receiver disables preparation');
  resetState(); state.token = TOKEN.replace('2222', '2223'); await assert.rejects(() => module_.fetchClaimPoolData(A), /领取池代币与 CaBi 配置不一致/); pass('token mismatch is rejected before showing unsafe numbers');
  resetState(); state.chainId = 97; await assert.rejects(() => module_.fetchClaimPoolData(A), /当前网络信息不一致/); pass('wrong network is rejected'); console.log(results.length + ' LaunchPool data checks passed.');
} catch (error) { console.error(error); process.exitCode = 1; } })();
