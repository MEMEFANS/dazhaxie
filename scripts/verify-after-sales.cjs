/* eslint-disable @typescript-eslint/no-require-imports -- Isolated synthetic orders and local support workflow; no real user data or network. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript'), { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const buyer = '0x1111111111111111111111111111111111111111';
const subscriptionId = '11111111-2222-4333-8444-555555555555', exchangeId = buyer + 'a'.repeat(24);
fs.mkdirSync(path.join(ROOT, 'output/qa'), { recursive: true });
const dataDir = fs.mkdtempSync(path.join(ROOT, 'output/qa/synthetic-after-sales-'));
class AdminRequestError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
function load(relative, replacements = {}, globals = {}) {
  const filename = path.join(ROOT, relative), runtime = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { module: runtime, exports: runtime.exports, require: name => Object.hasOwn(replacements, name) ? replacements[name] : require(name), process: { env: {} }, console, Error, Request, Response, URLSearchParams, setTimeout, clearTimeout, ...globals }, { filename });
  return runtime.exports;
}
const support = load('src/lib/support.ts');
const database = load('src/lib/server/community-db.ts', {
  'server-only': {}, '../support': support, './admin-session': { AdminRequestError },
  './admin-db': { adminDataDirectory: () => dataDir, readOperationalSettings: () => ({ sensitiveWords: [] }) },
});
const orders = new DatabaseSync(':memory:');
orders.exec('CREATE TABLE subscription_orders(id TEXT, address TEXT, chain_id INTEGER); CREATE TABLE redemption_orders(id TEXT, address TEXT, chain_id INTEGER);');
orders.prepare('INSERT INTO subscription_orders VALUES(?,?,?)').run(subscriptionId, buyer, 56);
orders.prepare('INSERT INTO redemption_orders VALUES(?,?,?)').run(exchangeId, buyer, 56);
const references = load('src/lib/server/ticket-orders.ts', {
  'server-only': {}, '../support': support, './admin-session': { AdminRequestError },
  './subscription-db': { subscriptionDatabase: () => orders }, './redemption-db': { redemptionDatabase: () => orders },
});
const route = load('src/app/api/tickets/route.ts', {
  '@/lib/server/community-auth': { requireCommunityWallet: async () => ({ address: buyer, chainId: 56 }) },
  '@/lib/server/community-db': database, '@/lib/server/ticket-orders': references,
  '@/lib/server/admin-session': {
    assertSameOrigin: () => {}, readJsonObject: request => request.json(),
    adminErrorResponse: error => Response.json({ error: error.message }, { status: error.status || 500 }),
  },
});
async function submit(body) {
  const response = await route.POST(new Request('http://synthetic.test/api/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  const result = await response.json();
  assert.equal(response.status, 200, result.error);
  return result;
}
async function main() {
  const original = database.createTicket(buyer, { category: '认购问题', title: '模拟历史工单', content: '用于核对原有工单保留。' });
  const { ticket } = await submit({ category: '售后服务', title: '模拟物流查询', content: '请核对这份模拟蟹礼的物流安排。', order: { type: 'subscribe', id: subscriptionId } });
  assert.equal(ticket.category, '售后服务'); assert.equal(ticket.status, 'pending');
  assert(ticket.content.includes(subscriptionId)); assert(ticket.content.includes('认购蟹礼售后'));
  assert.equal(database.listTickets({ q: subscriptionId }).items[0].id, ticket.id);
  database.replyToTicket(ticket.id, 'synthetic-support', '模拟回复：已核对物流，请查看订单信息。');
  database.setTicketStatus(ticket.id, 'processed');
  let own = (await (await route.GET()).json()).tickets;
  assert.equal(own.find(item => item.id === ticket.id).replies[0].content, '模拟回复：已核对物流，请查看订单信息。');
  assert.equal(own.find(item => item.id === ticket.id).status, 'processed');
  assert(own.some(item => item.id === original.id));
  console.log('PASS 认购售后落库、后台按订单号查询和回复、用户查看处理状态，原工单保留');

  const exchanged = await submit({ category: '售后服务', title: '模拟商品问题', content: '这是一条独立测试用的商品反馈。', order: { type: 'exchange', id: exchangeId } });
  assert(exchanged.ticket.content.includes('兑换蟹礼售后')); assert(exchanged.ticket.content.includes(exchangeId));
  assert(support.afterSalesUrl({ type: 'exchange', id: exchangeId }).includes('order=' + exchangeId));
  console.log('PASS 兑换订单售后保留来源和完整订单号');

  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://synthetic.test/dapp/support?category=after-sales' });
  global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator });
  const React = require('react'), { createRoot } = require('react-dom/client');
  const store = { state: { connected: true, address: buyer, chainId: 56 }, connect: async () => {} };
  const category = load('src/components/dapp/support/category-picker.tsx', { '@/lib/support': support });
  let requests = 0, submitted = 0, fail = true;
  const { TicketForm } = load('src/components/dapp/support/ticket-form.tsx', {
    react: React, '@/lib/store': { useStore: () => store }, '@/lib/support': support, './category-picker': category,
    '@/lib/community-client': {
      signInCommunity: async address => { assert.equal(address, buyer); },
      communityRequest: async (url, options) => { assert.equal(url, '/api/tickets'); requests++; if (fail) throw new Error('模拟连接中断，请重试'); return submit(JSON.parse(options.body)); },
    },
    '@/components/dapp/ui': { SectionTitle: ({ title }) => React.createElement('h2', null, title), TxStatus: () => null },
  }, { window: dom.window, Event: dom.window.Event });
  const root = createRoot(document.getElementById('root'));
  const settle = () => new Promise(resolve => setTimeout(resolve, 5));
  const button = label => { const found = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === label); assert(found, label); return found; };
  const click = element => React.act(async () => { element.click(); await settle(); });
  try {
    await React.act(async () => root.render(React.createElement(TicketForm, { initialCategory: '售后服务', order: { type: 'subscribe', id: subscriptionId }, onSubmitted: () => submitted++ })));
    assert.equal(button('提交售后申请').disabled, true);
    await click(button('物流查询'));
    await React.act(async () => {
      const element = document.querySelector('textarea');
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(element, '这是模拟订单，请查询配送进度。');
      element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await click(button('提交售后申请'));
    assert.equal(requests, 1);
    assert(document.body.textContent.includes('模拟连接中断，请重试'));
    assert.equal(document.querySelector('textarea').value, '这是模拟订单，请查询配送进度。');
    fail = false;
    await click(button('提交售后申请'));
    assert.equal(requests, 2); assert.equal(submitted, 1);
    assert(document.body.textContent.includes('售后申请已提交'));
    assert.equal(document.querySelector('textarea').value, '');
    own = database.listTicketsFor(buyer);
    assert(own.some(item => item.title === '物流查询' && item.content.includes(subscriptionId)));
    console.log('PASS 售后页面带入订单、选择问题、保留失败草稿、重试后展示真实工单号');
  } finally { await React.act(async () => root.unmount()); dom.window.close(); }
  fs.writeFileSync(path.join(dataDir, 'report.json'), JSON.stringify({ synthetic: true, tests: 'passed', noNetwork: true, noRealUserRecords: true }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { orders.close(); database.communityDatabase().close(); });
