/* eslint-disable @typescript-eslint/no-require-imports -- Isolated React DOM verification. */
// Synthetic orders and fetch only; no production records, keys, or wallet transactions.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), viem = require('viem');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost:3000/admin/subscribe' });
global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator });
const React = require('react'), { createRoot } = require('react-dom/client');
const A = '0x1111111111111111111111111111111111111111', B = '0x2222222222222222222222222222222222222222';
const PAYEE = '0x3333333333333333333333333333333333333333', unit = 10n ** 18n;
const calls = [], orders = [
  { id: 'o1', address: A, shares: 1, amount: String(50n * unit), txHash: '0x' + 'ab'.repeat(32), status: 'confirmed', createdAt: 1700000000000 },
  { id: 'o2', address: B, shares: 2, amount: String(100n * unit), txHash: '0x' + 'cd'.repeat(32), status: 'confirmed', createdAt: 1700000001000, shipping: { name: '合成测试用户', phone: '13800138000', address: '测试地址 1 号' } },
];
const settings = { subscribeLocked: true, subscribePayee: PAYEE };
let shipError = false, checks = 0;
function pass(message) { checks++; console.log('PASS ' + message); }
async function mockFetch(url, init) {
  const method = init?.method || 'GET', body = init?.body ? JSON.parse(init.body) : undefined;
  calls.push({ url, method, body });
  const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
  if (url.startsWith('/api/admin/subscriptions?')) {
    const params = new URLSearchParams(url.split('?')[1]), q = params.get('q');
    return reply({ items: q ? orders.filter(row => row.address.includes(q)) : orders, total: q ? 1 : 12, page: Number(params.get('page')), pageSize: 10, globalSold: 15000, hardCap: 20000, ...settings });
  }
  if (url === '/api/subscribe/config') return reply({ payee: settings.subscribePayee, locked: settings.subscribeLocked });
  if (url === '/api/admin/subscriptions' && method === 'POST') {
    if (body.action === 'ship') {
      if (shipError) return reply({ error: '模拟保存失败' }, 503);
      const order = orders.find(row => row.id === body.id);
      Object.assign(order, { status: 'shipped', carrier: body.carrier, trackingNumber: body.trackingNumber });
      return reply({ order });
    }
    Object.assign(settings, body); return reply({ settings });
  }
  if (url === '/api/admin/claim-pool') return reply({
    mode: 'signed', pool: A,
    chain: { owner: B, signer: B, usdt: PAYEE, lpReceiver: B, usdtDecimals: 18, poolBalance: String(500000n * unit), totalClaimed: '0', totalLpTokens: String(10500n * unit), totalUsdtCharged: String(15n * unit), allocatedUnclaimed: String(35000n * unit), unusedBalance: String(465000n * unit), lpReady: true },
    signing: { configured: true, signer: B, signerMatches: true },
    entitlements: { total: String(35000n * unit), outstanding: String(35000n * unit), addresses: 1, rows: [{ address: A, tokens: String(35000n * unit), chainClaimed: '0', outstanding: String(35000n * unit), reason: ['认购 1 份'] }] },
  });
  throw new Error('Unexpected fixture request ' + url);
}
function load(relative, replacements = {}) {
  const filename = path.join(__dirname, '..', relative), mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require: name => Object.hasOwn(replacements, name) ? replacements[name] : require(name), window: dom.window, document: dom.window.document, Event: dom.window.Event, fetch: mockFetch, console, setTimeout, clearTimeout, Date, JSON, BigInt, Promise, Error }, { filename });
  return mod.exports;
}
const container = ({ children }) => React.createElement('section', null, children), icon = () => null;
const Component = load('src/components/admin/subscribe-admin.tsx', {
  react: React, 'lucide-react': { Download: icon, Loader2: icon, RefreshCw: icon, Save: icon },
  '@/lib/constants': load('src/lib/constants.ts'),
  '@/lib/amounts': { formatAssetAmount: viem.formatUnits },
  '@/components/dapp/ui': { Card: container, DataRow: ({ label, value }) => React.createElement('p', { 'data-row': label }, label + ': ', value), Progress: () => null, SectionHead: ({ title }) => React.createElement('h2', null, title) },
}).default;
const root = createRoot(document.getElementById('root')), pause = () => new Promise(resolve => setTimeout(resolve, 30));
const byText = text => [...document.querySelectorAll('button,a')].find(element => element.textContent.includes(text));
async function click(element) { assert(element); await React.act(async () => { element.click(); await pause(); }); }
async function type(selector, value) { const input = document.querySelector(selector); assert(input); await React.act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await pause(); }); }
(async () => {
  try {
    await React.act(async () => { root.render(React.createElement(Component)); await pause(); });
    assert(document.body.textContent.includes('待补收货信息'));
    assert(document.body.textContent.includes('待发货'));
    assert(document.body.textContent.includes('用户自动组 LP'));
    assert(document.body.textContent.includes('已匹配'));
    assert(!document.body.textContent.includes('50000000000000000000'));
    pass('admin shows signed LP state, human-readable USDT and missing-shipping orders');
    await type('[aria-label="认购收款地址"]', B); await click(byText('保存收款地址'));
    assert.equal(settings.subscribePayee, B);
    assert(calls.some(call => call.url === '/api/subscribe/config'));
    assert(document.body.textContent.includes('已保存。'));
    pass('payee save is verified against the frontend configuration');
    await click(byText('开放认购')); assert.equal(settings.subscribeLocked, false);
    assert(byText('暂停认购'));
    pass('sales switch reflects the saved state');
    await click(byText('下一页')); assert(calls.some(call => call.url.includes('page=2')));
    pass('orders paginate through the backend');
    await click(byText('登记发货')); assert(document.body.textContent.includes('请填写物流公司'));
    await type('[aria-label="订单 o2 物流公司"]', '合成物流');
    await type('[aria-label="订单 o2 运单号"]', 'TEST-0001');
    shipError = true; await click(byText('登记发货')); assert(document.body.textContent.includes('模拟保存失败'));
    shipError = false; await click(byText('登记发货'));
    assert.equal(orders[1].status, 'shipped'); assert(document.body.textContent.includes('TEST-0001'));
    pass('shipping validates fields, reports save failure and renders saved tracking');
    await type('[aria-label="搜索认购单"]', '0x1111');
    await React.act(async () => { document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await pause(); });
    assert(calls.at(-1).url.includes('q=0x1111'));
    assert(byText('导出 CSV').getAttribute('href').includes('q=0x1111'));
    pass('search and export share the same query');
    console.log(checks + ' current subscribe admin checks passed.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { await React.act(async () => root.unmount()); dom.window.close(); }
})();
