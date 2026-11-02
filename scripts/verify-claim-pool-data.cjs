/* eslint-disable @typescript-eslint/no-require-imports -- Isolated fixture reads; no RPC or private files. */
// 用合成只读客户端 + 假签名服务响应验证签名自领的数据读取与一致性校验，不连接任何真实节点。
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), viem = require('viem');
const ROOT = path.resolve(__dirname, '..');
const POOL = '0x1111111111111111111111111111111111111111', TOKEN = '0x2222222222222222222222222222222222222222';
const USDT = '0x3333333333333333333333333333333333333333', OWNER = '0x4444444444444444444444444444444444444444';
const LP = '0x5555555555555555555555555555555555555555', A = '0x6666666666666666666666666666666666666666';
const SIGNER = '0x7777777777777777777777777777777777777777';
const ZERO = viem.zeroAddress, unit = 10n ** 18n;
const results = [];
function pass(name) { results.push(name); console.log('PASS ' + name); }
let state, requests;
function resetState() {
  state = {
    chainId: 56, block: 100n, code: '0x6000', mismatchToken: false, mismatchRatios: false, mismatchPreview: false,
    lpReady: true, configured: true, authenticated: true, serverError: undefined,
    claimable: 35000n * unit, claimed: 0n, poolBalance: 1000000n * unit, actualBalance: 1000000n * unit,
  };
  requests = [];
}
const client = {
  getChainId: async () => state.chainId,
  getBlock: async () => ({ number: state.block }),
  getCode: async () => state.code,
  readContract: async request => {
    const { functionName, args } = request;
    switch (functionName) {
      case 'token': return state.mismatchToken ? TOKEN.replace('2222', '2223') : TOKEN;
      case 'usdt': return state.lpReady ? USDT : ZERO;
      case 'owner': return OWNER;
      case 'pendingOwner': return ZERO;
      case 'lpReceiver': return state.lpReady ? LP : ZERO;
      case 'signer': return SIGNER;
      case 'burnRemainder': return true;
      case 'directRatio': return state.mismatchRatios ? 60n : 50n;
      case 'lpRatio': return 70n;
      case 'lpTokenRatio': return 30n;
      case 'lpUsdtRatio': return 30n;
      case 'usdtDecimals': return 6;
      case 'decimals': return 18;
      case 'poolBalance': return state.poolBalance;
      case 'totalClaimed': return 35000n * unit;
      case 'totalBurned': return 17500n * unit;
      case 'allocatedUnclaimed': return 0n;
      case 'unusedBalance': return state.poolBalance;
      case 'balanceOf': return args[0].toLowerCase() === POOL.toLowerCase() ? state.actualBalance : 123n * unit;
      case 'claimedOf': return state.claimed;
      case 'allowance': return 0n;
      case 'maxWalletAmount': return 200000n * unit;
      case 'isMaxWalletExempt': return false;
      case 'previewClaim': {
        const amount = args[0], mode = Number(args[1]);
        if (state.mismatchPreview) return [amount * 60n / 100n, amount * 40n / 100n, 0n, 0n];
        return mode === 0 ? [amount * 50n / 100n, amount * 50n / 100n, 0n, 0n]
          : [amount * 70n / 100n, 0n, amount * 30n / 100n, 15n * 10n ** 6n];
      }
      default: throw new Error('unexpected ' + functionName);
    }
  },
};
function mockFetch(request, init) {
  requests.push({ url: String(request), init });
  const body = state.serverError ? { error: state.serverError }
    : state.authenticated
      ? { configured: state.configured, claimPool: POOL, signer: SIGNER, chainId: 56, authenticated: true, claimable: state.claimable === undefined ? null : String(state.claimable) }
      : { configured: state.configured, claimPool: POOL, signer: SIGNER, chainId: 56, authenticated: false, claimable: null };
  return Promise.resolve({ ok: true, status: 200, json: async () => body });
}
const chainConfig = {
  chainConfigurationValid: true, appChain: { id: 56 }, chainConfig: { id: 56, rpcUrls: ['http://isolated.fixture'] },
  contracts: { claimPool: POOL, token: TOKEN, usdt: USDT },
};
function load() {
  const filename = path.join(ROOT, 'src/lib/claim-pool-data.ts'), runtimeModule = { exports: {} };
  const javascript = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  vm.runInNewContext(javascript, {
    module: runtimeModule, exports: runtimeModule.exports,
    require: name => {
      if (name === './chain-config') return chainConfig;
      if (name === 'viem') return { ...viem, createPublicClient: () => client };
      return require(name);
    },
    fetch: mockFetch,
    console, setTimeout, clearTimeout, Date, Error, Map, Set, BigInt, Promise,
  }, { filename });
  return runtimeModule.exports;
}

(async () => {
  try {
    const module_ = load();
    resetState();
    const data = await module_.fetchClaimPoolData(A);
    assert.equal(data.token.toLowerCase(), TOKEN.toLowerCase());
    assert.equal(data.usdt.toLowerCase(), USDT.toLowerCase());
    assert.equal(data.signer.toLowerCase(), SIGNER.toLowerCase());
    assert.equal(data.lpReady, true);
    assert.equal(data.usdtDecimals, 6);
    assert.equal(data.tokenDecimals, 18);
    assert.equal(data.poolBalance, 1000000n * unit);
    assert.equal(data.server.configured, true);
    assert.equal(data.server.claimable, 35000n * unit);
    assert.equal(data.claimed, 0n);
    assert.equal(data.directPreview.payout, 17500n * unit);
    assert.equal(data.directPreview.burnAmount, 17500n * unit);
    assert.equal(data.lpPreview.payout, 24500n * unit);
    assert.equal(data.lpPreview.lpTokens, 10500n * unit);
    assert.equal(data.lpPreview.usdtRequired, 15n * 10n ** 6n);
    assert.equal(data.wallet.usdtBalance, 123n * unit);
    assert.equal(data.wallet.tokenBalance, 123n * unit);
    assert.equal(data.wallet.maxWalletAmount, 200000n * unit);
    assert.equal(requests[0].url, '/api/claim/authorization');
    pass('reads pool rules, wallet balances and both previews, with the claimable amount coming from the signing service');

    const publicData = await module_.fetchClaimPoolData();
    assert.equal(publicData.wallet, undefined);
    assert.equal(publicData.directPreview, undefined);
    assert.equal(publicData.lpPreview, undefined);
    assert.equal(publicData.lpReady, true);
    assert.equal(publicData.server.claimable, 35000n * unit);
    pass('public reads expose pool totals and server configuration without wallet-specific previews');

    resetState(); state.authenticated = false;
    const signedOut = await module_.fetchClaimPoolData(A);
    assert.equal(signedOut.server.needsSignIn, true);
    assert.equal(signedOut.server.claimable, undefined);
    assert.equal(signedOut.directPreview, undefined);
    pass('a wallet without a signed session sees a sign-in requirement instead of a claimable amount');

    resetState(); state.configured = false; state.claimable = undefined;
    const unconfigured = await module_.fetchClaimPoolData(A);
    assert.equal(unconfigured.server.configured, false);
    assert.match(unconfigured.server.error, /未配置签名服务/);
    assert.equal(unconfigured.server.claimable, undefined);
    assert.equal(unconfigured.directPreview, undefined);
    pass('a missing signer key disables the claim card with an explicit reason');

    resetState(); state.serverError = '当前没有可领取额度';
    const exhausted = await module_.fetchClaimPoolData(A);
    assert.equal(exhausted.server.error, '当前没有可领取额度');
    assert.equal(exhausted.directPreview, undefined);
    pass('a zero-entitlement response from the server surfaces its message and skips previews');

    resetState(); state.claimed = 17500n * unit; state.claimable = 17500n * unit;
    const partial = await module_.fetchClaimPoolData(A);
    assert.equal(partial.claimed, 17500n * unit);
    assert.equal(partial.server.claimable, 17500n * unit);
    pass('a partially claimed wallet shows both its on-chain claimed total and the remaining server entitlement');

    resetState(); state.mismatchRatios = true;
    await assert.rejects(() => module_.fetchClaimPoolData(A), /领取规则或储备信息不一致/);
    resetState(); state.mismatchToken = true;
    await assert.rejects(() => module_.fetchClaimPoolData(A), /领取池代币与 CaBi 配置不一致/);
    resetState(); state.poolBalance = 999999n * unit; state.actualBalance = 999998n * unit;
    await assert.rejects(() => module_.fetchClaimPoolData(A), /领取规则或储备信息不一致/);
    pass('ratio, token and pooled-balance mismatches stop the read instead of showing unsafe numbers');

    resetState(); state.mismatchPreview = true;
    await assert.rejects(() => module_.fetchClaimPoolData(A), /领取预览与额度不一致/);
    pass('preview values must match the server entitlement before the claim buttons are usable');

    resetState(); state.lpReady = false;
    const directOnly = await module_.fetchClaimPoolData(A);
    assert.equal(directOnly.lpReady, false);
    assert(directOnly.lpError.includes('只能选择直接领取'));
    assert.equal(directOnly.lpPreview, undefined);
    pass('missing USDT or LP receiver falls back to direct 50% only with an explicit reason');

    resetState(); state.chainId = 97;
    await assert.rejects(() => module_.fetchClaimPoolData(A), /当前网络信息不一致/);
    resetState(); state.code = '0x';
    await assert.rejects(() => module_.fetchClaimPoolData(A), /领取服务尚未就绪/);
    resetState(); state.block = null;
    await assert.rejects(() => module_.fetchClaimPoolData(A), /暂时无法读取领取状态/);
    pass('wrong chain, missing contract code or missing block are rejected with actionable messages');

    chainConfig.contracts.claimPool = undefined;
    await assert.rejects(() => module_.fetchClaimPoolData(A), /领取池尚未配置/);
    chainConfig.contracts.claimPool = POOL;
    pass('an unconfigured claim pool is reported before any contract call');

    console.log(results.length + ' claim pool data checks passed.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();
