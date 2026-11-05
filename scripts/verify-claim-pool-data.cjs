/* eslint-disable @typescript-eslint/no-require-imports -- Isolated fixture reads; no RPC or private files. */
// 用合成只读客户端 + 假 proof 接口验证 Merkle 自领的数据读取与一致性校验，不连接任何真实节点。
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), viem = require('viem');
const ROOT = path.resolve(__dirname, '..');
const POOL = '0x1111111111111111111111111111111111111111', TOKEN = '0x2222222222222222222222222222222222222222';
const USDT = '0x3333333333333333333333333333333333333333', OWNER = '0x4444444444444444444444444444444444444444';
const LP = '0x5555555555555555555555555555555555555555', A = '0x6666666666666666666666666666666666666666';
const ROOT_HASH = '0x' + 'ab'.repeat(32), PROOF = ['0x' + 'cd'.repeat(32)];
const ZERO = viem.zeroAddress, unit = 10n ** 18n;
const results = [];
function pass(name) { results.push(name); console.log('PASS ' + name); }
let state, requests;
function resetState() {
  state = {
    chainId: 56, block: 100n, code: '0x6000', mismatchToken: false, mismatchPreview: false,
    lpReady: true, configured: true, authenticated: true, serverError: undefined,
    amount: 35000n * unit, claimable: 35000n * unit, proof: PROOF, root: ROOT_HASH, epoch: 1,
    claimed: 0n, poolBalance: 1000000n * unit, actualBalance: 1000000n * unit,
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
      case 'merkleRoot': return state.root;
      case 'epoch': return BigInt(state.epoch);
      case 'usdtDecimals': return 6;
      case 'decimals': return 18;
      case 'poolBalance': return state.poolBalance;
      case 'totalClaimed': return 35000n * unit;
      case 'totalLpTokens': return 10500n * unit;
      case 'totalUsdtCharged': return 15n * 10n ** 6n;
      case 'balanceOf': return args[0].toLowerCase() === POOL.toLowerCase() ? state.actualBalance : 123n * unit;
      case 'claimedOf': return state.claimed;
      case 'allowance': return 0n;
      case 'maxWalletAmount': return 200000n * unit;
      case 'isMaxWalletExempt': return false;
      case 'previewClaim': {
        const cumulative = args[1], delta = cumulative > state.claimed ? cumulative - state.claimed : 0n;
        if (state.mismatchPreview) return [delta, delta * 60n / 100n, delta * 40n / 100n, 15n * 10n ** 6n];
        return [delta, delta * 70n / 100n, delta * 30n / 100n, delta * 50n * 30n * 10n ** 6n / (35000n * unit * 100n)];
      }
      default: throw new Error('unexpected ' + functionName);
    }
  },
};
function mockFetch(request, init) {
  requests.push({ url: String(request), init });
  const body = state.serverError ? { error: state.serverError }
    : state.authenticated
      ? { configured: state.configured, claimPool: POOL, chainId: 56, authenticated: true, root: state.root, epoch: state.epoch, amount: state.amount === undefined ? null : String(state.amount), claimable: state.claimable === undefined ? null : String(state.claimable), proof: state.proof }
      : { configured: state.configured, claimPool: POOL, chainId: 56, authenticated: false, root: state.root, epoch: state.epoch, amount: "0", claimable: "0", proof: [] };
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
    assert.equal(data.lpReady, true);
    assert.equal(data.usdtDecimals, 6);
    assert.equal(data.tokenDecimals, 18);
    assert.equal(data.poolBalance, 1000000n * unit);
    assert.equal(data.merkleRoot.toLowerCase(), ROOT_HASH);
    assert.equal(data.epoch, 1);
    assert.equal(data.server.configured, true);
    assert.equal(data.server.amount, 35000n * unit);
    assert.equal(data.server.claimable, 35000n * unit);
    assert.equal(data.server.proof.length, 1);
    assert.equal(data.claimed, 0n);
    assert.equal(data.preview.amount, 35000n * unit);
    assert.equal(data.preview.payout, 24500n * unit);
    assert.equal(data.preview.lpTokens, 10500n * unit);
    assert.equal(data.preview.usdtRequired, 15n * 10n ** 6n);
    assert.equal(data.totalLpTokens, 10500n * unit);
    assert.equal(data.totalUsdtCharged, 15n * 10n ** 6n);
    assert.equal(data.wallet.usdtBalance, 123n * unit);
    assert.equal(data.wallet.tokenBalance, 123n * unit);
    assert.equal(data.wallet.maxWalletAmount, 200000n * unit);
    assert.equal(requests[0].url, '/api/claim/proof');
    pass('reads the Merkle root/epoch, proof and the single 70/30 preview');

    const publicData = await module_.fetchClaimPoolData();
    assert.equal(publicData.wallet, undefined);
    assert.equal(publicData.preview, undefined);
    assert.equal(publicData.lpReady, true);
    pass('public reads expose pool totals and the current root without wallet-specific previews');

    resetState(); state.authenticated = false;
    const signedOut = await module_.fetchClaimPoolData(A);
    assert.equal(signedOut.server.needsSignIn, true);
    assert.equal(signedOut.server.claimable, 0n);
    assert.equal(signedOut.preview, undefined);
    pass('a wallet without a signed session sees a sign-in requirement instead of a proof preview');

    resetState(); state.configured = false; state.amount = undefined; state.claimable = undefined;
    const unconfigured = await module_.fetchClaimPoolData(A);
    assert.equal(unconfigured.server.configured, false);
    assert.equal(unconfigured.server.amount, undefined);
    assert.equal(unconfigured.preview, undefined);
    pass('a missing claim pool disables the claim card');

    resetState(); state.serverError = '管理员尚未发布领取批次，暂不能领取';
    const unpublished = await module_.fetchClaimPoolData(A);
    assert.match(unpublished.server.error, /尚未发布领取批次/);
    assert.equal(unpublished.server.claimable, undefined);
    assert.equal(unpublished.preview, undefined);
    pass('an unpublished Merkle root surfaces its message and skips the preview');

    resetState(); state.claimed = 17500n * unit; state.claimable = 17500n * unit;
    const partial = await module_.fetchClaimPoolData(A);
    assert.equal(partial.claimed, 17500n * unit);
    assert.equal(partial.server.amount, 35000n * unit);
    assert.equal(partial.server.claimable, 17500n * unit);
    assert.equal(partial.preview.amount, 17500n * unit);
    assert.equal(partial.preview.payout, 12250n * unit);
    pass('a partially claimed wallet shows cumulative entitlement, on-chain claimed and the remaining delta');

    resetState(); state.mismatchPreview = true;
    await assert.rejects(() => module_.fetchClaimPoolData(A), /领取预览与额度不一致/);
    resetState(); state.mismatchToken = true;
    await assert.rejects(() => module_.fetchClaimPoolData(A), /领取池代币与 CaBi 配置不一致/);
    resetState(); state.poolBalance = 999999n * unit; state.actualBalance = 999998n * unit;
    await assert.rejects(() => module_.fetchClaimPoolData(A), /领取规则或储备信息不一致/);
    pass('the 70/30 split, token and pooled-balance mismatches stop the read instead of showing unsafe numbers');

    resetState(); state.lpReady = false;
    const lpMissing = await module_.fetchClaimPoolData(A);
    assert.equal(lpMissing.lpReady, false);
    assert.match(lpMissing.lpError, /LP 接收地址/);
    assert.equal(lpMissing.preview, undefined);
    pass('missing USDT or LP receiver blocks claiming entirely with an explicit reason');

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
