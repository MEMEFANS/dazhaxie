/* eslint-disable @typescript-eslint/no-require-imports -- Isolated real React DOM checks; no RPC, private files, or wallet signing. */
// 合成钱包 + 假 fetch：验证「USDT 直接转账 → 服务器核验记账」的前端流程，不发起真实交易。
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), viem = require('viem');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const A = '0x1111111111111111111111111111111111111111', B = '0x2222222222222222222222222222222222222222';
const USDT = '0x3333333333333333333333333333333333333333', PAYEE = '0x4444444444444444444444444444444444444444';
const hash = '0x' + 'ab'.repeat(32);
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost:3000/dapp/subscribe' });
global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator });
const React = require('react'), { createRoot } = require('react-dom/client');
const results = [];
function pass(name) { results.push(name); console.log('PASS ' + name); }
function load(file, replacements = {}) {
  const filename = path.join(ROOT, file), runtimeModule = { exports: {} };
  const javascript = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(javascript, {
    module: runtimeModule, exports: runtimeModule.exports,
    require: name => Object.hasOwn(replacements, name) ? replacements[name] : require(name),
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, Event: dom.window.Event,
    fetch: (request, init) => mockFetch(request, init), console, setTimeout, clearTimeout, Error, Promise, Date, JSON, BigInt,
  }, { filename });
  return runtimeModule.exports;
}

const store = { state: { connected: true, address: A, chainId: 56 }, connect() {} };
const configQuery = { status: 'ready', data: undefined, refresh() { configRefreshes++; } };
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
  };
}
const tx = { transaction: null, busy: false, run: async request => { if (request.beforeSend) await request.beforeSend(); writes.push(request); return txResult; } };
const container = ({ children }) => React.createElement('section', null, children);
const icon = () => null;
const Component = load('src/components/dapp/subscribe/purchase-panel.tsx', {
  react: React, viem, 'lucide-react': { Check: icon, Copy: icon, Wallet: icon },
  '@/lib/store': { useStore: () => store },
  '@/lib/chain-config': { chainConfig: { id: 56, shortName: 'BSC' } },
  '@/lib/amounts': { formatAssetAmount: (amount, decimals) => viem.formatUnits(amount, decimals) },
  '@/lib/subscribe-data': {
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
  store.state = { connected: true, address: A, chainId: 56 };
  configQuery.status = 'ready'; delete configQuery.error; configQuery.data = fixture();
  ordersQuery.orders = []; referralQuery.status = 'ready'; referralQuery.data = relation;
  writes.length = 0; requests.length = 0; balanceValue = 1000n * 10n ** 6n; txResult = hash;
  serverResponse = { status: 200, body: { order: { id: 'o1' } } };
  configRefreshes = 0; orderRefreshes = 0; tx.transaction = null; tx.busy = false; version++;
  await render();
}
const action = () => document.querySelector('button.btn-gold'), checkbox = () => document.querySelector('input[type="checkbox"]');
const row = label => document.querySelector('[data-row="' + label + '"]').textContent;
async function click(element, wait = 24) {
  assert(element, 'missing element');
  await React.act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); await pause(wait); });
}

(async () => {
  try {
    await reset();
    assert(row('本次应付').includes('50 USDT'));
    assert(row('代币配额').includes('35000 CaBi'));
    assert(row('直接领取到账').includes('17500 CaBi（50%）'));
    assert(row('组 LP 领取到账').includes('24500 CaBi（70%）'));
    assert(row('USDT 余额').includes('1000 USDT'));
    assert.equal(document.querySelector('[data-referral-code]').textContent, 'BCDE3456');
    assert(document.body.textContent.includes(PAYEE));
    assert.equal(action().disabled, true);
    await click(checkbox());
    assert.equal(action().disabled, false);
    assert.equal(action().textContent, '确认转账认购');
    pass('panel shows the configured payee, 50 USDT/share, 50%/70% payouts and requires explicit confirmation');

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
    assert(document.body.textContent.includes('认购单已登记'));
    assert.equal(checkbox().checked, false);
    assert.equal(document.querySelector('[data-quantity]').textContent, '1');
    assert.equal(configRefreshes, 1);
    assert.equal(orderRefreshes, 1);
    pass('confirmation sends USDT directly to the payee and posts the hash to the server ledger without any sale contract');

    await reset(); await click(checkbox()); serverResponse = { status: 202, body: { error: '等待区块确认' } };
    await click(action(), 60);
    assert(requests[0].url === '/api/subscribe/orders');
    assert(document.body.textContent.includes('等待区块确认'));
    assert.equal(action().textContent, '等待服务器核验');
    const retry = Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('重新核验'));
    assert(retry, 'missing retry button');
    serverResponse = { status: 200, body: { order: { id: 'o1' } } };
    await click(retry, 60);
    assert.equal(writes.length, 1, 'recheck must not transfer again');
    assert.equal(requests.length, 2);
    assert(document.body.textContent.includes('认购单已登记'));
    pass('a 202 verification keeps the hash for a transfer-free recheck that completes without paying twice');

    await reset(); await click(checkbox()); serverResponse = { status: 409, body: { error: '该交易哈希已登记过认购' } };
    await click(action(), 60);
    assert(document.body.textContent.includes('该交易哈希已登记过认购'));
    assert.equal(document.querySelector('[role="alert"]').textContent.includes('该交易哈希'), true);
    pass('a rejected verification surfaces the server reason and does not create a local order');

    await reset(); configQuery.data.purchased = 1; configQuery.data.remainingPersonal = 1; await render();
    await click(document.querySelector('[aria-label="增加认购份数"]'));
    assert.equal(document.querySelector('[data-quantity]').textContent, '2');
    await click(checkbox());
    assert(action().textContent.includes('超过此钱包剩余认购份数'));
    assert.equal(action().disabled, true);
    pass('per-wallet 1-2 share cap is enforced in the UI and blocks submission');

    await reset(); balanceValue = 49n * 10n ** 6n; configQuery.data.globalSold += 1; await render(); await click(checkbox());
    assert.equal(action().textContent, 'USDT 余额不足');
    pass('insufficient USDT balance blocks the transfer before signing');

    await reset(); referralQuery.data = { ...relation, bound: false }; await render(); await click(checkbox());
    assert(action().textContent.includes('邀请入口'));
    assert.equal(action().disabled, true);
    await click(action()); assert.equal(writes.length, 0);
    pass('an unbound wallet cannot subscribe even after confirming the transfer');

    await reset(); configQuery.data.enabled = false; configQuery.data.locked = true; await render(); await click(checkbox());
    assert(action().textContent.includes('认购暂时关闭'));
    pass('the operational subscribe lock disables the transfer path');

    await reset(); store.state = { connected: false, address: '', chainId: 0 }; version++; await render();
    assert(action().textContent.includes('请连接钱包'));
    assert(document.body.textContent.includes('连接钱包'));
    pass('disconnected wallets are told to connect before any transfer');

    await reset(); ordersQuery.orders = [{ id: 'o1', shares: 2, amount: '100000000', txHash: hash, status: 'confirmed', createdAt: Date.now() }]; await render();
    assert(document.body.textContent.includes('我的认购凭证'));
    assert(document.body.textContent.includes('2 份'));
    pass('recorded orders are rendered as subscription receipts with their transaction hash');

    console.log(results.length + ' subscription purchase checks passed.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();
