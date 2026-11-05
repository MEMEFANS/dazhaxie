/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic local deployment and browser-wallet workflow. */
// No private files, live accounts, public RPC calls, or real transactions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.UWS_USE_FALLBACK ??= '1';
const ganache = require('ganache');
const { JSDOM } = require('jsdom');
const { createPublicClient, createWalletClient, custom, toHex, zeroAddress } = require('viem');
const { buildBundle, createSession, kinds, labels } = require('./launch-deployment-session.cjs');
const { compileLaunch } = require('./compile-launch-contracts.cjs');
const root = path.resolve(__dirname, '..');
let passed = 0;
function pass(message) { passed++; console.log('PASS ' + message); }
function dex(pkg, name) {
  const a = require(pkg + '/build/' + name + '.json'), b = a.bytecode || a.evm.bytecode.object;
  return { abi: a.abi, bytecode: b.startsWith('0x') ? b : '0x' + b };
}
async function sessionWorkflow() {
  const provider = ganache.provider({ logging: { quiet: true }, wallet: { deterministic: true }, chain: { chainId: 31337, hardfork: 'shanghai' } });
  const chain = { id: 31337, name: 'Synthetic deployment session', nativeCurrency: { name: 'Test', symbol: 'TEST', decimals: 18 }, rpcUrls: { default: { http: [] } } };
  const client = createPublicClient({ chain, transport: custom(provider), pollingInterval: 10 });
  const wallet = createWalletClient({ chain, transport: custom(provider) });
  const [owner, distributionReceiver, buybackPool, lpReceiver, signer] = await wallet.getAddresses();
  const deploy = async (entry, args) => {
    const hash = await wallet.deployContract({ ...entry, args, account: owner, gas: 12000000n });
    const receipt = await client.waitForTransactionReceipt({ hash }); assert.equal(receipt.status, 'success'); return receipt.contractAddress;
  };
  try {
    const fixture = compileLaunch(true).output.contracts['test/TestUSDT.sol'].TestUSDT;
    const usdt = await deploy({ abi: fixture.abi, bytecode: '0x' + fixture.evm.bytecode.object }, [18]);
    const factory = await deploy(dex('@uniswap/v2-core', 'UniswapV2Factory'), [owner]);
    const router = await deploy(dex('@uniswap/v2-periphery', 'UniswapV2Router02'), [factory, usdt]);
    const config = { chainId: 31337, owner, distributionReceiver, buybackPool, lpReceiver, signer, usdt, factory, router, previousClaimPool: zeroAddress };
    const bundle = buildBundle();
    const folder = fs.mkdtempSync(path.join(root, 'output', 'isolated-launch-deployment-'));
    const recordFile = path.join(folder, 'synthetic-result.json');
    const session = createSession({ client, config, bundle, recordFile });
    const preflight = await session.preflight();
    assert.equal(preflight.chainId, 31337); assert(BigInt(preflight.tokenEstimatedGas) > 0n);
    pass('本地预检正确估算部署GAS，全部交易由注入的钱包执行');
    const first = await session.plan('token');
    const initialNonce = toHex(await client.getTransactionCount({ address: owner, blockTag: 'pending' }));
    await session.begin('token', initialNonce, first.dataHash);
    session.cancelled('token'); assert.equal((await session.status()).record.pending, null);
    pass('钱包取消后清除等待记录，可以重新准备部署');
    for (const kind of kinds) {
      const plan = await session.plan(kind);
      const nonce = toHex(await client.getTransactionCount({ address: owner, blockTag: 'pending' }));
      await session.begin(kind, nonce, plan.dataHash);
      const hash = await wallet.sendTransaction({ account: owner, ...(plan.tx.to ? { to: plan.tx.to } : {}), data: plan.tx.data, gas: BigInt(plan.tx.gas), gasPrice: BigInt(plan.tx.gasPrice), value: 0n });
      session.attachHash(kind, hash);
      await client.waitForTransactionReceipt({ hash });
      await provider.request({ method: 'evm_mine', params: [] });
      const result = await session.verify(kind, hash);
      assert(result.verified); assert.equal(result.record.pending, null);
      pass('交易回执与含immutable参数的运行代码核验：' + labels[kind]);
    }
    const restored = createSession({ client, config, bundle, recordFile });
    const status = await restored.status();
    assert.equal(status.state.complete, true); assert.equal(status.state.phase, 0);
    assert.equal(status.state.claimAt, '0'); assert.equal(status.state.tradingAt, '0');
    assert.equal(status.state.liquidityEnabled, false); assert.equal(status.state.poolBalance, '0');
    pass('重启可恢复五步部署记录，最终保持筹备阶段且没有注资或开盘');
  } finally { await provider.disconnect(); }
}

async function browserWorkflow(mode) {
  const html = fs.readFileSync(path.join(root, 'deploy/launch-console/index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'deploy/launch-console/wallet.js'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:8789/', runScripts: 'outside-only' });
  const w = dom.window;
  const owner = '0x1111111111111111111111111111111111111111';
  const hash = '0x' + 'a'.repeat(64), dataHash = '0x' + 'b'.repeat(64), address = '0x2222222222222222222222222222222222222222';
  let pending = null, sends = 0, cancelled = false, verified = false;
  const record = { actions: {} }, state = {};
  const manifest = { owner, chainId: 56, kinds, labels, fingerprint: mode, preflight: { tokenEstimatedFeeBnb: '0.001' } };
  w.ethereum = { isMetaMask: true, request: async ({ method, params }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [owner];
    if (method === 'eth_chainId') return '0x38';
    if (method === 'eth_getTransactionCount') return 2;
    assert.equal(method, 'eth_sendTransaction'); sends++;
    const tx = params[0];
    assert.equal(tx.nonce, '0x2');
    for (const field of ['nonce', 'chainId', 'gas', 'gasPrice', 'value']) { assert.equal(typeof tx[field], 'string'); assert.match(tx[field], /^0x[0-9a-f]+$/); }
    if (mode === 'cancel') throw Object.assign(new Error('User rejected'), { code: 4001 });
    return hash;
  } };
  w.fetch = async (url, options) => {
    const body = options?.body ? JSON.parse(options.body) : {};
    let value;
    if (url === '/manifest.json') value = manifest;
    else if (url === '/api/state') value = { record: { ...record, pending }, state };
    else if (url === '/api/plan?kind=token') value = { kind: 'token', label: labels.token, dataHash, estimatedFeeBnb: '0.001', maxFeeBnb: '0.0012', tx: { from: owner, data: '0x6000', value: '0x0', chainId: '0x38', gas: '0x500000', gasPrice: '0x1234' } };
    else if (url === '/api/begin') { assert.equal(body.nonce, '0x2'); pending = { kind: 'token', nonce: body.nonce, dataHash }; value = { pending }; }
    else if (url === '/api/cancel') { cancelled = true; pending = null; value = { cleared: true }; }
    else if (url === '/api/hash') { pending.hash = body.hash; value = { saved: true }; }
    else if (url === '/api/verify') {
      assert.equal(body.hash, hash);
      if (mode === 'lost-reply') throw new Error('Synthetic interrupted response');
      verified = true; pending = null; state.token = address; record.actions.token = { hash, address };
      value = { verified: { hash }, state, record };
    } else throw new Error('Unexpected local fixture route: ' + url);
    return { ok: true, json: async () => value };
  };
  w.eval(script); await w.cabiLaunchReady;
  await w.document.getElementById('connect').onclick();
  await w.document.querySelector('[data-send="token"]').onclick();
  assert.equal(sends, 1);
  if (mode === 'cancel') {
    assert.equal(cancelled, true); assert.equal(pending, null); assert.equal(w.document.querySelector('[data-send="token"]').disabled, false);
    pass('浏览器钱包取消后可重试，不推进下一步');
  } else if (mode === 'lost-reply') {
    assert.equal(verified, false); assert.equal(pending.hash, hash);
    assert.equal(w.document.querySelector('[data-send="token"]').disabled, true);
    assert.equal(JSON.parse(w.localStorage.getItem('cabi-launch-deployment:' + mode)).hash, hash);
    pass('回执查询中断仍保留哈希并阻止重复部署');
  } else {
    assert.equal(verified, true); assert.equal(w.document.querySelector('[data-send="pair"]').disabled, false);
    pass('数值nonce转换为十六进制字符串，钱包确认后才解锁下一步');
  }
  dom.window.close();
}
async function main() {
  await sessionWorkflow();
  for (const mode of ['success', 'cancel', 'lost-reply']) await browserWorkflow(mode);
  console.log(passed + ' deployment workflow checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
