/* eslint-disable @typescript-eslint/no-require-imports -- Isolated local contract verification. */
// Synthetic Ganache accounts only. No .env, keys, public RPC or live deployment.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), solc = require('solc');
process.env.UWS_USE_FALLBACK ??= '1';
const ganache = require('ganache');
const { createPublicClient, createWalletClient, custom, parseUnits, parseEventLogs, encodeFunctionData } = require('viem');
const ROOT = path.resolve(__dirname, '..'), ZERO = '0x0000000000000000000000000000000000000000', DEAD = '0x000000000000000000000000000000000000dEaD';
const units = (amount, decimals = 18) => parseUnits(String(amount), decimals), results = [];
function pass(name) { results.push({ name, valid: true }); console.log('PASS ' + name); }
function compile() {
 const sources = {};
 for (const file of ['CaBiClaimPool.sol', 'XBTSale.sol', 'CaBiPancakeToken.sol', 'test/TestUSDT.sol']) sources[file] = { content: fs.readFileSync(path.join(ROOT, 'contracts', file), 'utf8') };
 sources['ClaimFixture.sol'] = { content: `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract ClaimFixture {
 uint8 public immutable decimals; mapping(address=>uint256) public balanceOf; mapping(address=>mapping(address=>uint256)) public allowance;
 bool public noReturn; uint8 public behavior; address public callback; bytes public payload;
 bool public callbackTransfer; bool public callbackTransferFrom; bool public callbackBlocked; uint256 public callbackCount;
 constructor(uint8 precision){decimals=precision;}
 function mint(address to,uint256 amount) external {balanceOf[to]+=amount;}
 function reduce(address from,uint256 amount) external {balanceOf[from]-=amount;}
 function setBehavior(uint8 value,bool emptyReturn) external {behavior=value;noReturn=emptyReturn;}
 function setCallback(address target,bytes calldata data,bool onTransfer,bool onTransferFrom) external {callback=target;payload=data;callbackTransfer=onTransfer;callbackTransferFrom=onTransferFrom;callbackBlocked=false;}
 function invoke(address target,bytes calldata data) external {(bool ok,)=target.call(data);require(ok,"invoke failed");}
 function approve(address spender,uint256 amount) external returns(bool){allowance[msg.sender][spender]=amount;return true;}
 function transfer(address to,uint256 amount) external returns(bool){move(msg.sender,to,amount);if(callbackTransfer)hook();if(noReturn){assembly{return(0,0)}}return behavior!=1;}
 function transferFrom(address from,address to,uint256 amount) external returns(bool){require(allowance[from][msg.sender]>=amount,"allowance");allowance[from][msg.sender]-=amount;move(from,to,amount);if(callbackTransferFrom)hook();if(noReturn){assembly{return(0,0)}}return behavior!=1;}
 function move(address from,address to,uint256 amount) private {require(behavior!=2,"fixture transfer reverted");require(balanceOf[from]>=amount,"balance");if(behavior==4)return;balanceOf[from]-=amount;balanceOf[to]+=behavior==3?amount-amount/100:amount;}
 function hook() private {if(callback==address(0))return;callbackCount++;(bool ok,)=callback.call(payload);callbackBlocked=!ok;}
}
contract FakePool {address public immutable token;address public immutable sale;constructor(address t,address s){token=t;sale=s;}}
` };
 const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } })));
 const errors = (output.errors || []).filter(item => item.severity === 'error'); assert.equal(errors.length, 0, errors.map(item => item.formattedMessage).join(' | '));
 for (const [file, name] of [['CaBiClaimPool.sol', 'CaBiClaimPool'], ['XBTSale.sol', 'XBTSale']]) assert(output.contracts[file][name].evm.deployedBytecode.object.length / 2 < 24576);
 return (file, name) => ({ abi: output.contracts[file][name].abi, bytecode: '0x' + output.contracts[file][name].evm.bytecode.object });
}
function dex(packageName, name) { const a = require(packageName + '/build/' + name + '.json'), b = typeof a.bytecode === 'string' ? a.bytecode : a.evm.bytecode.object; return { abi: a.abi, bytecode: b.startsWith('0x') ? b : '0x' + b }; }
async function withChain(name, action) {
 const provider = ganache.provider({ logging: { quiet: true }, wallet: { deterministic: true, totalAccounts: 20 }, chain: { chainId: 31337, hardfork: 'shanghai' }, miner: { timestampIncrement: 0 } });
 const chain = { id: 31337, name, nativeCurrency: { name: 'Isolated Test', symbol: 'TEST', decimals: 18 }, rpcUrls: { default: { http: [] } } };
 const rpc = createPublicClient({ chain, transport: custom(provider), pollingInterval: 10 }), wallet = createWalletClient({ chain, transport: custom(provider) }), accounts = await wallet.getAddresses();
 const deploy = async (entry, args = [], account = accounts[0], expected = 'success') => { const hash = await wallet.deployContract({ ...entry, args, account, gas: 12000000n }), r = await rpc.waitForTransactionReceipt({ hash }); assert.equal(r.status, expected, 'deployment'); return { address: r.contractAddress, abi: entry.abi }; };
 const send = async (c, functionName, args = [], account = accounts[0], expected = 'success') => { const hash = await wallet.writeContract({ ...c, functionName, args, account, gas: 12000000n }), r = await rpc.waitForTransactionReceipt({ hash }); assert.equal(r.status, expected, functionName); return r; };
 const fail = (c, name, args = [], account = accounts[0]) => send(c, name, args, account, 'reverted'), read = (c, functionName, args = []) => rpc.readContract({ ...c, functionName, args });
 const balance = (asset, address) => read(asset, 'balanceOf', [address]);
 const timestamp = async () => (await rpc.getBlock({ blockTag: 'latest' })).timestamp;
 const at = async time => { await provider.request({ method: 'evm_setTime', params: [Number(time * 1000n)] }); await provider.request({ method: 'evm_mine', params: [] }); assert.equal(await timestamp(), time); };
 try { await action({ provider, accounts, rpc, deploy, send, fail, read, balance, timestamp, at }); } finally { await provider.disconnect(); }
}
const ceil = (n, d) => n / d + (n % d === 0n ? 0n : 1n);
function sqrt(value) { if (value < 2n) return value; let x = value, y = (x + 1n) / 2n; while (y < x) { x = y; y = (x + value / x) / 2n; } return x; }
async function setup(artifact, decimals, ctx, feeOn = false, fixtureQuote = false) {
 const { accounts, deploy, send, read, balance, timestamp } = ctx;
 const [deployer, owner, alice, bob, carol, david, project, fund, receiver1, receiver2, nextOwner, outsider, capHolder, erin, frank, feeTo] = accounts;
 const token = await deploy(artifact('CaBiPancakeToken.sol', 'CaBiPancakeToken'), [receiver1, receiver2, deployer]);
 const quote = await deploy(artifact(fixtureQuote ? 'ClaimFixture.sol' : 'test/TestUSDT.sol', fixtureQuote ? 'ClaimFixture' : 'TestUSDT'), [decimals]);
 const factory = await deploy(dex('@uniswap/v2-core', 'UniswapV2Factory'), [deployer]);
 const router = await deploy(dex('@uniswap/v2-periphery', 'UniswapV2Router02'), [factory.address, quote.address]);
 if (feeOn) await send(factory, 'setFeeTo', [feeTo]);
 await send(factory, 'createPair', [token.address, quote.address]);
 const pair = { address: await read(factory, 'getPair', [token.address, quote.address]), abi: dex('@uniswap/v2-core', 'UniswapV2Pair').abi };
 const sale = await deploy(artifact('XBTSale.sol', 'XBTSale'), [quote.address, token.address, project, fund]);
 const pool = await deploy(artifact('CaBiClaimPool.sol', 'CaBiClaimPool'), [token.address, sale.address, owner]);
 await send(sale, 'setClaimPool', [pool.address]);
 await send(token, 'setMaxWalletExempt', [pool.address, true]);
 const fundPool = async (amount = units(550000)) => send(token, 'transfer', [pool.address, amount]);
 const configure = async () => {
  await send(token, 'setMaxWalletExempt', [pair.address, true]);
  await send(quote, 'mint', [deployer, units(10000, decimals)]);
  await send(token, 'approve', [router.address, units(1000000)]);
  await send(quote, 'approve', [router.address, units(10000, decimals)]);
  await send(router, 'addLiquidity', [token.address, quote.address, units(1000000), units(10000, decimals), 0n, 0n, deployer, await timestamp() + 86400n]);
  await send(token, 'configureTrading', [router.address, quote.address, pair.address]);
  await send(token, 'setSwapSettings', [units(1000), units(5000), 500n, false]);
 };
 const prepare = async (users = [alice, bob, carol, david, capHolder, erin, frank]) => {
  for (const who of users) { await send(quote, 'mint', [who, units(1000, decimals)]); await send(quote, 'approve', [sale.address, units(1000, decimals)], who); }
 };
 const subscribe = (user, quantity = 1n, ref = ZERO) => send(sale, 'subscribe', [quantity, ref], user);
 const open = async () => { const start = await timestamp() + 100n; await send(pool, 'setClaimStartsAt', [Number(start)], owner); await ctx.at(start); return start; };
 const checked = async (user, mode, overrides = {}) => {
  const entitlement = await read(pool, 'claimable', [user]), start = await read(pool, 'claimStartsAt'), receiver = await read(pool, 'lpReceiver');
  const preview = mode === 1 ? await read(pool, 'previewClaim', [user, mode]) : undefined;
  return [mode, overrides.amount ?? entitlement, overrides.start ?? Number(start), overrides.receiver ?? receiver, overrides.max ?? (mode === 1 ? preview[4] : 0n), overrides.min ?? (mode === 1 ? preview[5] : 0n), overrides.deadline ?? (mode === 1 ? await timestamp() + 1200n : 0n)];
 };
 const reserves = async () => { const r = await read(pair, 'getReserves'), token0 = await read(pair, 'token0'); return token0.toLowerCase() === token.address.toLowerCase() ? [r[0], r[1]] : [r[1], r[0]]; };
 const snapshot = async user => ({
  sale: await Promise.all(['claimed', 'lpCredited', 'purchased', 'rewardShares', 'claimableOf'].map(name => read(sale, name, [user]))),
  reserved: await read(sale, 'reservedTokens'),
  pool: await Promise.all(['poolBalance', 'totalAllocated', 'unusedBalance', 'totalClaimed', 'totalBurned', 'totalLpTokens', 'totalLiquidityMinted'].map(name => read(pool, name))),
  user: await Promise.all(['claimed', 'settled', 'claimable'].map(name => read(pool, name, [user]))),
  tokens: await Promise.all([user, pool.address, DEAD, token.address, pair.address, project].map(address => balance(token, address))),
  quote: await Promise.all([user, pool.address, pair.address, token.address, receiver1, receiver2, project, fund].map(address => balance(quote, address))),
  quoteAllowance: await read(quote, 'allowance', [user, pool.address]),
  tax: await Promise.all([read(token, 'totalPendingDividends'), read(token, 'pendingDividends', [receiver1]), read(token, 'pendingDividends', [receiver2]), read(token, 'allowance', [token.address, router.address])]),
  lp: await Promise.all([read(pair, 'getReserves'), read(pair, 'totalSupply'), read(pair, 'kLast'), balance(pair, project), balance(pair, user), balance(pair, feeTo)]),
 });
 const revertedClaim = async (user, args, reason) => { const before = await snapshot(user); await ctx.fail(pool, 'claimChecked', args, user); assert.deepEqual(await snapshot(user), before, reason + ' must restore sale/pool/tax/USDT/LP state'); };
 return { ...ctx, decimals, token, quote, factory, router, pair, sale, pool, deployer, owner, alice, bob, carol, david, project, fund, receiver1, receiver2, nextOwner, outsider, capHolder, erin, frank, feeTo, fundPool, configure, prepare, subscribe, open, checked, reserves, snapshot, revertedClaim };
}
async function verifySaleClaims(artifact, decimals) {
 await withChain('Isolated dual mode subscription claims', async ctx => {
  const f = await setup(artifact, decimals, ctx), { deploy, send, fail, read, balance, at, timestamp, provider, token, quote, sale, pool, pair, router, owner, deployer, alice, bob, carol, david, project, outsider, capHolder, nextOwner, fund } = f;
  const label = decimals + '-decimal USDT: ';
  assert.equal(await read(pool, 'claimStartsAt'), 0n); assert.equal(await read(pool, 'lpReceiver'), ZERO); assert.equal(await read(pool, 'directRatio'), 50n); assert.equal(await read(pool, 'lpRatio'), 70n);
  assert.equal((await read(pool, 'token')).toLowerCase(), token.address.toLowerCase()); assert.equal((await read(pool, 'sale')).toLowerCase(), sale.address.toLowerCase()); assert.equal((await read(pool, 'usdt')).toLowerCase(), quote.address.toLowerCase());
  assert(!pool.abi.some(entry => ['batchSetClaimable', 'setDirectRatio', 'setLpRatio'].includes(entry.name)));
  for (const args of [[ZERO, sale.address, owner], [token.address, ZERO, owner], [token.address, sale.address, ZERO], [quote.address, sale.address, owner]]) await deploy(artifact('CaBiClaimPool.sol', 'CaBiClaimPool'), args, deployer, 'reverted');
  await fail(sale, 'setClaimPool', [pool.address]); await f.prepare(); await fail(sale, 'subscribe', [1n, ZERO], alice); assert.equal(await read(sale, 'globalSold'), 0n); assert.equal(await balance(quote, fund), 0n);
  await f.fundPool(units(500000)); await send(token, 'transfer', [owner, units(50000)]); await fail(pool, 'deposit', [units(50000)], owner); await send(token, 'approve', [pool.address, units(50000)], owner); await send(pool, 'deposit', [units(50000)], owner);
  await f.subscribe(alice); assert.equal(await read(pool, 'claimable', [alice]), units(35000)); assert.equal(await read(sale, 'fundingBalance'), units(550000)); assert.equal(await read(sale, 'poolBalance'), 0n); assert.equal(await balance(quote, fund), units(50, decimals)); assert.equal(await read(pool, 'totalAllocated'), units(35000));
  pass(label + 'one-time sale binding automatically creates exact obligations in the separately funded pool with fixed 50/70 modes');

  await fail(pool, 'claim', [0], alice); await fail(pool, 'claim', [1], alice); await fail(sale, 'claim', [], alice); await fail(sale, 'claimChecked', [project, 0n], alice); await fail(sale, 'consumeClaim', [alice, units(35000)], alice);
  for (const [name, args] of [['setClaimStartsAt', [0]], ['setLpReceiver', [project]], ['deposit', [1n]], ['withdrawUnused', [1n, outsider]], ['transferOwnership', [outsider]]]) await fail(pool, name, args, outsider);
  await fail(pool, 'setClaimStartsAt', [Number(await timestamp())], owner); await fail(pool, 'setClaimStartsAt', [Number(await timestamp() - 1n)], owner);
  const firstStart = await timestamp() + 100n; await send(pool, 'setClaimStartsAt', [Number(firstStart)], owner); await at(firstStart - 1n); await fail(pool, 'claimChecked', await f.checked(alice, 0), alice); await at(firstStart);
  assert.equal(await read(pool, 'tradingPair'), ZERO); const direct = await read(pool, 'previewClaim', [alice, 0]); assert.deepEqual(direct.slice(0, 6), [units(35000), units(17500), units(17500), 0n, 0n, 0n]);
  const deadBefore = await balance(token, DEAD), quoteBefore = await balance(quote, alice); const directReceipt = await send(pool, 'claimChecked', await f.checked(alice, 0), alice);
  assert.equal(await balance(token, alice), units(17500)); assert.equal(await balance(token, DEAD), deadBefore + units(17500)); assert.equal(await balance(quote, alice), quoteBefore); assert.equal(await read(pool, 'settled', [alice]), units(35000)); assert.equal(await read(pool, 'claimed', [alice]), units(17500)); assert.equal(await read(sale, 'claimed', [alice]), units(35000)); assert.equal(await read(pool, 'totalBurned'), units(17500));
  assert.equal(parseEventLogs({ abi: token.abi, eventName: 'SellFeeCharged', logs: directReceipt.logs }).length, 0); await fail(pool, 'claim', [0], alice);
  pass(label + 'default closed and future-only time gate enforce exact-boundary 50% payout plus 50% burn without LP, USDT or receiver setup');

  await f.configure(); for (const target of [ZERO, DEAD, pool.address, token.address, sale.address, quote.address, pair.address, router.address]) await fail(pool, 'setLpReceiver', [target], owner); await fail(pool, 'setLpReceiver', [project], outsider); await send(pool, 'setLpReceiver', [project], owner);
  await f.subscribe(bob, 2n, alice); await f.subscribe(carol, 1n, alice); await f.subscribe(alice); assert.equal(await read(sale, 'rewardShares', [alice]), 1n); assert.equal(await read(pool, 'claimable', [alice]), units(70000));
  const lpQuote = await read(pool, 'previewClaim', [bob, 1]); assert.equal(lpQuote[0], units(70000)); assert.equal(lpQuote[1], units(49000)); assert.equal(lpQuote[2], 0n); assert.equal(lpQuote[3], units(21000));
  const [rt, rq] = await f.reserves(), net = lpQuote[3] * 97n / 100n; assert.equal(lpQuote[4], ceil(net * rq, rt)); const projectBefore = await balance(pair, project), deadBeforeLp = await balance(token, DEAD), poolBeforeLp = await read(pool, 'poolBalance'), quoteBeforeLp = await balance(quote, bob);
  await send(quote, 'approve', [pool.address, lpQuote[4]], bob); const lpReceipt = await send(pool, 'claimChecked', await f.checked(bob, 1), bob); const lpEvent = parseEventLogs({ abi: pool.abi, eventName: 'LiquidityCreated', logs: lpReceipt.logs })[0].args;
  assert.equal(lpEvent.receiver.toLowerCase(), project.toLowerCase()); assert.equal(lpEvent.grossTokens, units(21000)); assert.equal(lpEvent.netTokens, net); assert.equal(lpEvent.usdtPaid, lpQuote[4]); assert.equal(lpEvent.liquidity, lpQuote[5]); assert.equal(await balance(pair, project), projectBefore + lpEvent.liquidity); assert.equal(await balance(pair, bob), 0n); assert.equal(await balance(token, bob), units(49000)); assert.equal(await balance(token, DEAD), deadBeforeLp + units(630)); assert.equal(await balance(quote, bob), quoteBeforeLp - lpQuote[4]); assert.equal(await read(pool, 'poolBalance'), poolBeforeLp - units(70000)); assert.equal(await read(pool, 'settled', [bob]), units(70000)); assert.equal(await read(sale, 'claimed', [bob]), units(70000)); assert.equal(await read(pool, 'claimable', [bob]), 0n); await fail(pool, 'claim', [0], bob);
  pass(label + 'LP claim pays 70%, sells gross 30% with normal 3% burn tax, matches net CaBi in live USDT and mints real project-owned V2 LP');

  await send(quote, 'approve', [pool.address, units(1000, decimals)], carol);
  const q = await read(pool, 'previewClaim', [carol, 1]);
  for (const [overrides, reason] of [[{ max: 0n }, 'zero max'], [{ min: 0n }, 'zero min'], [{ deadline: 0n }, 'zero deadline'], [{ deadline: await timestamp() }, 'expired deadline'], [{ deadline: await timestamp() + 1801n }, 'excessive deadline'], [{ max: q[4] - 1n }, 'USDT maximum'], [{ min: q[5] + 1n }, 'LP minimum'], [{ amount: q[0] + 1n }, 'stale entitlement'], [{ start: Number(firstStart + 1n) }, 'stale opening'], [{ receiver: outsider }, 'stale LP receiver']]) await f.revertedClaim(carol, await f.checked(carol, 1, overrides), reason);
  await f.revertedClaim(carol, [2, q[0], Number(firstStart), project, q[4], q[5], await timestamp() + 1200n], 'invalid mode');
  await f.revertedClaim(carol, await f.checked(carol, 0, { max: 1n }), 'direct mode rejects LP parameters');
  await send(quote, 'approve', [pool.address, 0n], carol); await f.revertedClaim(carol, await f.checked(carol, 1), 'insufficient allowance'); await send(quote, 'approve', [pool.address, units(1000, decimals)], carol);
  const walletQuote = await balance(quote, carol); await send(quote, 'transfer', [deployer, walletQuote], carol); await f.revertedClaim(carol, await f.checked(carol, 1), 'insufficient USDT balance'); await send(quote, 'mint', [carol, walletQuote]);
  pass(label + 'invalid mode, deadline, max USDT, min LP, stale quotes and missing USDT roll back sale, pool, taxes, approvals and pair state');

  const clean = await provider.request({ method: 'evm_snapshot', params: [] }); await send(token, 'transfer', [pair.address, units(1)]); await f.revertedClaim(carol, [1, q[0], Number(firstStart), project, q[4], q[5], await timestamp() + 1200n], 'dirty token reserves'); assert.equal(await provider.request({ method: 'evm_revert', params: [clean] }), true);
  const cleanQuote = await provider.request({ method: 'evm_snapshot', params: [] }); await send(quote, 'mint', [pair.address, units(1, decimals)]); await f.revertedClaim(carol, [1, q[0], Number(firstStart), project, q[4], q[5], await timestamp() + 1200n], 'dirty USDT reserves'); assert.equal(await provider.request({ method: 'evm_revert', params: [cleanQuote] }), true);
  pass(label + 'unaccounted token or USDT pair donations cannot be absorbed into a claimant LP mint');

  await f.subscribe(carol); await f.revertedClaim(carol, [1, units(35000), Number(firstStart), project, q[4], q[5], await timestamp() + 1200n], 'entitlement increased');
  const nextStart = await timestamp() + 100n; await send(pool, 'setClaimStartsAt', [Number(nextStart)], owner); await f.revertedClaim(carol, await f.checked(carol, 1, { start: Number(firstStart) }), 'schedule replaced'); await at(nextStart); await send(pool, 'setLpReceiver', [outsider], owner); await f.revertedClaim(carol, await f.checked(carol, 1, { receiver: project }), 'receiver replaced'); await send(pool, 'setLpReceiver', [project], owner);
  await send(pool, 'claimChecked', await f.checked(carol, 1), carol); await send(pool, 'claim', [0], alice); assert.equal(await read(pool, 'settled', [alice]), units(105000)); assert.equal(await read(pool, 'claimed', [alice]), units(52500));
  await send(sale, 'batchCreditTeamReward', [[alice], [1n]]); assert.equal(await read(pool, 'claimable', [alice]), units(35000)); await send(pool, 'claim', [0], alice); assert.equal(await read(pool, 'settled', [alice]), units(140000)); assert.equal(await read(pool, 'claimed', [alice]), units(70000));
  pass(label + 'later purchases and referral or ledger rewards create new remaining rights; amount, time and receiver changes invalidate prior approvals');

  await f.subscribe(capHolder); await send(token, 'transfer', [capHolder, units(190000)]); await send(quote, 'approve', [pool.address, units(1000, decimals)], capHolder); await f.revertedClaim(capHolder, await f.checked(capHolder, 1), 'LP payout holding cap'); await f.revertedClaim(capHolder, await f.checked(capHolder, 0), 'direct payout holding cap'); await send(token, 'transfer', [outsider, units(20000)], capHolder); await send(pool, 'claimChecked', await f.checked(capHolder, 1), capHolder); assert.equal(await balance(token, capHolder), units(194500));
  pass(label + 'holding-cap failure rolls back burned tokens, LP mint, USDT spend and consumed sale rights in both modes');

  await f.subscribe(david); const reserved = await read(pool, 'totalAllocated'), unused = await read(pool, 'unusedBalance'); await fail(pool, 'withdrawUnused', [unused + 1n, deployer], owner); await send(pool, 'withdrawUnused', [unused, deployer], owner); assert.equal(await read(pool, 'poolBalance'), reserved);
  const fundsBefore = await balance(quote, fund); await fail(sale, 'subscribe', [1n, ZERO], f.erin); assert.equal(await balance(quote, fund), fundsBefore); assert.equal(await read(sale, 'purchased', [f.erin]), 0n); await fail(sale, 'batchCreditTeamReward', [[f.erin], [1n]]);
  await send(token, 'transfer', [sale.address, units(100)]); await send(sale, 'setSubscribeLocked', [true]); const deadBeforeFinalize = await balance(token, DEAD); await send(sale, 'finalize'); assert.equal(await balance(token, DEAD), deadBeforeFinalize + units(100)); assert.equal(await read(pool, 'poolBalance'), reserved); assert.equal(await read(pool, 'totalAllocated'), reserved); await fail(sale, 'setSubscribeLocked', [false]); await send(pool, 'claim', [0], david); assert.equal(await read(pool, 'totalAllocated'), 0n); assert.equal(await read(pool, 'poolBalance'), 0n);
  pass(label + 'reserved backing cannot be withdrawn or oversold and sale finalization preserves delayed claims');

  await send(pool, 'transferOwnership', [nextOwner], owner); await fail(pool, 'acceptOwnership', [], outsider); await send(pool, 'acceptOwnership', [], nextOwner); await fail(pool, 'setLpReceiver', [project], owner); await send(pool, 'setClaimStartsAt', [0], nextOwner); assert.equal(await read(pool, 'pendingOwner'), ZERO);
  pass(label + 'pool ownership stays two-step and former owners cannot change LP or opening settings');
 });
}
async function verifyFeeOnSwapback(artifact, decimals) {
 await withChain('Isolated fee-on and swapback LP claims', async ctx => {
  const f = await setup(artifact, decimals, ctx, true), { send, read, balance, timestamp, token, quote, pool, pair, router, alice, bob, outsider, owner, project, feeTo } = f;
  const label = decimals + '-decimal USDT fee-on: ';
  await f.configure(); await f.fundPool(); await f.prepare(); await f.subscribe(alice); await f.subscribe(bob); await f.open();
  await send(quote, 'mint', [outsider, units(2000, decimals)]); await send(quote, 'approve', [router.address, units(2000, decimals)], outsider);
  await send(router, 'swapExactTokensForTokensSupportingFeeOnTransferTokens', [units(1000, decimals), 0n, [quote.address, token.address], outsider, await timestamp() + 1200n], outsider);
  const accrued = await read(token, 'taxTokenBalance'); assert(accrued >= units(1000));
  const [rt0, rq0] = await f.reserves(), supply0 = await read(pair, 'totalSupply'), k0 = await read(pair, 'kLast');
  const root0 = sqrt(rt0 * rq0), rootLast0 = sqrt(k0), fee0 = supply0 * (root0 - rootLast0) / (root0 * 5n + rootLast0); assert(fee0 > 0n);
  await send(pool, 'setLpReceiver', [feeTo], owner); const q0 = await read(pool, 'previewClaim', [alice, 1]); await send(quote, 'approve', [pool.address, units(1000, decimals)], alice);
  const beforeReceiver = await balance(pair, feeTo); const receipt0 = await send(pool, 'claimChecked', await f.checked(alice, 1), alice); const event0 = parseEventLogs({ abi: pool.abi, eventName: 'LiquidityCreated', logs: receipt0.logs })[0].args;
  assert.equal(await balance(pair, feeTo), beforeReceiver + fee0 + event0.liquidity); assert(event0.liquidity >= q0[5]); assert.equal(await balance(pair, alice), 0n);
  pass(label + 'project LP receiver may equal factory feeTo and receives both protocol fee mint and real claim liquidity');

  await send(pool, 'setLpReceiver', [project], owner); await send(token, 'setSwapSettings', [units(1000), units(5000), 500n, true]);
  const q = await read(pool, 'previewClaim', [bob, 1]); const reserveBefore = await f.reserves(), supplyBefore = await read(pair, 'totalSupply'), kBefore = await read(pair, 'kLast');
  await send(quote, 'approve', [pool.address, units(1000, decimals)], bob);
  await f.revertedClaim(bob, await f.checked(bob, 1), 'stale pre-swapback LP estimate exceeds actual mint');
  await f.revertedClaim(bob, await f.checked(bob, 1, { min: q[5] * 2n }), 'fee-on excessive LP minimum after swapback');
  await f.revertedClaim(bob, await f.checked(bob, 1, { max: 1n, min: 1n }), 'swapback maximum below recalculated USDT');
  const projectBefore = await balance(pair, project), feeBefore = await balance(pair, feeTo), quoteBefore = await balance(quote, bob);
  const receipt = await send(pool, 'claimChecked', await f.checked(bob, 1, { max: q[4] * 2n, min: 1n }), bob);
  const processed = parseEventLogs({ abi: token.abi, eventName: 'TaxProcessed', logs: receipt.logs }); assert.equal(processed.length, 1);
  const sync = parseEventLogs({ abi: pair.abi, eventName: 'Sync', logs: receipt.logs }); assert(sync.length >= 2);
  const first = sync[0].args, token0 = await read(pair, 'token0'); const [rt, rq] = token0.toLowerCase() === token.address.toLowerCase() ? [first.reserve0, first.reserve1] : [first.reserve1, first.reserve0];
  assert(rt > reserveBefore[0]); assert(rq < reserveBefore[1]);
  const e = parseEventLogs({ abi: pool.abi, eventName: 'LiquidityCreated', logs: receipt.logs })[0].args;
  const expectedPaid = ceil(e.netTokens * rq, rt), rootK = sqrt(rt * rq), rootKLast = sqrt(kBefore), protocolFee = supplyBefore * (rootK - rootKLast) / (rootK * 5n + rootKLast), supplyAfterFee = supplyBefore + protocolFee;
  const expectedFromToken = e.netTokens * supplyAfterFee / rt, expectedFromQuote = expectedPaid * supplyAfterFee / rq, expectedLiquidity = expectedFromToken < expectedFromQuote ? expectedFromToken : expectedFromQuote;
  assert.equal(e.usdtPaid, expectedPaid); assert(e.usdtPaid < q[4], 'uses post-swapback price rather than stale pre-transfer reserves'); assert.equal(e.liquidity, expectedLiquidity);
  assert.equal(await balance(quote, bob), quoteBefore - expectedPaid); assert.equal(await balance(pair, project), projectBefore + expectedLiquidity); assert.equal(await balance(pair, feeTo), feeBefore + protocolFee); assert.equal(await balance(pair, bob), 0n); assert.equal(await read(pool, 'claimable', [bob]), 0n); assert.equal(await read(token, 'taxTokenBalance'), 0n);
  pass(label + 'sell-time tax swapback reprices USDT and LP from actual changed reserves, including fee-on supply growth');
  pass(label + 'failed post-swapback protections atomically restore accrued tax, dividends, sale rights, USDT, reserves and all LP balances');
 });
}
async function verifyQuoteFailures(artifact) {
 await withChain('Isolated hostile quote token LP claims', async ctx => {
  const f = await setup(artifact, 6, ctx, false, true), { send, read, balance, token, quote, pool, alice, owner, project } = f;
  await f.configure(); await f.fundPool(); await f.prepare(); await f.subscribe(alice); await f.open(); await send(pool, 'setLpReceiver', [project], owner); await send(quote, 'approve', [pool.address, units(1000, 6)], alice);
  for (const [behavior, label] of [[1, 'false-return USDT'], [2, 'reverted USDT'], [3, 'transfer-tax USDT'], [4, 'no-op USDT']]) { await send(quote, 'setBehavior', [behavior, false]); await f.revertedClaim(alice, await f.checked(alice, 1), label); pass(label + ' restores real token sell burn, sale settlement, pool and all pair balances'); }
  await send(quote, 'setBehavior', [0, true]);
  const reentry = encodeFunctionData({ abi: pool.abi, functionName: 'claim', args: [0] }); await send(quote, 'setCallback', [pool.address, reentry, false, true]); const before = await balance(token, alice); await send(pool, 'claimChecked', await f.checked(alice, 1), alice);
  assert.equal(await read(quote, 'callbackBlocked'), true); assert.equal(await balance(token, alice), before + units(24500)); assert.equal(await read(pool, 'settled', [alice]), units(35000));
  pass('no-return USDT supports exact real LP funding and transferFrom callback cannot reenter claims');
 });
}
async function verifyTokenFailures(artifact) {
 await withChain('Isolated no-return direct claims', async ({ accounts, deploy, send, fail, read, balance, timestamp, at }) => {
  const [owner, alice, bob, vault, fund, outsider] = accounts, asset = await deploy(artifact('ClaimFixture.sol', 'ClaimFixture'), [18]), quote = await deploy(artifact('ClaimFixture.sol', 'ClaimFixture'), [6]);
  const sale = await deploy(artifact('XBTSale.sol', 'XBTSale'), [quote.address, asset.address, vault, fund]), pool = await deploy(artifact('CaBiClaimPool.sol', 'CaBiClaimPool'), [asset.address, sale.address, owner]);
  await send(sale, 'setClaimPool', [pool.address]); await send(asset, 'mint', [owner, units(1000000)]); await send(asset, 'approve', [pool.address, units(1000000)]); await send(asset, 'setBehavior', [0, true]); await send(quote, 'setBehavior', [0, true]); await send(pool, 'deposit', [units(500000)]);
  for (const who of [alice, bob]) { await send(quote, 'mint', [who, units(100, 6)]); await send(quote, 'approve', [sale.address, units(100, 6)], who); await send(sale, 'subscribe', [1n, ZERO], who); }
  await send(sale, 'batchCreditTeamReward', [[asset.address], [1n]]); const start = await timestamp() + 100n; await send(pool, 'setClaimStartsAt', [Number(start)]); await at(start);
  const payload = encodeFunctionData({ abi: pool.abi, functionName: 'claim', args: [0] });
  await send(asset, 'setCallback', [pool.address, payload, false, true]); await send(pool, 'deposit', [units(100)]); assert.equal(await read(asset, 'callbackBlocked'), true);
  await send(asset, 'setCallback', [pool.address, payload, true, false]); await send(pool, 'withdrawUnused', [units(10), owner]); assert.equal(await read(asset, 'callbackBlocked'), true); await send(pool, 'claimChecked', [0, units(35000), Number(start), ZERO, 0n, 0n, 0n], alice); assert.equal(await read(asset, 'callbackBlocked'), true); assert.equal(await balance(asset, alice), units(17500)); assert.equal(await balance(asset, DEAD), units(17500));
  await send(asset, 'setCallback', [ZERO, '0x', false, false]); await send(asset, 'invoke', [pool.address, payload]); assert.equal(await read(pool, 'claimed', [asset.address]), units(17500));
  pass('no-return token direct 50/burn50 deposits, withdrawals and claims work while all token callbacks are blocked');
  const state = async () => ({ pool: await Promise.all(['poolBalance', 'totalAllocated', 'totalClaimed', 'totalBurned'].map(name => read(pool, name))), token: await Promise.all([bob, DEAD].map(who => balance(asset, who))), user: await Promise.all(['claimed', 'settled', 'claimable'].map(name => read(pool, name, [bob]))), sale: await read(sale, 'claimed', [bob]) });
  for (const [behavior, label] of [[1, 'false return after movement'], [2, 'revert'], [3, 'fee-on-transfer'], [4, 'no-op return']]) { await send(asset, 'setBehavior', [behavior, false]); const before = await state(); await fail(pool, 'claimChecked', [0, units(35000), Number(start), ZERO, 0n, 0n, 0n], bob); assert.deepEqual(await state(), before); pass('direct ' + label + ' rolls back burn, payout and full sale accounting'); }
  for (const behavior of [1, 2, 3, 4]) { await send(asset, 'setBehavior', [behavior, false]); const before = [await read(pool, 'poolBalance'), await balance(asset, owner), await read(asset, 'allowance', [owner, pool.address])]; await fail(pool, 'deposit', [units(100)]); await fail(pool, 'withdrawUnused', [units(100), owner]); assert.deepEqual([await read(pool, 'poolBalance'), await balance(asset, owner), await read(asset, 'allowance', [owner, pool.address])], before); }
  pass('invalid token deposit and withdrawal behavior cannot reduce reserved backing');
  await send(asset, 'setBehavior', [0, false]); const current = await read(pool, 'poolBalance'); await send(asset, 'reduce', [pool.address, current - units(34999)]); assert.equal(await read(pool, 'unusedBalance'), 0n); await fail(pool, 'claim', [0], bob); await fail(pool, 'withdrawUnused', [1n, outsider]); assert.equal(await read(sale, 'claimed', [bob]), 0n); await send(asset, 'mint', [pool.address, units(1)]); await send(pool, 'claim', [0], bob); assert.equal(await balance(asset, bob), units(17500)); assert.equal(await read(pool, 'poolBalance'), 0n); assert.equal(await read(pool, 'totalAllocated'), 0n);
  pass('unexpected deficit preserves automatic entitlement until backing is replenished');
 });
}
async function verifyPoolBurnClaims(artifact,decimals){
 await withChain('Pool burn preserves claim rights',async ctx=>{
  const f=await setup(artifact,decimals,ctx),{send,read,balance,token,quote,pool,pair,sale,alice,bob,owner,project,outsider}=f;
  await f.configure();await f.fundPool();await f.prepare();await f.subscribe(alice);await f.subscribe(bob);await f.open();await send(pool,'setLpReceiver',[project],owner);await send(quote,'approve',[pool.address,units(1000,decimals)],alice);
  const old=await f.checked(alice,1),poolBefore=await balance(token,pool.address),reserved=await read(sale,'reservedTokens'),quoteBefore=await balance(quote,pair.address);
  await ctx.at(await read(token,'nextPoolBurnTime'));await send(token,'burnPool',[],outsider);assert.equal(await balance(token,pool.address),poolBefore);assert.equal(await read(sale,'reservedTokens'),reserved);assert.equal(await balance(quote,pair.address),quoteBefore);assert.equal(await read(pool,'claimable',[alice]),units(35000));
  pass(decimals+'-decimal USDT: bottom-pool burn leaves claim reserves, sale obligations, user entitlements and quote balance intact');
  old[6]=await ctx.timestamp()+1200n;await f.revertedClaim(alice,old,'stale pre-burn quote');
  const fresh=await f.checked(alice,1);assert(fresh[4]>old[4]);await send(pool,'claimChecked',fresh,alice);assert.equal(await read(pool,'claimed',[alice]),units(24500));assert.equal(await read(pool,'settled',[alice]),units(35000));assert((await balance(pair,project))>0n);
  pass(decimals+'-decimal USDT: stale LP quote rejects after pool burn, fresh quote creates real project LP and pays 70%');
  const bobBefore=await balance(token,bob);await send(pool,'claimChecked',await f.checked(bob,0),bob);assert.equal(await balance(token,bob),bobBefore+units(17500));assert.equal(await read(pool,'settled',[bob]),units(35000));
  pass(decimals+'-decimal USDT: direct 50% claim and remainder burn still settle once after scheduled pool burn');
 });
}
async function main() { const artifact = compile(); for (const decimals of [18, 6]) { await verifySaleClaims(artifact, decimals); await verifyFeeOnSwapback(artifact, decimals); } for(const decimals of [18,6]) await verifyPoolBurnClaims(artifact,decimals); await verifyQuoteFailures(artifact); await verifyTokenFailures(artifact); fs.mkdirSync(path.join(ROOT, 'output', 'qa'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'output', 'qa', 'claim-pool-verification.json'), JSON.stringify({ scope: 'timed automatic sale rights; direct 50/burn50 and real project V2 LP70/30 with normal sell tax; synthetic chain only', results }, null, 2)); console.log(results.length + ' dual mode claim-pool checks passed.'); }
main().catch(error => { console.error(error); process.exitCode = 1; });
