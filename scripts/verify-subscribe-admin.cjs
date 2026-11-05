/* eslint-disable @typescript-eslint/no-require-imports -- Isolated real React DOM checks; no RPC, private files, or owner signing. */
// 用假 fetch 验证新认购后台：收款地址、开关、认购单、批次生成与登记，全程不接触私钥。
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), viem = require('viem');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const A = '0x1111111111111111111111111111111111111111', B = '0x2222222222222222222222222222222222222222';
const PAYEE = '0x3333333333333333333333333333333333333333', TX = '0x' + 'ab'.repeat(32), unit = 10n ** 18n;
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost:3000/admin/subscribe' });
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
    window: dom.window, document: dom.window.document, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent,
    fetch: (request, init) => mockFetch(request, init), console, setTimeout, clearTimeout, Date, JSON, BigInt, Promise, Error, encodeURIComponent,
  }, { filename });
  return runtimeModule.exports;
}

let calls = [], listData, batchesData, generateResponse, applyResponse, claimPoolData;
function order(id, address, shares, txHash) { return { id, address, shares, amount: String(BigInt(shares) * 50n * 10n ** 6n), txHash, status: 'confirmed', createdAt: 1700000000000 }; }
function resetData() {
  listData = { items: [order('o1', A, 2, TX), order('o2', B, 1, '0x' + 'cd'.repeat(32))], total: 12, page: 1, pageSize: 10, globalSold: 15000, hardCap: 20000, subscribeLocked: true, subscribePayee: PAYEE };
  batchesData = { items: [{ id: 'batch-1', status: 'pending', addresses: 2, total: String(70000n * unit), txHash: null, note: null, createdAt: 1700000000000, appliedAt: null }], total: 1, page: 1, pageSize: 10 };
  generateResponse = { status: 200, body: { batch: { id: 'batch-2', status: 'pending', addresses: 3, total: String(105000n * unit), txHash: null, note: null, createdAt: 1700000000000, appliedAt: null }, skipped: [A] } };
  applyResponse = { status: 200, body: { idempotent: false } };
  claimPoolData = { mode: 'legacy', pool: '0x4444444444444444444444444444444444444444', signing: { configured: false, signer: null, claimPool: null, chainId: 56, ttlSeconds: 600, rateLimitPerMinute: 5 }, entitlements: { total: '0', outstanding: '0', addresses: 0, rows: [] } };
  calls = [];
}
async function mockFetch(request, init) {
  const url = String(request), method = (init && init.method) || 'GET';
  calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined });
  const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  if (method === 'GET' && url.startsWith('/api/admin/subscriptions?')) {
    const q = new URLSearchParams(url.split('?')[1]).get('q') || '';
    const items = q ? listData.items.filter(row => row.address.includes(q) || row.txHash.includes(q)) : listData.items;
    return reply({ ...listData, items, total: q ? items.length : listData.total });
  }
  if (method === 'GET' && url === '/api/subscribe/config') return reply({ payee: listData.subscribePayee, locked: listData.subscribeLocked });
  if (method === 'GET' && url.startsWith('/api/admin/claim-batches?')) return reply(batchesData);
  if (method === 'GET' && url === '/api/admin/claim-pool') return reply(claimPoolData);
  if (method === 'POST' && url === '/api/admin/claim-pool') {
    const signer = JSON.parse(init.body).signer;
    return reply({ signer, calldata: '0x' + 'ab'.repeat(20), instruction: '由 owner 钱包调用 setSigner', audit: true });
  }
  if (method === 'POST' && url === '/api/admin/subscriptions') {
    const patch = JSON.parse(init.body);
    if (patch.subscribePayee !== undefined) listData.subscribePayee = patch.subscribePayee;
    if (patch.subscribeLocked !== undefined) listData.subscribeLocked = patch.subscribeLocked;
    return reply({ settings: { subscribePayee: listData.subscribePayee, subscribeLocked: listData.subscribeLocked } });
  }
  if (method === 'POST' && url === '/api/admin/claim-batches') return reply(generateResponse.body, generateResponse.status);
  if (method === 'POST' && url.includes('/apply')) return reply(applyResponse.body, applyResponse.status);
  throw new Error('unexpected request ' + method + ' ' + url);
}
const container = ({ children }) => React.createElement('section', null, children), icon = () => null;
const Component = load('src/components/admin/subscribe-admin.tsx', {
  react: React, 'lucide-react': { Download: icon, ExternalLink: icon, Loader2: icon, Play: icon, RefreshCw: icon, Save: icon },
  '@/lib/amounts': { formatAssetAmount: (amount, decimals) => viem.formatUnits(amount, decimals) },
  '@/components/dapp/ui': {
    Card: container, Badge: ({ children }) => React.createElement('span', { 'data-badge': true }, children),
    DataRow: ({ label, value }) => React.createElement('p', { 'data-row': label }, label + ': ', value),
    Progress: ({ value }) => React.createElement('div', { 'data-progress': true }, String(value)),
    SectionHead: ({ title }) => React.createElement('h2', null, title),
  },
}).default;
const rootHolder = { root: createRoot(document.getElementById('root')) }, pause = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));
async function render() { await React.act(async () => { rootHolder.root.render(React.createElement(Component)); await pause(40); }); }
const row = label => document.querySelector('[data-row="' + label + '"]').textContent;
const byText = text => Array.from(document.querySelectorAll('button,a')).find(element => element.textContent.trim().includes(text));
async function click(element, wait = 30) { assert(element, 'missing element'); await React.act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); await pause(wait); }); }
async function type(element, value) {
  assert(element, 'missing input');
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await pause();
  });
}

(async () => {
  try {
    resetData(); await render();
    assert(row('已认购 / 硬顶').includes('15000 / 20000'));
    assert(row('剩余额度').includes('5000'));
    assert(row('运营开关').includes('已暂停'));
    assert(row('已登记认购单').includes('12 笔'));
    assert.equal(document.querySelector('[data-progress]').textContent, '75');
    assert(row('当前地址').includes(PAYEE));
    assert(document.body.textContent.includes(A));
    assert(document.body.textContent.includes('batch-1'));
    assert.equal(calls[0].method, 'GET');
    pass('admin loads subscription totals, hard-cap progress, payee and claim batches from the server');

    const payeeInput = document.querySelector('[aria-label="认购收款地址"]');
    await type(payeeInput, B);
    await click(byText('保存收款地址'), 40);
    const save = calls.find(call => call.method === 'POST' && call.url === '/api/admin/subscriptions');
    assert.equal(save.body.subscribePayee, B);
    assert(document.body.textContent.includes('已保存。'));
    assert(row('当前地址').includes(B));
    pass('payee is saved through the server and the displayed value follows the saved settings');

    await click(byText('开放认购'), 40);
    const toggle = calls.filter(call => call.method === 'POST' && call.url === '/api/admin/subscriptions').at(-1);
    assert.equal(toggle.body.subscribeLocked, false);
    assert(row('运营开关').includes('开放中'));
    assert(byText('暂停认购'));
    pass('the operational subscribe switch round-trips through the admin API without touching any contract');

    await click(byText('下一页'), 40);
    const paged = calls.filter(call => call.method === 'GET' && call.url.includes('page=2')).at(-1);
    assert(paged, 'missing page 2 request');
    pass('pagination requests the next server page');

    const search = document.querySelector('[aria-label="搜索认购单"]');
    await type(search, '0x1111');
    await React.act(async () => { document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await pause(30); });
    const queryCall = calls.filter(call => call.method === 'GET' && call.url.includes('q=')).at(-1);
    assert(queryCall.url.includes('q=0x1111'));
    assert.equal(document.querySelectorAll('tbody tr').length, 1);
    const exportLink = byText('导出 CSV');
    assert(exportLink.getAttribute('href').includes('q=0x1111'));
    pass('search filters the server-side list and the CSV export keeps the same query');

    await click(byText('生成增量批次'), 60);
    const generated = calls.find(call => call.method === 'POST' && call.url === '/api/admin/claim-batches');
    assert.equal(generated.body.action, 'generate');
    assert(document.body.textContent.includes('batch-2'));
    assert(document.body.textContent.includes('已领取跳过 1 个'));
    assert(calls.some(call => call.method === 'GET' && call.url.includes('/api/admin/claim-batches?page=')), 'batch list must refresh after generating');
    pass('generating an incremental batch shows address count, total, skipped wallets and refreshes the list');

    const batchInput = document.querySelector('[aria-label="批次 batch-1 交易哈希"]');
    assert(batchInput, 'pending batch should offer a hash input');
    await click(byText('登记哈希'), 30);
    assert(document.querySelector('[role="alert"]').textContent.includes('有效的写入交易哈希'));
    assert(!calls.some(call => call.url.includes('/apply')) , 'invalid hash must not be posted');
    await type(batchInput, TX);
    await click(byText('登记哈希'), 50);
    const applied = calls.find(call => call.url.includes('/apply'));
    assert.equal(applied.body.txHash, TX);
    assert(document.body.textContent.includes('已登记交易哈希'));
    pass('a batch can only be marked applied with a valid transaction hash, then the list refreshes');

    applyResponse = { status: 200, body: { idempotent: false } };
    await click(byText('标记失败'), 50);
    const failed = calls.filter(call => call.url.includes('/apply')).at(-1);
    assert.equal(failed.body.status, 'failed');
    assert(document.body.textContent.includes('可重新生成批次'));
    applyResponse = { status: 200, body: { idempotent: true } };
    await click(byText('登记哈希'), 50);
    assert(document.body.textContent.includes('未产生重复发放'));
    pass('failed batches are recorded for retry, and idempotent re-registration is reported');

    generateResponse = { status: 409, body: { error: '没有需要新增的额度' } };
    await click(byText('生成增量批次'), 50);
    assert(document.querySelector('[role="alert"]').textContent.includes('没有需要新增的额度'));
    pass('batch generation errors surface the server reason instead of silently succeeding');

    // 签名自领模式：显示领取池指标、签名服务状态与自动聚合的待领额度，并提供带审计的权限交接。
    claimPoolData = {
      mode: 'signed', pool: A,
      chain: { owner: B, signer: '0x5555555555555555555555555555555555555555', usdt: PAYEE, lpReceiver: PAYEE, usdtDecimals: 6, poolBalance: String(500000n * unit), totalClaimed: '0', totalLpTokens: String(10500n * unit), totalUsdtCharged: String(15n * 10n ** 6n), allocatedUnclaimed: '0', unusedBalance: String(500000n * unit), lpReady: true },
      signing: { configured: true, signer: '0x5555555555555555555555555555555555555555', claimPool: A, chainId: 56, ttlSeconds: 600, rateLimitPerMinute: 5, signerMatches: true },
      entitlements: { total: String(70000n * unit), outstanding: String(70000n * unit), addresses: 2, rows: [{ address: A, tokens: String(35000n * unit), chainClaimed: '0', outstanding: String(35000n * unit), reason: ['认购单', '直推奖励'] }, { address: B, tokens: String(35000n * unit), chainClaimed: '0', outstanding: String(35000n * unit), reason: ['极差结算'] }] },
    };
    await React.act(async () => { rootHolder.root.unmount(); rootHolder.root = createRoot(document.getElementById('root')); await pause(40); });
    await render();
    assert(row('签名服务').includes('已配置'));
    assert(row('待领额度（服务器聚合）').includes('70000'));
    assert(row('链上 signer').includes('0x5555555555555555555555555555555555555555'));
    assert(document.body.textContent.includes('认购单') && document.body.textContent.includes('极差结算'));
    assert(!byText('生成增量批次'), 'signed mode must hide the legacy batch writer');
    pass('signed mode shows pool metrics, signer status and auto-aggregated entitlements without the legacy batch writer');

    const handoverInput = document.querySelector('[aria-label="新的 signer 地址"]');
    await type(handoverInput, '0x6666666666666666666666666666666666666666');
    const handoverButton = byText('提交交接');
    assert(handoverButton.disabled, 'handover requires explicit confirmation');
    await click(document.querySelector('[aria-label="确认权限交接"]'));
    assert(!byText('提交交接').disabled);
    await click(byText('提交交接'), 50);
    const handoverCall = calls.find(call => call.method === 'POST' && call.url === '/api/admin/claim-pool');
    assert.equal(handoverCall.body.action, 'handover');
    assert.equal(handoverCall.body.signer, '0x6666666666666666666666666666666666666666');
    assert(document.body.textContent.includes('已记录审计'));
    assert(document.body.textContent.includes('setSigner'));
    pass('signer handover requires a second confirmation, writes an audit and only returns calldata for the owner wallet');

    console.log(results.length + ' subscribe admin checks passed.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();
