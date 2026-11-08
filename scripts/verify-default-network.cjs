/* eslint-disable @typescript-eslint/no-require-imports -- Real React DOM with a synthetic wallet; no wallet requests leave this process. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost:3000/subscribe' });
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator });
const React = require('react');
const { createRoot } = require('react-dom/client');
const A = '0x1111111111111111111111111111111111111111';
let pathname = '/subscribe', revision = 0, calls = [], notices = [], behavior;
const store = { state: { connected: true, address: A, chainId: 56 }, hydrated: true, connecting: false, connect() {}, showToast(message) { notices.push(message); } };
const mocks = {
  react: React,
  'next/image': { __esModule: true, default: () => null },
  'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
  'next/dynamic': { __esModule: true, default: () => () => null },
  'next/navigation': { usePathname: () => pathname },
  'lucide-react': new Proxy({}, { get: () => () => null }),
  '@/lib/store': { useStore: () => store },
  '@/lib/constants': { shortAddr: value => value },
  '@/lib/support': { afterSalesUrl: () => '/support?category=after-sales' },
  '@/lib/chain-config': { chainConfig: { id: 56, shortName: 'BSC 主网', isTestnet: false } },
  '@/lib/wallet': { switchChain: async id => { calls.push(id); return behavior(); } },
  '@/components/dapp/referral-gate': { ReferralGate: ({ children }) => children },
  './shell.module.css': {},
};
const file = path.resolve(__dirname, '../src/components/dapp/shell.tsx');
const moduleState = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, {
  module: moduleState, exports: moduleState.exports,
  require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Error, console,
}, { filename: file });
const Shell = moduleState.exports.DAppShell;
const root = createRoot(document.getElementById('root'));
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function render() {
  await React.act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Shell, { key: revision }, '认购页面'))); });
  await React.act(pause);
}
function reset(chainId = 56, connected = true) {
  revision++; calls = []; notices = []; pathname = '/subscribe';
  store.hydrated = true; store.state = { connected, address: connected ? A : '', chainId };
  behavior = async () => { store.state.chainId = 56; return 56; };
}
async function main() {
  reset(1, false); await render(); assert.equal(calls.length, 0);
  reset(56); await render(); assert.equal(calls.length, 0);
  console.log('PASS disconnected wallets and wallets already on BSC receive no network popup');

  reset(1); await render(); assert.deepEqual(calls, [56]);
  assert(notices.includes('已切换至 BSC 主网'));
  console.log('PASS entering with a restored wallet on another network requests BSC once under Strict Mode');

  reset(0); await render(); assert.equal(calls.length, 0);
  store.state.chainId = 8453; await render(); assert.deepEqual(calls, [56]);
  console.log('PASS automatic switching waits until the real wallet network is known');

  reset(1); behavior = async () => { throw new Error('用户已取消切换'); };
  await render(); assert.deepEqual(calls, [56]);
  pathname = '/token'; await render(); await render();
  assert.deepEqual(calls, [56]); assert(notices.includes('用户已取消切换'));
  console.log('PASS cancelling keeps the actual network and route changes do not reopen the request');

  behavior = async () => { store.state.chainId = 56; return 56; };
  const retry = [...document.querySelectorAll('button')].find(button => button.textContent.includes('切换至 BSC 主网'));
  assert(retry && !retry.disabled);
  await React.act(async () => { retry.click(); await pause(); });
  assert.deepEqual(calls, [56, 56]);
  console.log('PASS the manual network button can retry after a cancelled automatic switch');

  store.state = { connected: false, address: '', chainId: 0 }; await render();
  store.state = { connected: true, address: A, chainId: 1 }; await render();
  assert.deepEqual(calls, [56, 56, 56]);
  console.log('PASS reconnecting starts a new automatic switch attempt');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await React.act(async () => root.unmount()); dom.window.close();
});
