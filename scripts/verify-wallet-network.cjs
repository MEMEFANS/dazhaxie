/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node test runner. */
// Synthetic providers and read-only RPC fixtures stay in this process only.
// This runner never connects to a public network, changes application records,
// requests a signature, or broadcasts a transaction.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ts = require('typescript');
const viem = require('viem');

const ROOT = path.resolve(__dirname, '..');
const ADDRESS_A = '0x1111111111111111111111111111111111111111';
const ADDRESS_B = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const GATEWAY = '0x4444444444444444444444444444444444444444';
let checks = 0;
function passed(name) { ++checks; console.log(`PASS ${name}`); }
function moduleFrom(file, replacements = {}, globals = {}) {
  const filename = path.join(ROOT, file);
  const javascript = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const runtimeModule = { exports: {} };
  vm.runInNewContext(javascript, {
    module: runtimeModule, exports: runtimeModule.exports,
    require: name => Object.hasOwn(replacements, name) ? replacements[name] : require(name),
    process: { env: {} }, setTimeout, clearTimeout, setInterval, clearInterval, console,
    URL, ...globals,
  }, { filename });
  return runtimeModule.exports;
}
function config(env = {}) {
  return moduleFrom('src/lib/chain-config.ts', {}, { process: { env } });
}
class Provider extends EventEmitter {
  accounts = [ADDRESS_A];
  chainId = '0x61';
  isMetaMask = true;
  async request({ method, params }) {
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return this.accounts;
    if (method === 'eth_chainId') return this.chainId;
    if (method === 'wallet_switchEthereumChain') {
      this.chainId = params[0].chainId;
      this.emit('chainChanged', this.chainId);
      return null;
    }
    throw new Error(`Unexpected fixture method: ${method}`);
  }
}
async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Fixture did not settle.');
}
async function main() {
  const defaults = config();
  assert.equal(defaults.chainConfig.id, 56);
  assert(Object.values(defaults.contracts).every(address => address === undefined));
  assert.equal(defaults.configIssues.length, 0);
  passed('unconfigured production defaults never reuse a testnet token');
  const testnet = config({ NEXT_PUBLIC_CHAIN_ID: '97', NEXT_PUBLIC_TRADING_MODE: 'gateway', NEXT_PUBLIC_TOKEN_ADDRESS: TOKEN, NEXT_PUBLIC_GATEWAY_ADDRESS: GATEWAY });
  assert.equal(testnet.chainConfig.id, 97);
  assert.equal(testnet.contracts.token, TOKEN);
  assert(testnet.chainConfig.rpcUrls.includes('https://bsc-testnet-rpc.publicnode.com'));
  assert(!testnet.chainConfig.rpcUrls.some(url => url.includes('prebsc-1-s1.binance.org')));
  assert.equal(testnet.getExplorerAddressUrl(TOKEN), `https://testnet.bscscan.com/address/${TOKEN}`);
  passed('configured testnet uses current RPCs and matching explorer links');

  const provider = new Provider();
  const window = { ethereum: provider };
  const wallet = moduleFrom('src/lib/wallet.ts', { './chain-config': testnet }, { window });
  const events = [];
  const off = wallet.onChange(connection => events.push(connection));
  const connected = await wallet.connect();
  assert.equal(connected.address, ADDRESS_A);
  assert.equal(connected.chainId, 97);
  assert.equal(await wallet.getChainId(), 97);
  assert.equal(provider.listenerCount('chainChanged'), 1);
  passed('ordinary wallet connection synchronizes account and network');
  const originalRequest = provider.request.bind(provider);
  let releaseChain;
  const oldChainRead = new Promise(resolve => { releaseChain = resolve; });
  provider.request = args => args.method === 'eth_chainId' ? oldChainRead : originalRequest(args);
  const readingChain = wallet.getChainId();
  provider.chainId = '0x38';
  provider.emit('chainChanged', provider.chainId);
  assert.equal(events.at(-1).address, ADDRESS_A);
  assert.equal(events.at(-1).chainId, 56);
  releaseChain('0x61');
  assert.equal(await readingChain, 56);
  provider.request = originalRequest;
  passed('a newer network event takes precedence over an older in-flight RPC read');
  assert.equal(await wallet.getChainId(), 56);
  passed('network-only changes notify subscribers without an account change');
  assert.equal(await wallet.switchChain(97), 97);
  assert.equal(events.at(-1).chainId, 97);
  provider.accounts = [ADDRESS_B];
  provider.emit('accountsChanged', provider.accounts);
  assert.equal(events.at(-1).address, ADDRESS_B);
  await wallet.disconnect();
  assert.equal(events.at(-1), null);
  for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) assert.equal(provider.listenerCount(event), 0);
  provider.emit('accountsChanged', [ADDRESS_A]);
  assert.equal(wallet.getConnection(), null);
  passed('switching and disconnecting update state and clean up provider listeners');
  const restored = await wallet.restore();
  assert.equal(restored.address, ADDRESS_B);
  assert.equal(restored.chainId, 97);
  wallet.destroy();
  off();
  assert.equal(provider.listenerCount('chainChanged'), 0);
  passed('silent restore reads the active network and destroy removes listeners');

  let releaseA;
  let balanceB = 42n;
  let requests = 0;
  const heldBalanceA = new Promise(resolve => { releaseA = resolve; });
  const rpc = {
    async getChainId() { ++requests; return 97; },
    async getBlockNumber() { return 123n; },
    async getCode() { return '0x6000'; },
    async readContract({ functionName, args = [] }) {
      const data = { name: 'CaBi', symbol: 'CaBi', decimals: 18, totalSupply: 1000000000n * 10n ** 18n,
        maxWalletAmount: 200000n * 10n ** 18n, owner: ADDRESS_A, isMaxWalletExempt: false,
        token: TOKEN, usdt: ADDRESS_B, pair: ADDRESS_A, dividendReceiver1: ADDRESS_A,
        dividendReceiver2: ADDRESS_B, dividendRate1Bps: 200n, dividendRate2Bps: 100n };
      if (functionName === 'balanceOf') {
        if (args[0].toLowerCase() === ADDRESS_A.toLowerCase()) return heldBalanceA;
        if (args[0].toLowerCase() === ADDRESS_B.toLowerCase()) return balanceB;
        return 7n;
      }
      return data[functionName];
    },
  };
  let currentStore;
  const react = {
    useMemo: factory => factory(),
    useSyncExternalStore: (subscribe, snapshot, serverSnapshot) => {
      currentStore = { subscribe, snapshot, serverSnapshot };
      return snapshot();
    },
  };
  const fakeViem = { ...viem, createPublicClient: () => rpc };
  const unloaded = moduleFrom('src/lib/chain-data.ts', { './chain-config': defaults, react, viem: fakeViem });
  assert.equal(unloaded.useTokenData().status, 'unconfigured');
  const unconfiguredOff = currentStore.subscribe(() => {});
  assert.equal(requests, 0);
  unconfiguredOff();
  passed('missing contract configuration performs no RPC reads and stays unconfigured');

  const data = moduleFrom('src/lib/chain-data.ts', { './chain-config': testnet, react, viem: fakeViem });
  data.useTokenData(ADDRESS_A);
  const storeA = currentStore;
  const offA = storeA.subscribe(() => {});
  try {
    assert.equal(data.useTokenData(ADDRESS_B).status, 'loading');
    const storeB = currentStore;
    const offB = storeB.subscribe(() => {});
    try {
      await until(() => storeB.snapshot().status === 'ready');
      assert.equal(storeB.snapshot().data.balance, 42n);
      releaseA(0n);
      await until(() => storeA.snapshot().status === 'ready');
      assert.equal(storeA.snapshot().data.balance, 0n);
      assert.equal(storeB.snapshot().data.balance, 42n);
      passed('delayed reads remain isolated per wallet and zero is a real balance');
      balanceB = 55n;
      data.useTokenData(ADDRESS_B).refresh();
      await until(() => storeB.snapshot().status === 'ready' && storeB.snapshot().data.balance === 55n);
      assert.equal(typeof storeB.snapshot().data.totalSupply, 'bigint');
      assert.equal(typeof storeB.snapshot().updatedAt, 'number');
      passed('manual refresh updates exact bigint balances and sync time');
      data.useGatewayData();
      const gatewayStore = currentStore;
      const offGateway = gatewayStore.subscribe(() => {});
      try {
        await until(() => gatewayStore.snapshot().status === 'ready');
        assert.equal(gatewayStore.snapshot().data.rate1Bps, 200n);
        assert.equal(gatewayStore.snapshot().data.rate2Bps, 100n);
        assert.equal(gatewayStore.snapshot().data.owner, ADDRESS_A);
        passed('dual-receiver configuration reads the configured gateway');
      } finally { offGateway(); }
    } finally { offB(); }
  } finally { offA(); }
  console.log(`${checks} isolated wallet/network/data checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
