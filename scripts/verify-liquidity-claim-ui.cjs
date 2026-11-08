/* eslint-disable @typescript-eslint/no-require-imports -- Real claim card with isolated wallet and service fixtures. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), { JSDOM } = require('jsdom'), viem = require('viem');
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/dapp/token' });
global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator });
const React = require('react'), { createRoot } = require('react-dom/client');
const address = '0x1111111111111111111111111111111111111111', pool = '0x2222222222222222222222222222222222222222', usdt = '0x3333333333333333333333333333333333333333';
const unit = 10n ** 18n, writes = [], signed = [], state = { connected: true, address, chainId: 56 };
let data, closedBeforeSend = false, key = 0;
const tx = { busy: false, run: async request => { if (request.beforeSend) await request.beforeSend(); writes.push(request); return '0x' + '1'.repeat(64); } };
const query = { status: 'ready', refresh() {}, get data() { return data; } };
const modules = {
  react: React, viem, '@/lib/store': { useStore: () => ({ state }) }, '@/lib/chain-config': { chainConfig: { id: 56, shortName: 'BSC' }, contracts: { claimPool: pool, usdt } },
  '@/lib/claim-pool-data': { claimPoolAbi: [], fetchClaimPoolData: async () => data, refreshClaimPoolData() {}, useClaimPoolData: () => query,
    requestClaimAuthorization: async () => { signed.push(true); return { amount: 35000n * unit, cumulativeLimit: 35000n * unit, nonce: 1n, deadline: 9999999999n, signature: '0x' }; },
    submitClaimReceipt: async () => {}, verifyLiquidityAccess: async () => { if (closedBeforeSend) throw new Error('组 LP 已暂停'); } },
  '@/lib/contract-transactions': { useContractTransaction: () => tx, TransactionFeedback: () => null }, '@/lib/community-client': { signInCommunity: async () => {} },
  '@/lib/amounts': { formatAssetAmount: (value, decimals) => viem.formatUnits(value, decimals) }, '@/lib/allocation-utils': { holdingAllows: () => true },
  '@/components/dapp/ui': { Card: ({ children }) => React.createElement('section', null, children), SectionHead: ({ title, right }) => React.createElement('h2', null, title, right), Badge: ({ children }) => React.createElement('span', null, children), DataRow: ({ label, value }) => React.createElement('p', null, label + value) },
  '@/components/dapp/service-query-notice': { ServiceQueryNotice: () => null }, './claim.module.css': {},
};
const m = { exports: {} }, filename = path.resolve('src/components/dapp/token/simple-claim-card.tsx');
vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
  { module: m, exports: m.exports, require: name => name in modules ? modules[name] : require(name), console, Error, setTimeout, clearTimeout });
const root = createRoot(document.getElementById('root'));
async function render() { await React.act(async () => root.render(React.createElement(m.exports.default, { key: ++key }))); }
function reset() {
  writes.length = 0; signed.length = 0; closedBeforeSend = false;
  data = { prepared: 0n, claimed: 0n, claimOpen: false, lpReady: true, lpReceiver: address, usdt, signer: address, usdtDecimals: 18, tokenDecimals: 18,
    server: { configured: true, needsSignIn: false, liquidityEnabled: true, claimable: 35000n * unit, entitlement: 35000n * unit, signer: address },
    wallet: { tokenBalance: 0n, usdtBalance: 100n * unit, maxWalletAmount: 1000000000n * unit, exempt: true },
    preview: { payout: 24500n * unit, lpTokens: 10500n * unit, usdtRequired: 15n * unit, estimatedLiquidity: 100n * unit } };
}
function button(text) { return [...document.querySelectorAll('button')].find(b => b.textContent === text); }
async function click(target) { assert(target); await React.act(async () => target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); }
async function main() {
  reset(); data.lpReady = false; data.lpError = '组 LP 已暂停'; data.server.liquidityEnabled = false; await render(); assert.equal(button('组 LP 已暂停').disabled, true); assert.equal(signed.length, 0);
  reset(); data.lpReady = false; data.prepared = 35000n * unit; data.claimOpen = true; data.server.configured = false; data.server.needsSignIn = true; data.server.error = '组 LP 暂停'; await render();
  assert.equal(button('领取 70% CaBi').disabled, false); await click(button('领取 70% CaBi')); assert.equal(writes[0].functionName, 'claim'); assert.equal(signed.length, 0);
  reset(); await render(); await click(button('确认组 LP')); assert.equal(signed.length, 1); assert.equal(writes[0].functionName, 'prepareLiquidity'); assert.equal(writes[0].approval.amount, 15n * unit);
  reset(); closedBeforeSend = true; await render(); await click(button('确认组 LP')); assert.equal(writes.length, 0); assert(document.body.textContent.includes('组 LP 已暂停'));
  console.log('PASS closed LP disables new participation, existing claims work without signer availability, exact approval retained, pre-send pause prevents submission.');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { await React.act(async () => root.unmount()); dom.window.close(); });
