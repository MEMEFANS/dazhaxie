/* eslint-disable @typescript-eslint/no-require-imports -- Isolated launch workflow integration checks. */
// Synthetic accounts and local V2 bytecode only. No .env, public RPC, live keys or funds.
const assert = require('node:assert/strict');
process.env.UWS_USE_FALLBACK ??= '1';
const ganache = require('ganache');
const { createPublicClient, createWalletClient, custom, parseUnits, parseEventLogs } = require('viem');
const { generatePrivateKey, privateKeyToAccount } = require('viem/accounts');
const { compileLaunch } = require('./compile-launch-contracts.cjs');
const ZERO = '0x0000000000000000000000000000000000000000';
const DEAD = '0x000000000000000000000000000000000000dEaD';
const unit = (value, decimals = 18) => parseUnits(String(value), decimals);
const { output } = compileLaunch(true);
const artifact = (file, name) => {
  const a = output.contracts[file][name];
  return { abi: a.abi, bytecode: '0x' + a.evm.bytecode.object };
};
function dex(pkg, name) {
  const a = require(pkg + '/build/' + name + '.json');
  const b = typeof a.bytecode === 'string' ? a.bytecode : a.evm.bytecode.object;
  return { abi: a.abi, bytecode: b.startsWith('0x') ? b : '0x' + b };
}
let count = 0;
function pass(name) { count++; console.log('PASS ' + name); }

async function scenario(decimals) {
  const label = decimals + '-decimal USDT: ';
  const provider = ganache.provider({
    logging: { quiet: true }, wallet: { deterministic: true, totalAccounts: 12 },
    chain: { chainId: 31337, hardfork: 'shanghai' }, miner: { timestampIncrement: 0 },
  });
  const chain = { id: 31337, name: 'Local launch workflow', nativeCurrency: { name: 'Test', symbol: 'TEST', decimals: 18 }, rpcUrls: { default: { http: [] } } };
  const client = createPublicClient({ chain, transport: custom(provider), pollingInterval: 10 });
  const wallet = createWalletClient({ chain, transport: custom(provider) });
  const [owner, alice, bob, project, distribution, buyback, buyer] = await wallet.getAddresses();
  const signingAccount = privateKeyToAccount(generatePrivateKey());
  const deploy = async (entry, args = []) => {
    const hash = await wallet.deployContract({ ...entry, args, account: owner, gas: 12_000_000n });
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success', 'deploy');
    return { address: receipt.contractAddress, abi: entry.abi };
  };
  const read = (contract, functionName, args = []) => client.readContract({ ...contract, functionName, args });
  const send = async (contract, functionName, args = [], account = owner) => {
    const hash = await wallet.writeContract({ ...contract, functionName, args, account, gas: 8_000_000n });
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success', functionName);
    return receipt;
  };
  const balance = (asset, address) => read(asset, 'balanceOf', [address]);
  const timestamp = async () => (await client.getBlock({ blockTag: 'latest' })).timestamp;
  const advance = async time => {
    await provider.request({ method: 'evm_setTime', params: [Number(time * 1000n)] });
    await provider.request({ method: 'evm_mine', params: [] });
    assert.equal(await timestamp(), time);
  };
  const unavailable = (contract, functionName, args = [], account = owner) =>
    assert.rejects(() => client.simulateContract({ ...contract, functionName, args, account }));
  try {
    const token = await deploy(artifact('CaBiLaunchToken.sol', 'CaBiLaunchToken'), [distribution, buyback, owner]);
    const quote = await deploy(artifact('test/TestUSDT.sol', 'TestUSDT'), [decimals]);
    const factory = await deploy(dex('@uniswap/v2-core', 'UniswapV2Factory'), [owner]);
    const router = await deploy(dex('@uniswap/v2-periphery', 'UniswapV2Router02'), [factory.address, quote.address]);
    await send(factory, 'createPair', [token.address, quote.address]);
    const pair = { address: await read(factory, 'getPair', [token.address, quote.address]), abi: dex('@uniswap/v2-core', 'UniswapV2Pair').abi };
    await send(token, 'configureTrading', [router.address, quote.address, pair.address]);
    const historicalClaim = decimals === 18 ? unit(35000) : 0n;
    const legacy = decimals === 18 ? await deploy(artifact('test/LaunchLegacyLedgerFixture.sol', 'LaunchLegacyLedgerFixture'), [alice, historicalClaim]) : null;
    const pool = await deploy(artifact('CaBiLaunchPool.sol', 'CaBiLaunchPool'), [token.address, signingAccount.address, project, legacy?.address || ZERO]);
    if (legacy) await send(legacy, 'retireTo', [pool.address]);
    await send(token, 'configureLaunchPool', [pool.address]);
    assert.equal(await read(token, 'phase'), 0);
    assert.equal(await read(token, 'name'), 'CaBi');
    assert.equal(await read(token, 'totalSupply'), unit(1_000_000_000));
    assert.equal(await balance(token, owner), unit(1_000_000_000));
    assert.equal(await read(token, 'isMaxWalletExempt', [pool.address]), true);
    pass(label + '10亿供应量、税款地址和专用加池合约配置正确');

    const start = await timestamp(), claimAt = start + 3600n, tradingAt = start + 7200n;
    await send(token, 'scheduleLaunch', [claimAt, tradingAt]);
    await send(token, 'openLiquidity');
    assert.equal(await read(token, 'phase'), 1);
    await unavailable(token, 'scheduleLaunch', [claimAt + 600n, tradingAt + 600n]);
    assert.equal((await read(token, 'previewPoolBurn'))[2], false);
    assert.equal(await read(token, 'nextPoolBurnTime'), tradingAt + 28800n);
    await unavailable(token, 'burnPool');
    pass(label + '组LP开始后时间锁定，池内销毁等到开盘后计时');

    await send(quote, 'mint', [owner, unit(100, decimals)]);
    await send(token, 'approve', [pool.address, unit(70000)]);
    await send(quote, 'approve', [pool.address, unit(100, decimals)]);
    const seedQuote = await read(pool, 'previewSeed', [unit(70000)]);
    assert.equal(seedQuote[0], unit(100, decimals));
    await send(pool, 'seedLiquidity', [unit(70000), seedQuote[0], seedQuote[1] * 99n / 100n, tradingAt]);
    assert.equal(await balance(token, pair.address), unit(70000));
    assert.equal(await balance(quote, pair.address), unit(100, decimals));
    assert.equal(await balance(token, DEAD), 0n);
    assert.equal(await read(token, 'taxTokenBalance'), 0n);
    assert.equal(await read(token, 'liquidityOperation'), 0);
    assert((await balance(pair, owner)) > 0n);
    await send(token, 'transfer', [pool.address, unit(700000000)]);
    pass(label + '100 USDT＋70,000 CaBi真正建池，初始加池不扣税');

    const sign = async (user, amount, cumulativeLimit, nonce) => {
      const authorization = { amount, cumulativeLimit, nonce, deadline: tradingAt };
      const signature = await signingAccount.signTypedData({
        domain: { name: 'CaBiLaunchPool', version: '1', chainId: 31337, verifyingContract: pool.address },
        types: { Prepare: [
          { name: 'user', type: 'address' }, { name: 'amount', type: 'uint256' },
          { name: 'cumulativeLimit', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
        ] }, primaryType: 'Prepare', message: { user, ...authorization },
      });
      return { authorization, signature };
    };
    const prepare = async (user, amount, nonce) => {
      const q = await read(pool, 'previewPrepare', [amount]);
      const previous = user === alice ? historicalClaim : 0n;
      const auth = await sign(user, amount, amount + previous, nonce);
      await send(quote, 'approve', [pool.address, q[2]], user);
      const receipt = await send(pool, 'prepareLiquidity', [auth.authorization, auth.signature, q[2], q[3] * 99n / 100n], user);
      const events = parseEventLogs({ abi: pool.abi, eventName: 'LiquidityPrepared', logs: receipt.logs });
      assert.equal(events.length, 1);
      assert.equal(events[0].args.usdtPaid, q[2]);
      assert.equal(await balance(token, user), 0n);
      return q;
    };
    await send(quote, 'mint', [alice, unit(100, decimals)]);
    await send(quote, 'mint', [bob, unit(100, decimals)]);
    const aliceQuote = await prepare(alice, unit(70000), 1n);
    assert.equal(aliceQuote[0], unit(49000)); assert.equal(aliceQuote[1], unit(21000)); assert.equal(aliceQuote[2], unit(30, decimals));
    const bobQuote = await prepare(bob, unit(35000), 1n);
    assert.equal(bobQuote[0], unit(24500)); assert.equal(bobQuote[1], unit(10500)); assert.equal(bobQuote[2], unit(15, decimals));
    assert.equal(await balance(token, pair.address), unit(101500));
    assert.equal(await balance(quote, pair.address), unit(145, decimals));
    assert.equal(await read(pool, 'reservedPayout'), unit(73500));
    assert.equal(await balance(pair, pool.address), await read(pool, 'escrowedLp'));
    await unavailable(pool, 'claim', [], alice);
    await unavailable(pool, 'releaseProjectLp');
    pass(label + '用户按每份15 USDT真实组LP，生成凭证并保留70%待领储备');

    const aliceBeforeCancel = await balance(quote, alice);
    await send(pool, 'cancelPreparation', [unit(30, decimals) - 2n, tradingAt], alice);
    const refund = (await balance(quote, alice)) - aliceBeforeCancel;
    assert(refund <= unit(30, decimals) && unit(30, decimals) - refund <= 2n);
    assert.equal(await read(pool, 'preparedOf', [alice]), 0n);
    assert.equal(await read(pool, 'payoutAvailable', [alice]), 0n);
    assert.equal(await read(pool, 'lpOf', [alice]), 0n);
    assert.equal(await read(pool, 'reservedPayout'), unit(24500));
    assert.equal(await balance(token, DEAD), 0n);
    await prepare(alice, unit(70000), 2n);
    assert.equal(await read(pool, 'unusedBalance'), (await read(pool, 'poolBalance')) - unit(73500));
    await send(pool, 'withdrawUnused', [unit(100)]);
    assert.equal(await read(pool, 'reservedPayout'), unit(73500));
    pass(label + '开放前用户可撤销并退USDT、重新参与；70%已准备额度独立保留');

    await advance(claimAt);
    assert.equal(await read(token, 'phase'), 2);
    const aliceUsdt = await balance(quote, alice);
    const projectBefore = await balance(pair, project), lpCommitted = await read(pool, 'escrowedLp');
    await send(pool, 'releaseProjectLp');
    assert.equal(await balance(pair, project), projectBefore + lpCommitted);
    await send(pool, 'claimPartial', [unit(35000)], alice);
    assert.equal(await balance(token, alice), unit(24500));
    assert.equal(await read(pool, 'payoutAvailable', [alice]), unit(24500));
    await send(pool, 'claim', [], alice);
    await send(pool, 'claim', [], bob);
    assert.equal(await balance(token, alice), unit(49000));
    assert.equal(await balance(token, bob), unit(24500));
    assert.equal(await balance(quote, alice), aliceUsdt);
    assert.equal(await read(pool, 'claimedOf', [alice]), unit(70000) + historicalClaim);
    assert.equal(await read(pool, 'reservedPayout'), 0n);
    assert.equal(await read(token, 'isTradingOpen'), false);
    await unavailable(token, 'transfer', [bob, unit(1)], alice);
    pass(label + '到时领取70%且不再收款，LP归项目钱包，公开交易仍未开放');
    if (legacy) pass(label + '迁移承接历史已领额度，新凭证按扣除历史后的额度准备');

    await advance(tradingAt);
    assert.equal(await read(token, 'phase'), 3);
    await send(token, 'transfer', [bob, unit(1)], alice);
    assert.equal(await balance(token, bob), unit(24501));
    await send(quote, 'mint', [buyer, unit(10, decimals)]);
    await send(quote, 'approve', [router.address, unit(10, decimals)], buyer);
    const amounts = await read(router, 'getAmountsOut', [unit(10, decimals), [quote.address, token.address]]);
    await send(router, 'swapExactTokensForTokensSupportingFeeOnTransferTokens', [unit(10, decimals), 1n, [quote.address, token.address], buyer, tradingAt + 60n], buyer);
    const tax = amounts[1] * 300n / 10000n;
    assert.equal(await balance(token, buyer), amounts[1] - tax);
    assert.equal(await read(token, 'taxTokenBalance'), tax);
    await send(token, 'approve', [router.address, unit(100)], buyer);
    await send(router, 'swapExactTokensForTokensSupportingFeeOnTransferTokens', [unit(100), 1n, [token.address, quote.address], buyer, tradingAt + 60n], buyer);
    assert.equal(await balance(token, DEAD), unit(3));
    pass(label + '正式开盘自动开放转账和双向交易，买3%与卖3%税正常');

    const taxQuote = await read(token, 'previewTaxSwap', [tax]);
    await send(token, 'processTax', [tax, taxQuote[1], tradingAt + 60n]);
    const distributionPaid = await balance(quote, distribution), buybackPaid = await balance(quote, buyback);
    assert(distributionPaid > 0n && buybackPaid >= distributionPaid && buybackPaid - distributionPaid <= 1n);
    await advance(tradingAt + 28800n);
    const beforeBurn = await balance(token, pair.address), usdtBeforeBurn = await balance(quote, pair.address);
    await send(token, 'burnPool');
    assert.equal(await balance(token, pair.address), beforeBurn - beforeBurn / 100n);
    assert.equal(await balance(quote, pair.address), usdtBeforeBurn);
    assert.equal(await read(token, 'nextPoolBurnTime'), tradingAt + 57600n);
    pass(label + '税款50/50分配及开盘8小时后池内1%销毁正常');
  } finally { await provider.disconnect(); }
}

async function baseCompatibility() {
  const base = artifact('CaBiPancakeToken.sol', 'CaBiPancakeToken');
  assert(!base.abi.some(item => item.name === 'scheduleLaunch'));
  const runtime = output.contracts['CaBiPancakeToken.sol'].CaBiPancakeToken.evm.deployedBytecode.object;
  assert(runtime.length / 2 < 24576);
  const launch = artifact('CaBiLaunchToken.sol', 'CaBiLaunchToken');
  for (const name of ['pause', 'setTradingEnabled', 'setBuyWhitelist', 'mint']) {
    assert(!launch.abi.some(item => item.name === name), 'no post-launch control: ' + name);
  }
  pass('新版本保留固定总量，未加入增发、交易白名单或开盘后暂停入口');
}
async function main() {
  await baseCompatibility();
  await scenario(6);
  await scenario(18);
  console.log(count + ' launch workflow checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
