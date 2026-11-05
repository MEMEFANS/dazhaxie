/* eslint-disable @typescript-eslint/no-require-imports -- Isolated ordinary-user UI lifecycle fixtures. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const C = '0x4444444444444444444444444444444444444444';
const PARENT = '0x3333333333333333333333333333333333333333';
const CODE = 'BCDE3456';
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost:3000/' });
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator });
const React = require('react');
const { createRoot } = require('react-dom/client');
const state = { connected: true, address: A, chainId: 56 };
const store = { state, hydrated: true, restored: true, connecting: false, connect() {}, disconnect() {} };
const config = { appChain: { id: 56 }, chainConfig: { id: 56 } };
const bindings = new Map([[A, true], [B, false], [C, false]]);
const calls = [], logins = [], binds = [], results = [];
let sessionAccount = A, fail = false, cancelLogin = false, pathname = '/', mount = 0;
let holdReads = false, heldReads = [], snapshot;

function accountData(account) {
  const bound = bindings.get(account) === true;
  return { account, code: account === A ? 'ABCD2345' : 'CDEF4567', referrerCode: bound ? CODE : null, referrer: bound ? PARENT : null, bound, root: false };
}
function response(body) { return { ok: true, json: async () => body }; }
async function fetchMock(url, options = {}) {
  calls.push({ url, options });
  if (fail) throw new Error('Temporary connection failure');
  let result;
  if (url === '/api/referral') {
    result = response({ session: sessionAccount ? { address: sessionAccount, chainId: 56 } : null, data: sessionAccount ? accountData(sessionAccount) : null });
  } else if (url.startsWith('/api/referral/status?')) {
    const account = new URL(url, 'http://localhost:3000').searchParams.get('account');
    result = response({ account, chainId: 56, bound: bindings.get(account) === true });
  } else {
    throw new Error('Unexpected fixture request: ' + url);
  }
  if (holdReads) return await new Promise(resolve => heldReads.push(() => resolve(result)));
  return result;
}
function load(file, replacements = {}) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(ROOT, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    module: loaded, exports: loaded.exports,
    require: name => Object.hasOwn(replacements, name) ? replacements[name] : require(name),
    fetch: fetchMock, window: dom.window, document: dom.window.document, Event: dom.window.Event,
    URL: dom.window.URL, URLSearchParams: dom.window.URLSearchParams, Error, console, setTimeout, clearTimeout,
  });
  return loaded.exports;
}
const referral = load('src/lib/referral.ts');
function newClient() {
  return load('src/lib/referral-data.ts', { react: React, './chain-config': config, './referral': referral, './wallet': {} });
}
let client = newClient();
const Gate = load('src/components/dapp/referral-gate.tsx', {
  react: React,
  'next/navigation': { usePathname: () => pathname },
  'next/image': { __esModule: true, default: () => null },
  'lucide-react': { KeyRound: () => null, Wallet: () => null },
  '@/lib/store': { useStore: () => store },
  '@/lib/chain-config': config,
  '@/lib/referral-data': {
    parseInvitation: referral.parseInvitation,
    useReferralData: account => { snapshot = client.useReferralData(account); return snapshot; },
    loginReferral: async (account, stillCurrent, code) => {
      logins.push({ account, code });
      assert.equal(stillCurrent(), true);
      if (cancelLogin) throw new Error('4001 User rejected signature');
      if (code) bindings.set(account, true);
      sessionAccount = account;
      client.refreshReferralData();
    },
    bindInvitation: async (account, code) => {
      binds.push({ account, code });
      bindings.set(account, true);
      client.refreshReferralData();
      return accountData(account);
    },
  },
}).ReferralGate;
const root = createRoot(document.getElementById('root'));
const pause = () => new Promise(resolve => setTimeout(resolve, 8));
const pass = name => { results.push(name); console.log('PASS ' + name); };
const dialog = () => document.querySelector('[data-referral-gate]');
const input = () => document.querySelector('#referral-input');
const business = () => document.querySelector('[data-business]');
const button = label => [...document.querySelectorAll('button')].find(item => item.textContent === label);
async function settle() { for (let i = 0; i < 3; i++) await React.act(async () => { await pause(); }); }
async function render() {
  await React.act(async () => root.render(React.createElement(Gate, { key: mount }, React.createElement('main', { 'data-business': true }, 'Business content'))));
  await settle();
}
async function refresh() { await React.act(async () => { await snapshot.refresh(); }); await settle(); }
async function click(label) {
  const target = button(label);
  assert(target, 'Missing button: ' + label);
  await React.act(async () => { target.click(); });
  await settle();
}
async function main() {
  await render();
  assert(business()); assert.equal(dialog(), null); assert.equal(input(), null);
  assert.equal(document.querySelector('[data-referral-session]'), null);
  assert.equal(document.body.style.overflow, '');
  assert.equal(calls.filter(call => call.url.startsWith('/api/referral/status')).length, 0);
  pass('A returning account with a valid session enters immediately without an invitation or sign-in prompt.');

  const aKey = 'cabi-referral-binding:56:' + A;
  const persisted = JSON.parse(window.localStorage.getItem(aKey));
  assert.equal(persisted.binding.bound, true);
  assert.equal(persisted.data, undefined);
  assert.equal(persisted.binding.code, undefined);
  pass('The persisted display cache contains binding status without session or referral details.');

  sessionAccount = null;
  await refresh();
  assert(business()); assert.equal(dialog(), null); assert.equal(input(), null);
  assert(button('签名登录')); assert.equal(snapshot.data, undefined);
  assert.equal(snapshot.binding.bound, true);
  assert.equal(document.body.style.overflow, '');
  pass('An expired session retains bound membership and shows only a nonblocking sign-in action.');

  window.history.replaceState({}, '', '/dapp/subscribe?ref=DEFG5678');
  pathname = '/dapp/subscribe'; await render();
  await click('签名登录');
  assert.equal(logins.at(-1).account, A);
  assert.equal(logins.at(-1).code, undefined);
  assert.equal(binds.length, 0);
  assert.equal(dialog(), null); assert.equal(document.querySelector('[data-referral-session]'), null);
  pass('Returning sign-in does not reuse an invitation from the current URL or attempt rebinding.');

  sessionAccount = null;
  window.localStorage.clear(); client = newClient(); mount++;
  await render();
  assert(business()); assert.equal(dialog(), null); assert(button('签名登录'));
  assert.equal(snapshot.binding.bound, true); assert.equal(snapshot.data, undefined);
  pass('A fresh browser discovers existing binding from the server without any local cache.');

  cancelLogin = true;
  await click('签名登录');
  assert(document.querySelector('[role="alert"]').textContent.includes('已取消签名'));
  assert(business()); assert.equal(dialog(), null); assert.equal(input(), null);
  assert.equal(document.body.style.overflow, '');
  cancelLogin = false; await click('签名登录');
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.equal(document.querySelector('[data-referral-session]'), null);
  pass('Canceling sign-in leaves the page available and a later retry restores the session.');

  fail = true; await refresh();
  assert.equal(snapshot.status, 'error'); assert.equal(snapshot.data, undefined);
  assert.equal(snapshot.binding.bound, true);
  assert(business()); assert.equal(dialog(), null); assert.equal(input(), null);
  assert(button('重新查询')); assert(window.localStorage.getItem(aKey));
  fail = false; await click('重新查询');
  assert.equal(snapshot.status, 'ready'); assert.equal(dialog(), null);
  pass('A temporary refresh failure keeps known binding, allows browsing, and recovers through retry.');

  state.address = B; await render();
  assert(dialog()); assert(input()); assert.equal(document.body.style.overflow, 'hidden');
  assert.equal(snapshot.binding.account, B); assert.equal(snapshot.binding.bound, false);
  assert(window.localStorage.getItem(aKey));
  state.address = A; await render();
  assert.equal(dialog(), null); assert(business()); assert.equal(document.body.style.overflow, '');
  assert.equal(snapshot.data.account, A);
  pass('A-to-B-to-A account switches show the correct binding form and preserve each account cache.');

  sessionAccount = null; state.address = B;
  window.history.replaceState({}, '', '/dapp/team?ref=' + CODE); pathname = '/dapp/team';
  await render();
  assert.equal(input().value, CODE);
  await React.act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  await settle();
  assert.equal(logins.at(-1).account, B); assert.equal(logins.at(-1).code, CODE);
  assert.equal(snapshot.data.bound, true); assert.equal(dialog(), null); assert(business());
  assert(window.localStorage.getItem(aKey));
  assert(window.localStorage.getItem('cabi-referral-binding:56:' + B));
  pass('A new unbound account still signs once with its invitation and enters after successful binding.');

  state.address = C; sessionAccount = null; fail = true;
  window.history.replaceState({}, '', '/dapp/token'); pathname = '/dapp/token';
  await render();
  assert(dialog()); assert.equal(input(), null);
  assert(document.querySelector('#referral-gate-title').textContent.includes('暂时无法读取账户'));
  fail = false; await click('重新查询');
  assert(input()); assert.equal(snapshot.binding.bound, false);
  pass('An unknown account with a network error receives a retry state instead of an invitation form.');

  state.address = A; sessionAccount = null;
  client = newClient(); mount++; holdReads = true;
  await render();
  assert.equal(snapshot.status, 'loading'); assert.equal(snapshot.data, undefined);
  assert.equal(snapshot.binding.bound, true); assert.equal(dialog(), null);
  assert.equal(document.body.style.overflow, '');
  holdReads = false;
  await React.act(async () => { for (const release of heldReads.splice(0)) release(); });
  await settle();
  assert.equal(snapshot.status, 'ready'); assert.equal(snapshot.data, undefined);
  assert.equal(snapshot.binding.bound, true); assert.equal(dialog(), null);
  pass('A full reload uses cached binding only for display while refreshing the actual session.');

  store.restored = false; state.connected = false; state.address = '';
  await render();
  assert(business()); assert.equal(dialog(), null); assert.equal(document.body.style.overflow, '');
  store.restored = true; await render();
  assert(dialog()); assert(button('连接钱包')); assert.equal(input(), null);
  assert.equal(document.body.style.overflow, 'hidden');
  state.connected = true; state.address = A; await render();
  assert(business()); assert.equal(dialog(), null); assert.equal(document.body.style.overflow, '');
  pass('Wallet restoration leaves scrolling enabled; only a visible connection or binding dialog locks it.');

  fs.mkdirSync(path.join(ROOT, 'output'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'output/referral-return-test-report.md'), [
    '# Returning referral account UI regression',
    '',
    'Command: `node scripts/verify-referral-return.cjs`',
    '',
    'All ' + results.length + ' checks passed using the actual React gate and referral hook with isolated synthetic account/API fixtures. No production data, real wallet signature, payment, or chain transaction was used.',
    '',
    ...results.map(result => '- ' + result),
    '',
  ].join('\n'));
  console.log(results.length + ' returning-account UI checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  holdReads = false; for (const release of heldReads.splice(0)) release();
  await React.act(async () => root.unmount());
  dom.window.close();
});
