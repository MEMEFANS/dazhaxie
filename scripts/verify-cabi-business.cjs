/* eslint-disable @typescript-eslint/no-require-imports -- Isolated cross-contract integration runner. */
// One real CaBiPancakeToken is shared by sale and reward on local V2.
// No public RPC, production key, wallet signature, or network deployment is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');
process.env.UWS_USE_FALLBACK ??= '1';
const ganache = require('ganache');
const { createPublicClient, createWalletClient, custom, parseUnits, parseEventLogs } = require('viem');
const ROOT = path.resolve(__dirname, '..');
const ZERO = '0x0000000000000000000000000000000000000000';
const DEAD = '0x000000000000000000000000000000000000dEaD';
const units = (value, decimals = 18) => parseUnits(String(value), decimals);
const results = [];
function pass(name) { results.push({ name, valid: true }); console.log('PASS ' + name); }
function compile() {
  const sources = {};
  for (const file of ['CaBiPancakeToken.sol', 'XBTSale.sol', 'XBTRewardPool.sol', 'test/TestUSDT.sol']) {
    sources[file] = { content: fs.readFileSync(path.join(ROOT, 'contracts', file), 'utf8') };
  }
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
  const errors = (output.errors || []).filter(error => error.severity === 'error');
  assert.equal(errors.length, 0, errors.map(error => error.formattedMessage).join('\n'));
  return (file, name) => ({ abi: output.contracts[file][name].abi, bytecode: '0x' + output.contracts[file][name].evm.bytecode.object });
}
function dex(packageName, name) {
  const source = require(packageName + '/build/' + name + '.json');
  const bytecode = typeof source.bytecode === 'string' ? source.bytecode : source.evm.bytecode.object;
  return { abi: source.abi, bytecode: bytecode.startsWith('0x') ? bytecode : '0x' + bytecode };
}
async function scenario(artifact, decimals) {
  const provider = ganache.provider({ logging: { quiet: true }, wallet: { deterministic: true, totalAccounts: 12 }, chain: { chainId: 31337, hardfork: 'shanghai' } });
  const chain = { id: 31337, name: 'Local CaBi business integration', nativeCurrency: { name: 'Test', symbol: 'TEST', decimals: 18 }, rpcUrls: { default: { http: [] } } };
  const client = createPublicClient({ chain, transport: custom(provider), pollingInterval: 10 });
  const wallet = createWalletClient({ chain, transport: custom(provider) });
  const [owner, alice, bob, carol, vault, funds, receiver1, receiver2] = await wallet.getAddresses();
  const label = decimals + '-decimal USDT';
  const deploy = async (entry, args = []) => {
    const hash = await wallet.deployContract({ ...entry, args, account: owner, gas: 12000000n });
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success', 'local deployment');
    return { address: receipt.contractAddress, abi: entry.abi };
  };
  const write = async (contract, functionName, args = [], account = owner, expected = 'success') => {
    const hash = await wallet.writeContract({ ...contract, functionName, args, account, gas: 12000000n });
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, expected, functionName);
    return receipt;
  };
  const read = (contract, functionName, args = []) => client.readContract({ ...contract, functionName, args });
  const balance = (contract, account) => read(contract, 'balanceOf', [account]);
  const noTradingTax = (token, receipt) => {
    for (const eventName of ['BuyTaxCollected', 'SellFeeCharged', 'TaxProcessed']) {
      assert.equal(parseEventLogs({ abi: token.abi, eventName, logs: receipt.logs }).length, 0, 'business transfer emits no ' + eventName);
    }
  };
  try {
    const token = await deploy(artifact('CaBiPancakeToken.sol', 'CaBiPancakeToken'), [receiver1, receiver2, owner]);
    const quote = await deploy(artifact('test/TestUSDT.sol', 'TestUSDT'), [decimals]);
    const factory = await deploy(dex('@uniswap/v2-core', 'UniswapV2Factory'), [owner]);
    const router = await deploy(dex('@uniswap/v2-periphery', 'UniswapV2Router02'), [factory.address, quote.address]);
    await write(factory, 'createPair', [token.address, quote.address]);
    const pairAddress = await read(factory, 'getPair', [token.address, quote.address]);
    const sale = await deploy(artifact('XBTSale.sol', 'XBTSale'), [quote.address, token.address, vault, funds]);
    const reward = await deploy(artifact('XBTRewardPool.sol', 'XBTRewardPool'), [token.address, quote.address, vault]);
    assert.equal((await read(sale, 'xbt')).toLowerCase(), token.address.toLowerCase());
    assert.equal((await read(reward, 'xbt')).toLowerCase(), token.address.toLowerCase());
    for (const target of [pairAddress, sale.address, reward.address, vault]) await write(token, 'setMaxWalletExempt', [target, true]);
    await write(quote, 'mint', [owner, units(10000, decimals)]);
    await write(token, 'approve', [router.address, units(1000000)]);
    await write(quote, 'approve', [router.address, units(10000, decimals)]);
    const deadline = (await client.getBlock()).timestamp + 86400n;
    await write(router, 'addLiquidity', [token.address, quote.address, units(1000000), units(10000, decimals), 0n, 0n, owner, deadline]);
    await write(token, 'configureTrading', [router.address, quote.address, pairAddress]);
    assert.equal((await read(token, 'tradingPair')).toLowerCase(), pairAddress.toLowerCase());
    pass(label + ': same new tax token binds real V2 liquidity, sale and reward contracts');

    for (const user of [alice, bob, carol]) await write(quote, 'mint', [user, units(1000, decimals)]);
    // All pool inventory is deliberately provided by ordinary owner transfers/deposits.
    const fundSale = await write(token, 'transfer', [sale.address, units(350000)]);
    noTradingTax(token, fundSale);
    await write(token, 'approve', [reward.address, units(350000)]);
    const fundReward = await write(reward, 'deposit', [units(350000)]);
    noTradingTax(token, fundReward);
    assert.equal(await read(sale, 'poolBalance'), units(350000));
    assert.equal(await read(reward, 'poolBalance'), units(350000));
    assert.equal(await balance(token, token.address), 0n);
    pass(label + ': post-binding manual pool funding is exact and not treated as buy or sell');

    await write(quote, 'approve', [sale.address, units(100, decimals)], alice);
    const subscribe = await write(sale, 'subscribe', [2n, ZERO], alice);
    noTradingTax(token, subscribe);
    assert.equal(await read(sale, 'purchased', [alice]), 2n);
    assert.equal(await read(sale, 'reservedTokens'), units(70000));
    assert.equal(await balance(quote, funds), units(100, decimals));
    assert.equal(await read(sale, 'lpFeeOf', [alice]), units(30, decimals));
    await write(quote, 'approve', [sale.address, units(30, decimals)], alice);
    const claim = await write(sale, 'claimChecked', [vault, units(30, decimals)], alice);
    noTradingTax(token, claim);
    assert.equal(await balance(token, alice), units(49000));
    assert.equal(await balance(token, vault), units(21000));
    assert.equal(await balance(quote, vault), units(30, decimals));
    assert.equal(await read(sale, 'reservedTokens'), 0n);
    assert.equal(await read(sale, 'claimed', [alice]), units(49000));
    pass(label + ': USDT subscription and checked 70/30 claim deliver untaxed promised amounts');

    // An actual direct purchase accrues tax; later business transfers must neither
    // consume that accrued balance nor accidentally initiate swapback.
    await write(quote, 'approve', [router.address, units(100, decimals)], alice);
    await write(router, 'swapExactTokensForTokensSupportingFeeOnTransferTokens', [units(100, decimals), 0n, [quote.address, token.address], alice, deadline], alice);
    const accruedTax = await balance(token, token.address);
    assert(accruedTax > 0n);
    await write(reward, 'batchSetClaimable', [[bob, carol], [units(35000), units(35000)], false]);
    const deadBeforeReward = await balance(token, DEAD);
    const mode0 = await write(reward, 'claimChecked', [0, 50n, 70n, 30n, vault, true], bob);
    noTradingTax(token, mode0);
    assert.equal(await balance(token, bob), units(17500));
    assert.equal(await balance(token, DEAD), deadBeforeReward + units(17500));
    await write(quote, 'approve', [reward.address, units(15, decimals)], carol);
    const mode1 = await write(reward, 'claimChecked', [1, 50n, 70n, 30n, vault, true], carol);
    noTradingTax(token, mode1);
    assert.equal(await balance(token, carol), units(24500));
    assert.equal(await balance(token, vault), units(31500));
    assert.equal(await balance(quote, vault), units(45, decimals));
    assert.equal(await read(reward, 'totalAllocated'), 0n);
    assert.equal(await balance(token, token.address), accruedTax);
    pass(label + ': both checked reward modes coexist with accrued market tax without extra taxation');

    // 实物兑换不走合约：用户直接向后台收款地址做普通 ERC20 transfer。
    const beforeGift = await balance(token, alice);
    const gift = await write(token, 'transfer', [DEAD, units(7000)], alice);
    noTradingTax(token, gift);
    assert.equal(await balance(token, alice), beforeGift - units(7000));
    assert.equal(await balance(token, DEAD), deadBeforeReward + units(17500) + units(7000));
    assert.equal(await balance(token, token.address), accruedTax);
    assert.equal(await read(token, 'totalSupply'), units(1000000000));
    pass(label + ': physical redemption is a plain transfer to the configured payee, with no extra tax');
    assert.equal(await balance(quote, receiver1), 0n);
    assert.equal(await balance(quote, receiver2), 0n);
    pass(label + ': normal business flows do not distribute trading tax');
  } finally { await provider.disconnect(); }
}
async function main() {
  const artifact = compile();
  for (const decimals of [18, 6]) await scenario(artifact, decimals);
  fs.mkdirSync(path.join(ROOT, 'output', 'qa'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'output', 'qa', 'cabi-business-verification.json'), JSON.stringify({ scope: 'single CaBiPancakeToken + real V2 + sale + reward; physical redemption is a plain transfer; local synthetic chain only', results }, null, 2));
  console.log(results.length + ' CaBi cross-module business checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

