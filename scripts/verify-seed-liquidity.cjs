/* eslint-disable @typescript-eslint/no-require-imports -- Local synthetic wallet UI and public-data fixtures only. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), viem = require('viem');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const owner = '0x1111111111111111111111111111111111111111', funder = '0x2222222222222222222222222222222222222222';
const token = '0x3333333333333333333333333333333333333333', pool = '0x4444444444444444444444444444444444444444';
const usdt = '0x5555555555555555555555555555555555555555', pair = '0x6666666666666666666666666666666666666666';
const unit = value => viem.parseUnits(String(value), 18);
function load(file, replacements) {
  const filename = path.join(root, file), mod = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(compiled, { module: mod, exports: mod.exports, require: name => replacements[name] || require(name), console, setTimeout, clearTimeout, window: global.window }, { filename });
  return mod.exports;
}
const config = { contracts: { token, claimPool: pool, usdt }, chainConfigurationValid: true, chainConfig: { id: 56, shortName: 'BSC', rpcUrls: ['https://fixture.invalid'] }, appChain: undefined, getExplorerAddressUrl: address => 'https://fixture.invalid/' + address };
let seeded = false;
const rpc = {
  getChainId: async () => 56, getBlockNumber: async () => 123n, getBlock: async () => ({ timestamp: 1000n }),
  async readContract({ address, functionName, args = [] }) {
    if (address === pool) return ({ token, usdt, tradingPair: pair, seedProvider: funder, previewSeed: [unit(100), unit(2600)] })[functionName];
    if (address === pair) return ({ token0: token, token1: usdt, totalSupply: seeded ? unit(2600) : 0n, balanceOf: seeded ? unit(2600) : 0n })[functionName];
    if (functionName === 'balanceOf') return args[0] === owner ? unit(1000000000) : address === token ? unit(70000) : unit(100);
    if (functionName === 'allowance') { assert.equal(args[0], funder); assert.equal(args[1], pool); return 0n; }
    return ({ owner, launchPool: pool, liquidityEnabled: true, isTradingOpen: false, tradingPair: pair, decimals: 18 })[functionName];
  },
};
async function main() {
  const dataModule = load('src/lib/seed-liquidity.ts', { './chain-config': config, viem: { ...viem, createPublicClient: () => rpc } });
  const live = await dataModule.fetchSeedLiquidityData();
  assert.equal(live.seedProvider, funder); assert.equal(live.tokenBalance, unit(70000)); assert.equal(live.usdtAmount, unit(100));
  assert.equal(live.minimumLp, unit(2574)); assert.equal(live.owner, owner);
  seeded = true; const done = await dataModule.fetchSeedLiquidityData(); assert.equal(done.seeded, true); assert.equal(done.lpBalance, unit(2600));
  console.log('PASS 独立页面从链上读取指定钱包资产、授权和LP余额，已建池时不再报价首次加池');

  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/liquidity/seed' });
  global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator });
  const React = require('react'), { createRoot } = require('react-dom/client');
  const store = { state: { connected: true, address: funder, chainId: 56 }, connect: async () => {} };
  let data = { ...live };
  const writes = [];
  const controller = { busy: false, transaction: null, run: async request => {
    await request.beforeSend?.(); writes.push(request);
    if (request.functionName === 'approve') {
      assert.equal(request.args[0], pool);
      if (request.address === token) data.tokenAllowance = request.args[1]; else data.usdtAllowance = request.args[1];
    }
    if (request.functionName === 'seedLiquidity') { data.seeded = true; data.lpBalance = unit(2600); }
    if (request.functionName === 'setSeedProvider') data.seedProvider = request.args[0];
    return '0x' + 'a'.repeat(64);
  } };
  const wrap = ({ children }) => React.createElement('section', null, children);
  const Component = load('src/components/dapp/token/seed-liquidity-page.tsx', {
    react: React, 'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    '@/lib/store': { useStore: () => store }, '@/lib/chain-config': config,
    '@/lib/seed-liquidity': { ...dataModule, fetchSeedLiquidityData: async () => ({ ...data }) },
    '@/lib/contract-transactions': { useContractTransaction: () => controller, TransactionFeedback: () => null },
    '@/lib/amounts': { formatAssetAmount: (amount, decimals) => viem.formatUnits(amount, decimals) },
    '@/components/dapp/ui': { Badge: wrap, Card: wrap, PageStack: wrap, PageHeader: ({ title }) => React.createElement('h1', null, title), DataRow: ({ label, value }) => React.createElement('p', null, label + ': ' + value) },
  }).default;
  const view = createRoot(document.getElementById('root'));
  const settle = () => new Promise(resolve => setTimeout(resolve, 5));
  const render = async () => {
    // Commit the mount first so its deferred initial fetch can run in the next act.
    await React.act(async () => { view.render(React.createElement(Component)); });
    await React.act(async () => { await settle(); });
  };
  const button = text => { const item = [...document.querySelectorAll('button')].find(b => b.textContent === text); assert(item, text); return item; };
  const click = element => React.act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); await settle(); });
  try {
    await render();
    assert.equal(button('3. 加入初始 LP').disabled, true);
    await click(button('1. 授权 70,000 CaBi'));
    assert.equal(writes[0].address, token); assert.equal(writes[0].args[1], unit(70000));
    await click(button('2. 授权 100 USDT'));
    assert.equal(writes[1].address, usdt); assert.equal(writes[1].args[1], unit(100));
    assert.equal(button('3. 加入初始 LP').disabled, false);
    await click(button('3. 加入初始 LP'));
    const seed = writes[2]; assert.equal(seed.address, pool); assert.equal(seed.functionName, 'seedLiquidity');
    assert.equal(seed.args[0], unit(70000)); assert.equal(seed.args[1], unit(100)); assert.equal(seed.args[2], unit(2574)); assert.equal(seed.args[3], 2200n);
    assert(document.body.textContent.includes('初始流动性已建立，LP 凭证由出资钱包保管'));
    console.log('PASS 指定钱包逐项精确授权并按固定金额首次加池，成功后不再显示加池按钮');

    data = { ...live, seedProvider: viem.zeroAddress, liquidityEnabled: false };
    store.state = { ...store.state, address: owner };
    await render();
    const input = document.querySelector('[aria-label="首次加池钱包地址"]'); assert(input);
    await React.act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, funder); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await settle(); });
    await click(button('确认指定钱包'));
    assert.equal(writes[3].functionName, 'setSeedProvider'); assert.equal(writes[3].args[0], funder);
    assert.equal(data.owner, owner);
    assert.equal(button('1. 授权 70,000 CaBi').disabled, true);
    console.log('PASS 管理员可以稍后指定地址，出资操作留给指定钱包');
  } finally { await React.act(async () => view.unmount()); dom.window.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
