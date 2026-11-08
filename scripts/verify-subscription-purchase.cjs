/* eslint-disable @typescript-eslint/no-require-imports -- Isolated real React DOM checks; no RPC, private files, or wallet signing. */
// 合成钱包 + 假 fetch：验证「USDT 直接转账 → 服务器核验记账」的前端流程，不发起真实交易。
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), viem = require('viem');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const A = '0x1111111111111111111111111111111111111111', B = '0x2222222222222222222222222222222222222222';
const USDT = '0x3333333333333333333333333333333333333333', PAYEE = '0x4444444444444444444444444444444444444444';
const hash = '0x' + 'ab'.repeat(32);
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost:3000/dapp/subscribe', pretendToBeVisual: true });
global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator });
dom.window.requestAnimationFrame = callback => setTimeout(() => callback(Date.now()), 0);
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
dom.window.Element.prototype.scrollIntoView = () => {};
const React = require('react'), { createRoot } = require('react-dom/client');
const results = [];
function pass(name) { results.push(name); console.log('PASS ' + name); }
const MODULE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs'], loadCache = new Map();
function load(file, replacements = {}) {
  const filename = path.isAbsolute(file) ? file : path.join(ROOT, file), cached = loadCache.get(filename);
  if (cached) return cached.exports;
  const runtimeModule = { exports: {} };
  loadCache.set(filename, runtimeModule);
  const javascript = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const resolve = name => {
    if (Object.hasOwn(replacements, name)) return replacements[name];
    let target;
    if (name.startsWith('.')) target = path.resolve(path.dirname(filename), name);
    else if (name.startsWith('@/')) target = path.join(ROOT, 'src', name.slice(2));
    if (target) {
      if (name.endsWith('.css')) return {};
      const extension = MODULE_EXTENSIONS.find(item => fs.existsSync(target + item));
      if (extension) return load(target + extension, replacements);
    }
    return require(name);
  };
  vm.runInNewContext(javascript, {
    module: runtimeModule, exports: runtimeModule.exports, require: resolve,
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, Event: dom.window.Event,
    URL: dom.window.URL, URLSearchParams: dom.window.URLSearchParams,
    requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: id => clearTimeout(id),
    fetch: (request, init) => mockFetch(request, init), console, setTimeout, clearTimeout, Error, Promise, Date, JSON, BigInt,
  }, { filename });
  return runtimeModule.exports;
}

const store = { state: { connected: true, address: A, chainId: 56 }, connect() {} };
const configQuery = { status: 'ready', data: undefined, refresh() { configRefreshes++; } };
let freshConfig;
const ordersQuery = { orders: [], refresh() { orderRefreshes++; } };
let configRefreshes = 0, orderRefreshes = 0, version = 0, writes = [], requests = [], txResult = hash;
let balanceValue = 1000n * 10n ** 6n, serverResponse = { status: 200, body: { order: { id: 'o1' } } };
const relation = { account: A, code: 'ABCD2345', referrerCode: 'BCDE3456', referrer: B, bound: true, root: false };
const referralQuery = { status: 'ready', data: relation };
async function mockFetch(request, init) {
  requests.push({ url: String(request), init });
  return { ok: serverResponse.status >= 200 && serverResponse.status < 300, status: serverResponse.status, json: async () => serverResponse.body };
}
function fixture() {
  return {
    configured: true, enabled: true, locked: false, payee: PAYEE, usdt: USDT, token: '0x5555555555555555555555555555555555555555',
    chainId: 56, unitPrice: 50, tokensPerShare: 35000, minShares: 1, maxShares: 2, hardCap: 20000, softCap: 10000,
    globalSold: 120, remainingGlobal: 19880, purchased: 0, remainingPersonal: 2, usdtDecimals: 6, tokenDecimals: 18, message: '',
    priceTiers: [{ until: 5000, price: 50 }, { until: 10000, price: 55 }, { until: 15000, price: 60 }, { until: 20000, price: 70 }],
  };
}
const tx = { transaction: null, busy: false, clear() { tx.transaction = null; }, acknowledge() {}, resume: async () => txResult, run: async request => { if (request.beforeSend) await request.beforeSend(); writes.push(request); return txResult; } };
const container = ({ children }) => React.createElement('section', null, children);
const icon = () => null;
const Component = load('src/components/dapp/subscribe/purchase-panel.tsx', {
  react: React, viem, 'lucide-react': new Proxy({}, { get: (target, key) => typeof key === 'symbol' ? undefined : icon }),
  'next/link': { __esModule: true, default: ({ href, children, ...rest }) => React.createElement('a', { href, ...rest }, children) },
  '@/lib/store': { useStore: () => store },
  '@/lib/chain-config': { chainConfig: { id: 56, shortName: 'BSC' }, getExplorerTxUrl: hash => 'https://bscscan.com/tx/' + hash },
  '@/lib/transaction-cancellation': { isUserCancelledError: error => error instanceof Error && /rejected|denied|4001/i.test(error.message) },
  '@/lib/amounts': { formatAssetAmount: (amount, decimals) => viem.formatUnits(amount, decimals) },
  '@/lib/subscribe-data': {
    fetchSubscribeConfig: async () => freshConfig || { ...configQuery.data },
    useSubscribeConfig: () => configQuery,
    useSubscribeOrders: () => ordersQuery,
    fetchUsdtBalance: async () => balanceValue,
  },
  '@/lib/referral-data': { useReferralData: () => referralQuery, fetchReferralData: async () => ({ ...relation }) },
  '@/lib/contract-transactions': { useContractTransaction: scope => { assert.equal(scope, 'subscribe-transfer'); return tx; }, TransactionFeedback: () => null },
  '@/components/dapp/ui': {
    Card: container, Badge: container, DataRow: ({ label, value }) => React.createElement('p', { 'data-row': label }, label + ': ', value),
    QtyStepper: ({ value, onDecrease, onIncrease }) => React.createElement('div', null,
      React.createElement('button', { onClick: onDecrease, 'aria-label': '减少认购份数' }, '−'),
      React.createElement('span', { 'data-quantity': true }, value),
      React.createElement('button', { onClick: onIncrease, 'aria-label': '增加认购份数' }, '+')),
  },
}).PurchasePanel;
const root = createRoot(document.getElementById('root'));
const pause = (ms = 12) => new Promise(resolve => setTimeout(resolve, ms));
async function render() { await React.act(async () => { root.render(React.createElement(Component, { key: version })); await pause(); }); }
async function reset() {
  dom.window.localStorage.clear();
  store.state = { connected: true, address: A, chainId: 56 };
  configQuery.status = 'ready'; delete configQuery.error; configQuery.data = fixture();
  freshConfig = undefined;
  ordersQuery.orders = []; referralQuery.status = 'ready'; referralQuery.data = relation;
  writes.length = 0; requests.length = 0; balanceValue = 1000n * 10n ** 6n; txResult = hash;
  serverResponse = { status: 200, body: { order: { id: 'o1' } } };
  configRefreshes = 0; orderRefreshes = 0; tx.transaction = null; tx.busy = false; version++;
  await render();
}
const action = () => document.querySelector('button.btn-gold'), radio = shares => document.querySelector('[aria-label="认购 ' + shares + ' 份"]');
function setInput(selector, value) {
  const input = document.querySelector(selector);
  assert(input, 'missing input ' + selector);
  const prototype = input.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter.call(input, value);
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}
async function fillShipping() {
  await React.act(async () => { await pause(20); });
  await React.act(async () => {
    setInput('input[autocomplete="name"]', '测试收货人');
    setInput('input[autocomplete="tel"]', '13800138000');
    setInput('textarea[autocomplete="street-address"]', '测试省测试市测试路 1 号');
    await pause();
  });
}
async function click(element, wait = 24) {
  assert(element, 'missing element');
  await React.act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); await pause(wait); });
}

(async () => {
  try {
    await reset();
    assert(document.body.textContent.includes('50USDT') || /50\s*USDT/.test(document.body.textContent));
    assert(/35000\s*CaBi/.test(document.body.textContent));
    assert(document.body.textContent.includes('领取到账 · 70%'));
    assert(document.body.textContent.includes('24500'));
    assert(document.body.textContent.includes('组建流动性 · 30%'));
    assert(document.body.textContent.includes('10500'));
    assert(document.body.textContent.includes(PAYEE));
    assert.equal(action().disabled, false);
    assert.equal(action().textContent, '确认认购');
    pass('panel shows the configured payee, 50 USDT/share and the single 30% LP / 70% payout path');

    await click(action(), 60);
    assert.equal(writes.length, 1);
    const write = writes[0];
    assert.equal(write.address.toLowerCase(), USDT.toLowerCase());
    assert.equal(write.functionName, 'transfer');
    assert.equal(write.args[0].toLowerCase(), PAYEE.toLowerCase());
    assert.equal(write.args[1], 50n * 10n ** 6n);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/subscribe/orders');
    assert.equal(requests[0].init.method, 'POST');
    assert.equal(JSON.parse(requests[0].init.body).shares, 1);
    assert.equal(JSON.parse(requests[0].init.body).hash, hash);
    assert.equal(JSON.parse(requests[0].init.body).shipping, undefined);
    assert(document.body.textContent.includes('认购已登记'));
    assert(document.body.textContent.includes('蟹礼收货信息待补填'));
    assert.equal(configRefreshes, 1);
    assert.equal(orderRefreshes, 1);
    pass('payment immediately registers shares even when shipping has not been filled');

    ordersQuery.orders = [{ id: 'o1', shares: 1, amount: '50000000', txHash: hash, status: 'confirmed', createdAt: Date.now() }];
    await render();
    const shippingDetails = Array.from(document.querySelectorAll('summary')).find(item => item.textContent.includes('待补收货信息'));
    assert(shippingDetails, 'missing shipping editor');
    await click(shippingDetails);
    await React.act(async () => {
      setInput('details input[autocomplete="name"]', '测试收货人');
      setInput('details input[autocomplete="tel"]', '13800138000');
      setInput('details textarea', '测试省测试市测试路 1 号');
      await pause();
    });
    const shippingForm = shippingDetails.parentElement.querySelector('form');
    serverResponse = { status: 200, body: { order: { ...ordersQuery.orders[0], shipping: { name: '测试收货人', phone: '13800138000', address: '测试省测试市测试路 1 号' } } } };
    await React.act(async () => { shippingForm.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await pause(30); });
    assert.equal(requests.at(-1).init.method, 'PATCH');
    assert.equal(JSON.parse(requests.at(-1).init.body).id, 'o1');
    assert(document.body.textContent.includes('收货信息已提交，待安排发货'));
    assert(document.body.textContent.includes('蟹礼收货信息已保存'));
    assert(document.querySelector('a[href*="category=after-sales"][href*="order=o1"]'));
    pass('confirmed orders can add shipping later without another payment');

    await reset();
    ordersQuery.orders = [{ id: 'o2', shares: 1, amount: '50000000', txHash: hash, status: 'confirmed', createdAt: Date.now() }];
    await render(); await fillShipping();
    const topShippingForm = document.querySelector('details form');
    serverResponse = { status: 503, body: { error: '暂时无法提交，请重试' } };
    await React.act(async () => { topShippingForm.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await pause(30); });
    assert(document.body.textContent.includes('暂时无法提交，请重试'));
    assert.equal(document.querySelector('input[autocomplete="name"]').value, '测试收货人');
    serverResponse = { status: 200, body: { order: { ...ordersQuery.orders[0], shipping: { name: '测试收货人', phone: '13800138000', address: '测试省测试市测试路 1 号' } } } };
    await React.act(async () => { topShippingForm.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await pause(30); });
    assert.equal(writes.length, 0);
    assert(requests.every(request => request.init.method === 'PATCH'));
    assert(document.body.textContent.includes('收货信息提交成功'));
    assert(document.body.textContent.includes('收货信息已提交，待安排发货'));
    pass('upper shipping form submits to an existing order, keeps input on failure and updates the receipt on retry');

    await reset(); await fillShipping();
    await React.act(async () => { document.querySelector('details form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await pause(); });
    assert.equal(requests.length, 0);
    assert.equal(writes.length, 0);
    assert(document.body.textContent.includes('认购成功后会随订单提交'));
    pass('pre-purchase shipping confirmation clearly waits for payment instead of claiming server submission');

    await reset(); await fillShipping(); freshConfig = { ...fixture(), payee: B };
    await click(action(), 60);
    assert.equal(writes.length, 0);
    assert.equal(requests.length, 0);
    assert(configRefreshes > 0);
    assert(document.body.textContent.includes('认购收款地址或金额已更新'));
    pass('an updated server payee refreshes the page before any wallet transfer');

    await reset(); await fillShipping(); serverResponse = { status: 202, body: { error: '等待区块确认' } };
    await click(action(), 60);
    assert(requests[0].url === '/api/subscribe/orders');
    assert(document.body.textContent.includes('等待区块确认'));
    version++; await render();
    await React.act(async () => { await pause(30); });
    assert(document.body.textContent.includes('上一笔付款已确认'));
    const retry = Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('查询认购结果'));
    assert(retry, 'missing query button');
    serverResponse = { status: 200, body: { order: { id: 'o1' } } };
    await click(retry, 60);
    assert.equal(writes.length, 1, 'recheck must not transfer again');
    assert.equal(requests.length, 2);
    assert(document.body.textContent.includes('认购已登记'));
    pass('a 202 verification survives remount and rechecks without another payment');

    await reset(); await fillShipping(); serverResponse = { status: 409, body: { error: '该交易哈希已登记过认购' } };
    await click(action(), 60);
    assert(document.body.textContent.includes('该交易哈希已登记过认购'));
    assert(document.querySelector('[data-kind="registration-failed"]'), 'missing failed registration status');
    assert.equal(requests.length, 1);
    pass('a rejected verification surfaces the server reason and does not create a local order');

    await reset(); configQuery.data.purchased = 1; await render();
    assert.equal(radio(2).disabled, true);
    assert(document.body.textContent.includes('剩余可购份额不足'));
    assert.equal(action().disabled, false);
    pass('the per-wallet 1-2 share cap disables the unavailable option and keeps the allowed one');

    await reset(); referralQuery.data = { ...relation, bound: false }; await render();
    assert(action().textContent.includes('邀请入口'));
    assert.equal(action().disabled, true);
    await click(action()); assert.equal(writes.length, 0);
    pass('an unbound wallet cannot subscribe');

    await reset(); configQuery.data.enabled = false; configQuery.data.locked = true; await render();
    assert(action().textContent.includes('认购暂时关闭'));
    assert.equal(action().disabled, true);
    pass('the operational subscribe lock disables the transfer path');

    await reset(); store.state = { connected: false, address: '', chainId: 0 }; version++; await render();
    assert(action().textContent.includes('连接钱包'));
    assert(document.body.textContent.includes('连接钱包'));
    pass('disconnected wallets are told to connect before any transfer');

    await reset(); ordersQuery.orders = [{ id: 'o1', shares: 2, amount: '100000000', txHash: hash, status: 'confirmed', createdAt: Date.now() }]; await render();
    assert(document.body.textContent.includes('我的认购记录'));
    assert(document.body.textContent.includes('份生态份额'));
    pass('recorded orders are rendered as subscription receipts with their transaction hash');

    console.log(results.length + ' subscription purchase checks passed.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();
