/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS runner consumes JSON compiler artifacts. */
/*
 * Normal-business integration tests on an isolated in-process chain.
 * All accounts and funds are synthetic fixtures. No public RPC, real wallet,
 * real USDT, network deployment, or production application data is used.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');
// This provider is used in process only; its pure JS transport works across Node builds.
process.env.UWS_USE_FALLBACK ??= '1';
const ganache = require('ganache');
const { createPublicClient, createWalletClient, custom, parseEventLogs, parseUnits } = require('viem');

const ROOT = path.resolve(__dirname, '..');
const DEAD = '0x000000000000000000000000000000000000dEaD';
const results = [];
const test = (name, detail = {}) => { results.push({ name, ...detail, valid: true }); console.log(`PASS ${name}`); };
const units = (value, decimals = 18) => parseUnits(String(value), decimals);
const outputFor = (amountIn, reserveIn, reserveOut) => amountIn * 997n * reserveOut / (reserveIn * 1000n + amountIn * 997n);

function compile() {
  const sources = {};
  for (const name of ['XBTToken.sol', 'XBTSale.sol', 'XBTRewardPool.sol', 'XBTTradingGateway.sol', 'test/TestUSDT.sol']) {
    sources[name] = { content: fs.readFileSync(path.join(ROOT, 'contracts', name), 'utf8') };
  }
  const output = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  })));
  const errors = (output.errors || []).filter(e => e.severity === 'error');
  assert.equal(errors.length, 0, errors.map(e => e.formattedMessage).join('\n'));
  test('all production contracts and isolated asset fixture compile', { compiler: solc.version() });
  return (file, contract) => ({ abi: output.contracts[file][contract].abi, bytecode: '0x' + output.contracts[file][contract].evm.bytecode.object });
}

function dexArtifact(packageName, filename) {
  const artifact = require(`${packageName}/build/${filename}.json`);
  const bytecode = typeof artifact.bytecode === 'string' ? artifact.bytecode : artifact.evm.bytecode.object;
  return { abi: artifact.abi, bytecode: bytecode.startsWith('0x') ? bytecode : '0x' + bytecode };
}

async function runScenario(compiled, decimals) {
  const provider = ganache.provider({
    logging: { quiet: true },
    wallet: { deterministic: true, totalAccounts: 14 },
    chain: { chainId: 31337, hardfork: 'shanghai' },
  });
  const chain = { id: 31337, name: 'Isolated synthetic fee test', nativeCurrency: { name: 'Test Ether', symbol: 'TEST', decimals: 18 }, rpcUrls: { default: { http: [] } } };
  const publicClient = createPublicClient({ chain, transport: custom(provider), pollingInterval: 10 });
  const wallet = createWalletClient({ chain, transport: custom(provider) });
  const [owner, lpProvider, buyer, recipient, ops, community, eco, dividend, capHolder, capRecipient, saleHolder, dividend2, updatedDividend1, updatedDividend2] = await wallet.getAddresses();
  const label = `${decimals}-decimal USDT`;
  const deploy = async (artifact, args = [], account = owner) => {
    const hash = await wallet.deployContract({ ...artifact, args, account, gas: 12000000n });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success', 'contract deployment');
    return { address: receipt.contractAddress, abi: artifact.abi };
  };
  const write = async (contract, functionName, args = [], account = owner) => {
    const hash = await wallet.writeContract({ ...contract, functionName, args, account, gas: 12000000n });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success', functionName);
    return receipt;
  };
  const expectHoldingLimit = async (contract, functionName, args = [], account = owner) => {
    const hash = await wallet.writeContract({ ...contract, functionName, args, account, gas: 12000000n });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'reverted', `${functionName}: configured holding limit`);
  };
  const read = (contract, functionName, args = []) => publicClient.readContract({ ...contract, functionName, args });
  const balance = (contract, account) => read(contract, 'balanceOf', [account]);
  const approve = (contract, spender, amount, account) => write(contract, 'approve', [spender, amount], account);
  const deadline = (await publicClient.getBlock()).timestamp + 86400n;
  try {
    const tokenArtifact = compiled('XBTToken.sol', 'XBTToken');
    assert.equal(tokenArtifact.abi.find(entry => entry.type === 'constructor')?.inputs.length ?? 0, 0);
    const xbt = await deploy(tokenArtifact);
    const totalSupply = units(1000000000);
    assert.equal(await read(xbt, 'name'), 'CaBi');
    assert.equal(await read(xbt, 'symbol'), 'CaBi');
    assert.equal(await read(xbt, 'maxWalletAmount'), units(200000));
    assert.equal(await read(xbt, 'isMaxWalletExempt', [owner]), true);
    assert.equal(await read(xbt, 'isMaxWalletExempt', [xbt.address]), true);
    assert.equal(await read(xbt, 'isMaxWalletExempt', [DEAD]), true);
    assert.equal(await read(xbt, 'isMaxWalletExempt', [buyer]), false);
    test(`${label}: CaBi metadata and adjustable 200,000-token default holding limit`);
    assert.equal(await read(xbt, 'totalSupply'), totalSupply);
    assert.equal(await balance(xbt, owner), totalSupply);
    assert.equal(await balance(xbt, xbt.address), 0n);
    for (const account of [lpProvider, buyer, recipient, ops, community, eco, dividend]) {
      assert.equal(await balance(xbt, account), 0n);
    }
    test(`${label}: all one billion CaBi belong to deployer with no automatic allocation`);

    await write(xbt, 'setMaxWalletExempt', [lpProvider, true]);
    const allocations = [
      [lpProvider, units(2000000)],
      [ops, units(123456)],
      [community, units(789)],
      [eco, units(42)],
    ];
    let distributed = 0n;
    for (const [account, amount] of allocations) {
      await write(xbt, 'transfer', [account, amount]);
      assert.equal(await balance(xbt, account), amount);
      distributed += amount;
    }
    assert.equal(await balance(xbt, owner), totalSupply - distributed);
    assert.equal(await balance(xbt, DEAD), 0n);
    test(`${label}: holder distributes freely selected amounts using ordinary transfers`);

    const usdt = await deploy(compiled('test/TestUSDT.sol', 'TestUSDT'), [decimals]);
    const sale = await deploy(compiled('XBTSale.sol', 'XBTSale'), [usdt.address, xbt.address, recipient, owner]);
    await write(xbt, 'setMaxWalletExempt', [sale.address, true]);
    assert.equal(await balance(xbt, sale.address), 0n);
    await write(xbt, 'transfer', [sale.address, units(123456)]);
    await write(xbt, 'transfer', [sale.address, units(7)]);
    assert.equal(await balance(xbt, sale.address), units(123463));
    assert.equal(await balance(xbt, owner), totalSupply - distributed - units(123463));
    assert.equal(await balance(xbt, xbt.address), 0n);
    test(`${label}: sale receives holder-selected funding through repeatable ordinary transfers`);

    const factory = await deploy(dexArtifact('@uniswap/v2-core', 'UniswapV2Factory'), [owner]);
    const weth = await deploy(dexArtifact('@uniswap/v2-periphery', 'WETH9'));
    const router = await deploy(dexArtifact('@uniswap/v2-periphery', 'UniswapV2Router02'), [factory.address, weth.address]);
    await write(factory, 'createPair', [xbt.address, usdt.address]);
    const pair = { address: await read(factory, 'getPair', [xbt.address, usdt.address]), abi: dexArtifact('@uniswap/v2-core', 'UniswapV2Pair').abi };
    const gatewayAdmin = eco;
    const gateway = await deploy(compiled('XBTTradingGateway.sol', 'XBTTradingGateway'), [xbt.address, usdt.address, router.address, dividend, dividend2, gatewayAdmin]);
    assert.equal((await read(gateway, 'owner')).toLowerCase(), gatewayAdmin.toLowerCase());
    assert.equal((await read(gateway, 'dividendReceiver1')).toLowerCase(), dividend.toLowerCase());
    assert.equal((await read(gateway, 'dividendReceiver2')).toLowerCase(), dividend2.toLowerCase());
    assert.equal(await read(gateway, 'dividendRate1Bps'), 200n);
    assert.equal(await read(gateway, 'dividendRate2Bps'), 100n);
    test(`${label}: explicit gateway administrator and default 2% / 1% dividend configuration`);
    await write(xbt, 'configureTrading', [gateway.address]);
    assert.equal(await read(xbt, 'isMaxWalletExempt', [gateway.address]), true);
    assert.equal(await read(xbt, 'isMaxWalletExempt', [pair.address]), true);
    test(`${label}: explicit allocation exemption and automatic AMM infrastructure exemptions`);
    await write(usdt, 'mint', [lpProvider, units(10000, decimals)]);
    await write(usdt, 'mint', [buyer, units(2000, decimals)]);
    const getReserves = async () => {
      const [r0, r1] = await read(pair, 'getReserves');
      const token0 = await read(pair, 'token0');
      return token0.toLowerCase() === xbt.address.toLowerCase() ? { xbt: r0, usdt: r1 } : { xbt: r1, usdt: r0 };
    };
    await approve(xbt, gateway.address, units(1000000), lpProvider);
    await approve(usdt, gateway.address, units(1000, decimals), lpProvider);
    await write(gateway, 'addLiquidity', [units(1000000), units(1000, decimals), 0n, 0n, lpProvider, deadline], lpProvider);
    assert.deepEqual(await getReserves(), { xbt: units(1000000), usdt: units(1000, decimals) });
    assert.equal(await balance(xbt, DEAD), 0n);
    assert.equal(await read(xbt, 'allowance', [gateway.address, router.address]), 0n);
    assert.equal(await read(usdt, 'allowance', [gateway.address, router.address]), 0n);
    test(`${label}: initial liquidity is not charged as a sale`);

    const grossUsdt = units(100, decimals);
    const feeUsdt = grossUsdt * 300n / 10000n;
    const feeUsdt1 = grossUsdt * 200n / 10000n;
    const feeUsdt2 = feeUsdt - feeUsdt1;
    const netUsdt = grossUsdt - feeUsdt;
    const reservesBeforeBuy = await getReserves();
    const expectedXbt = outputFor(netUsdt, reservesBeforeBuy.usdt, reservesBeforeBuy.xbt);
    const buyerUsdtBefore = await balance(usdt, buyer);
    await approve(usdt, gateway.address, grossUsdt, buyer);
    await write(gateway, 'buy', [grossUsdt, expectedXbt, buyer, deadline], buyer);
    assert.equal(await balance(usdt, dividend), feeUsdt1);
    assert.equal(await balance(usdt, dividend2), feeUsdt2);
    assert.equal(await balance(usdt, buyer), buyerUsdtBefore - grossUsdt);
    assert.equal(await balance(xbt, buyer), expectedXbt);
    assert.deepEqual(await getReserves(), { xbt: reservesBeforeBuy.xbt - expectedXbt, usdt: reservesBeforeBuy.usdt + netUsdt });
    assert.equal(await balance(xbt, DEAD), 0n);
    assert.equal(await balance(usdt, gateway.address), 0n);
    test(`${label}: 100 USDT buy pays 2 and 1 USDT to separate receivers and swaps 97 USDT`);

    const grossXbt = units(100);
    const sellFee = grossXbt * 300n / 10000n;
    const netXbt = grossXbt - sellFee;
    const reservesBeforeSell = await getReserves();
    const expectedUsdt = outputFor(netXbt, reservesBeforeSell.xbt, reservesBeforeSell.usdt);
    const buyerXbtBefore = await balance(xbt, buyer);
    const buyerUsdtBeforeSell = await balance(usdt, buyer);
    await approve(xbt, gateway.address, grossXbt, buyer);
    await write(gateway, 'sell', [grossXbt, expectedUsdt, buyer, deadline], buyer);
    assert.equal(await balance(xbt, DEAD), sellFee);
    assert.equal(await balance(xbt, buyer), buyerXbtBefore - grossXbt);
    assert.equal(await balance(usdt, buyer), buyerUsdtBeforeSell + expectedUsdt);
    assert.deepEqual(await getReserves(), { xbt: reservesBeforeSell.xbt + netXbt, usdt: reservesBeforeSell.usdt - expectedUsdt });
    assert.equal(await balance(usdt, dividend), feeUsdt1);
    assert.equal(await balance(usdt, dividend2), feeUsdt2);
    test(`${label}: 100 CaBi sale sends 3 CaBi to dead and 97 CaBi to pair`);

    const reservesBeforeRouterSell = await getReserves();
    const routerSellOut = outputFor(netXbt, reservesBeforeRouterSell.xbt, reservesBeforeRouterSell.usdt);
    const buyerBeforeRouterSell = await balance(usdt, buyer);
    await approve(xbt, router.address, grossXbt, buyer);
    await write(router, 'swapExactTokensForTokensSupportingFeeOnTransferTokens', [grossXbt, routerSellOut, [xbt.address, usdt.address], buyer, deadline], buyer);
    assert.equal(await balance(xbt, DEAD), sellFee * 2n);
    assert.equal(await balance(usdt, buyer), buyerBeforeRouterSell + routerSellOut);
    test(`${label}: standard V2 router transferFrom sale uses the same CaBi tax`);

    await write(xbt, 'transfer', [recipient, units(10)], buyer);
    assert.equal(await balance(xbt, recipient), units(10));
    await approve(xbt, recipient, units(5), buyer);
    await write(xbt, 'transferFrom', [buyer, recipient, units(5)], recipient);
    assert.equal(await balance(xbt, recipient), units(15));
    assert.equal(await balance(xbt, DEAD), sellFee * 2n);
    test(`${label}: wallet transfer and ordinary transferFrom have no trading tax`);

    // An intentionally imbalanced liquidity request exercises ordinary refunds.
    const xbtDesired = units(10000);
    const usdtDesired = units(1000, decimals);
    const reservesBeforeAdd = await getReserves();
    const usdtAdded = xbtDesired * reservesBeforeAdd.usdt / reservesBeforeAdd.xbt;
    assert(usdtAdded < usdtDesired);
    await write(xbt, 'transfer', [gateway.address, units(1)], lpProvider);
    await write(usdt, 'transfer', [gateway.address, units(1, decimals)], lpProvider);
    const providerBeforeAdd = { xbt: await balance(xbt, lpProvider), usdt: await balance(usdt, lpProvider), lp: await balance(pair, lpProvider) };
    await approve(xbt, gateway.address, xbtDesired, lpProvider);
    await approve(usdt, gateway.address, usdtDesired, lpProvider);
    await write(gateway, 'addLiquidity', [xbtDesired, usdtDesired, xbtDesired, usdtAdded, lpProvider, deadline], lpProvider);
    assert.equal(await balance(xbt, lpProvider), providerBeforeAdd.xbt - xbtDesired);
    assert.equal(await balance(usdt, lpProvider), providerBeforeAdd.usdt - usdtAdded);
    assert.equal(await balance(xbt, gateway.address), units(1));
    assert.equal(await balance(usdt, gateway.address), units(1, decimals));
    assert.equal(await balance(xbt, DEAD), sellFee * 2n);
    const mintedLp = await balance(pair, lpProvider) - providerBeforeAdd.lp;
    assert(mintedLp > 0n);
    test(`${label}: liquidity addition refunds unused input and preserves existing balances`);

    const lpToRemove = mintedLp / 2n;
    const reservesBeforeRemove = await getReserves();
    const lpSupply = await read(pair, 'totalSupply');
    const xbtRemoved = lpToRemove * reservesBeforeRemove.xbt / lpSupply;
    const usdtRemoved = lpToRemove * reservesBeforeRemove.usdt / lpSupply;
    const providerBeforeRemove = { xbt: await balance(xbt, lpProvider), usdt: await balance(usdt, lpProvider), lp: await balance(pair, lpProvider) };
    await approve(pair, gateway.address, lpToRemove, lpProvider);
    await write(gateway, 'removeLiquidity', [lpToRemove, xbtRemoved, usdtRemoved, lpProvider, deadline], lpProvider);
    assert.equal(await balance(xbt, lpProvider), providerBeforeRemove.xbt + xbtRemoved);
    assert.equal(await balance(usdt, lpProvider), providerBeforeRemove.usdt + usdtRemoved);
    assert.equal(await balance(pair, lpProvider), providerBeforeRemove.lp - lpToRemove);
    assert.equal(await balance(xbt, DEAD), sellFee * 2n);
    assert.equal(await balance(xbt, gateway.address), units(1));
    assert.equal(await balance(usdt, gateway.address), units(1, decimals));
    assert.equal(await read(pair, 'allowance', [gateway.address, router.address]), 0n);
    test(`${label}: liquidity removal returns both assets without trading tax`);

    const fractionalGross = units(1, decimals) + 11n;
    const fractionalFee = fractionalGross * 300n / 10000n;
    const fractionalFee1 = fractionalGross * 200n / 10000n;
    const fractionalFee2 = fractionalFee - fractionalFee1;
    const dividendBeforeFractional = await balance(usdt, dividend);
    const dividend2BeforeFractional = await balance(usdt, dividend2);
    const fractionalReserves = await getReserves();
    const fractionalOut = outputFor(fractionalGross - fractionalFee, fractionalReserves.usdt, fractionalReserves.xbt);
    await approve(usdt, gateway.address, fractionalGross, buyer);
    await write(gateway, 'buy', [fractionalGross, fractionalOut, recipient, deadline], buyer);
    assert.equal(await balance(usdt, dividend), dividendBeforeFractional + fractionalFee1);
    assert.equal(await balance(usdt, dividend2), dividend2BeforeFractional + fractionalFee2);
    assert.equal((await getReserves()).usdt, fractionalReserves.usdt + fractionalGross - fractionalFee);
    assert.equal(await balance(xbt, recipient), units(15) + fractionalOut);
    test(`${label}: fractional fee splits preserve the rounded total and exact swap input`);

    // Normal holding-limit scenarios use additional isolated user accounts.
    await write(xbt, 'transfer', [capHolder, units(200000)]);
    assert.equal(await balance(xbt, capHolder), units(200000));
    const ownerBeforeOverLimit = await balance(xbt, owner);
    await expectHoldingLimit(xbt, 'transfer', [capHolder, units(1)]);
    assert.equal(await balance(xbt, capHolder), units(200000));
    assert.equal(await balance(xbt, owner), ownerBeforeOverLimit);
    await write(xbt, 'transfer', [capHolder, units(1)], capHolder);
    assert.equal(await balance(xbt, capHolder), units(200000));
    test(`${label}: transfers can reach the cap, reject excess incoming amounts, and permit self-transfers`);

    await approve(xbt, capRecipient, units(50000), capHolder);
    await write(xbt, 'transferFrom', [capHolder, capRecipient, units(50000)], capRecipient);
    await write(xbt, 'transfer', [capHolder, units(50000)]);
    await approve(xbt, capRecipient, units(1), owner);
    await expectHoldingLimit(xbt, 'transferFrom', [owner, capHolder, units(1)], capRecipient);
    assert.equal(await balance(xbt, capHolder), units(200000));
    assert.equal(await balance(xbt, capRecipient), units(50000));
    assert.equal(await read(xbt, 'allowance', [owner, capRecipient]), units(1));
    test(`${label}: ordinary transferFrom follows the current holding limit`);

    await write(xbt, 'setMaxWalletAmount', [units(300000)]);
    assert.equal(await read(xbt, 'maxWalletAmount'), units(300000));
    await write(xbt, 'transfer', [capHolder, units(50000)]);
    assert.equal(await balance(xbt, capHolder), units(250000));
    await write(xbt, 'setMaxWalletAmount', [units(100000)]);
    assert.equal(await balance(xbt, capHolder), units(250000));
    await write(xbt, 'transfer', [capRecipient, units(25000)], capHolder);
    assert.equal(await balance(xbt, capHolder), units(225000));
    assert.equal(await balance(xbt, capRecipient), units(75000));
    await expectHoldingLimit(xbt, 'transfer', [capHolder, units(1)]);
    test(`${label}: raising the limit permits incoming funds; lowering preserves balances and permits outgoing transfers`);

    const overLimitSaleReserves = await getReserves();
    const overLimitSaleOut = outputFor(netXbt, overLimitSaleReserves.xbt, overLimitSaleReserves.usdt);
    const overLimitHolderUsdtBefore = await balance(usdt, capHolder);
    await approve(xbt, gateway.address, grossXbt, capHolder);
    await write(gateway, 'sell', [grossXbt, overLimitSaleOut, capHolder, deadline], capHolder);
    assert.equal(await balance(xbt, capHolder), units(224900));
    assert.equal(await balance(usdt, capHolder), overLimitHolderUsdtBefore + overLimitSaleOut);
    test(`${label}: existing holdings above a lowered cap can still be sold normally`);

    await write(xbt, 'setMaxWalletAmount', [units(200000)]);
    await write(xbt, 'transfer', [capRecipient, units(125000)]);
    assert.equal(await balance(xbt, capRecipient), units(200000));
    const cappedBuyGross = units(10, decimals);
    const cappedBuyFee = cappedBuyGross * 300n / 10000n;
    const cappedBuyReserves = await getReserves();
    const cappedBuyOut = outputFor(cappedBuyGross - cappedBuyFee, cappedBuyReserves.usdt, cappedBuyReserves.xbt);
    const cappedBuyBefore = { buyerUsdt: await balance(usdt, buyer), dividendUsdt: await balance(usdt, dividend), dividend2Usdt: await balance(usdt, dividend2) };
    await approve(usdt, gateway.address, cappedBuyGross, buyer);
    await expectHoldingLimit(gateway, 'buy', [cappedBuyGross, cappedBuyOut, capRecipient, deadline], buyer);
    assert.equal(await balance(xbt, capRecipient), units(200000));
    assert.equal(await balance(usdt, buyer), cappedBuyBefore.buyerUsdt);
    assert.equal(await balance(usdt, dividend), cappedBuyBefore.dividendUsdt);
    assert.equal(await balance(usdt, dividend2), cappedBuyBefore.dividend2Usdt);
    assert.deepEqual(await getReserves(), cappedBuyReserves);
    await write(xbt, 'setMaxWalletAmount', [units(200000) + cappedBuyOut]);
    await write(gateway, 'buy', [cappedBuyGross, cappedBuyOut, capRecipient, deadline], buyer);
    assert.equal(await balance(xbt, capRecipient), units(200000) + cappedBuyOut);
    test(`${label}: buy recipient follows the adjustable cap without charging a rejected purchase`);

    if (decimals === 18) {
      // Existing sale pricing is denominated in BSC's 18-decimal USDT.
      await write(xbt, 'setMaxWalletAmount', [units(200000)]);
      await write(xbt, 'transfer', [saleHolder, units(200000)]);
      await write(usdt, 'mint', [saleHolder, units(100)]);
      await approve(usdt, sale.address, units(100), saleHolder);
      await write(sale, 'subscribe', [1n, '0x0000000000000000000000000000000000000000'], saleHolder);
      const claimantUsdtBefore = await balance(usdt, saleHolder);
      await expectHoldingLimit(sale, 'claim', [], saleHolder);
      assert.equal(await balance(xbt, saleHolder), units(200000));
      assert.equal(await balance(usdt, saleHolder), claimantUsdtBefore);
      assert.equal(await read(sale, 'claimed', [saleHolder]), 0n);
      await write(xbt, 'setMaxWalletAmount', [units(300000)]);
      await write(sale, 'claim', [], saleHolder);
      assert.equal(await balance(xbt, saleHolder), units(224500));
      assert.equal(await read(sale, 'claimed', [saleHolder]), units(24500));
      test(`${label}: sale claims use the token's updated limit instead of a separate fixed 200,000 cap`);
    }

    // Legitimate administration and purchases continue on the same configured pool.
    // The exempt token owner receives these purchases so user caps stay independent.
    const buyAndCheckDividends = async gross => {
      const [receiver1, receiver2, rate1, rate2] = await Promise.all([
        read(gateway, 'dividendReceiver1'), read(gateway, 'dividendReceiver2'),
        read(gateway, 'dividendRate1Bps'), read(gateway, 'dividendRate2Bps'),
      ]);
      const totalFee = gross * 300n / 10000n;
      const firstFee = gross * rate1 / 10000n;
      const secondFee = totalFee - firstFee;
      assert.equal(rate1 + rate2, 300n);
      assert.deepEqual(await read(gateway, 'previewBuy', [gross]), [totalFee, gross - totalFee]);
      assert.deepEqual(await read(gateway, 'previewDividendSplit', [gross]), [firstFee, secondFee]);
      const before = {
        first: await balance(usdt, receiver1), second: await balance(usdt, receiver2),
        buyerUsdt: await balance(usdt, buyer), ownerXbt: await balance(xbt, owner),
        gatewayUsdt: await balance(usdt, gateway.address), gatewayXbt: await balance(xbt, gateway.address),
        burned: await balance(xbt, DEAD), reserves: await getReserves(),
      };
      const expectedOut = outputFor(gross - totalFee, before.reserves.usdt, before.reserves.xbt);
      await approve(usdt, gateway.address, gross, buyer);
      const receipt = await write(gateway, 'buy', [gross, expectedOut, owner, deadline], buyer);
      assert.equal(await balance(usdt, receiver1), before.first + firstFee);
      assert.equal(await balance(usdt, receiver2), before.second + secondFee);
      assert.equal(await balance(usdt, buyer), before.buyerUsdt - gross);
      assert.equal(await balance(xbt, owner), before.ownerXbt + expectedOut);
      assert.deepEqual(await getReserves(), {
        xbt: before.reserves.xbt - expectedOut, usdt: before.reserves.usdt + gross - totalFee,
      });
      assert.equal(await balance(usdt, gateway.address), before.gatewayUsdt);
      assert.equal(await balance(xbt, gateway.address), before.gatewayXbt);
      assert.equal(await balance(xbt, DEAD), before.burned);
      const paid = parseEventLogs({ abi: gateway.abi, eventName: 'DividendsPaid', logs: receipt.logs });
      assert.equal(paid.length, 1);
      assert.equal(paid[0].args.buyer.toLowerCase(), buyer.toLowerCase());
      assert.equal(paid[0].args.receiver1.toLowerCase(), receiver1.toLowerCase());
      assert.equal(paid[0].args.receiver2.toLowerCase(), receiver2.toLowerCase());
      assert.equal(paid[0].args.amount1, firstFee);
      assert.equal(paid[0].args.amount2, secondFee);
    };

    await write(gateway, 'setDividendRates', [100n, 200n], gatewayAdmin);
    await buyAndCheckDividends(units(10, decimals));
    test(`${label}: administrator changes the split to 1% / 2% and the next purchase uses it`);

    const previousReceiverBalances = [await balance(usdt, dividend), await balance(usdt, dividend2)];
    await write(gateway, 'setDividendReceivers', [updatedDividend1, updatedDividend2], gatewayAdmin);
    await buyAndCheckDividends(units(10, decimals));
    assert.equal(await balance(usdt, dividend), previousReceiverBalances[0]);
    assert.equal(await balance(usdt, dividend2), previousReceiverBalances[1]);
    test(`${label}: administrator replaces both receivers and subsequent fees use the new addresses`);

    await write(gateway, 'transferOwnership', [community], gatewayAdmin);
    assert.equal((await read(gateway, 'owner')).toLowerCase(), community.toLowerCase());
    await write(gateway, 'setDividendRates', [150n, 150n], community);
    await buyAndCheckDividends(units(10, decimals));
    assert.equal((await read(xbt, 'owner')).toLowerCase(), owner.toLowerCase());
    test(`${label}: transferred gateway administrator can configure 1.5% / 1.5% without changing token ownership`);

    for (const [firstRate, secondRate] of [[0n, 300n], [300n, 0n]]) {
      await write(gateway, 'setDividendRates', [firstRate, secondRate], community);
      await buyAndCheckDividends(34n);
      test(`${label}: valid ${firstRate} / ${secondRate} bps split allocates the full rounded fee without residue`);
    }

    await write(gateway, 'setDividendRates', [200n, 100n], community);
    for (const gross of [1n, 34n, 99n, units(1, decimals) + 11n]) {
      await buyAndCheckDividends(gross);
    }
    test(`${label}: smallest-unit and fractional buys conserve both dividends plus swap input and leave no new residue`);
  } finally {
    await provider.disconnect();
  }
}

async function main() {
  const compiled = compile();
  await runScenario(compiled, 18);
  await runScenario(compiled, 6);
  const report = { scope: 'normal trading, dual-dividend administration, and liquidity accounting only', environment: 'isolated in-process Ganache with synthetic accounts/assets and standard Uniswap V2 contracts', results };
  fs.mkdirSync(path.join(ROOT, 'output', 'qa'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'output', 'qa', 'trading-fees-verification.json'), JSON.stringify(report, null, 2));
  console.log(`${results.length} functional checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
