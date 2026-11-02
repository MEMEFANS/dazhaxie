/* eslint-disable @typescript-eslint/no-require-imports -- Isolated contract verification. */
// In-process Ganache and synthetic accounts only. Never reads environment wallets or public RPC.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), solc = require('solc');
process.env.UWS_USE_FALLBACK ??= '1';
const ganache = require('ganache');
const { createPublicClient, createWalletClient, custom, parseUnits, parseEventLogs } = require('viem');
const root = path.resolve(__dirname, '..'), ZERO = '0x0000000000000000000000000000000000000000';
const units = value => parseUnits(String(value), 18), SHARE = units(35000), results = [];
const pass = name => { results.push({ name, valid: true }); console.log('PASS ' + name); };
function compile() {
  const sources = {};
  for (const file of ['XBTToken.sol', 'XBTSale.sol', 'CaBiClaimPool.sol', 'test/TestUSDT.sol']) sources[file] = { content: fs.readFileSync(path.join(root, 'contracts', file), 'utf8') };
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
  assert.deepEqual((output.errors || []).filter(error => error.severity === 'error'), []);
  return (file, name) => ({ abi: output.contracts[file][name].abi, bytecode: '0x' + output.contracts[file][name].evm.bytecode.object });
}
async function scenario(artifact, decimals) {
  const prefix = decimals + '-decimal USDT: ';
  const provider = ganache.provider({ logging: { quiet: true }, wallet: { deterministic: true, totalAccounts: 12 }, chain: { chainId: 31337, hardfork: 'shanghai' } });
  const chain = { id: 31337, name: 'Isolated team reward test', nativeCurrency: { name: 'Test', symbol: 'TEST', decimals: 18 }, rpcUrls: { default: { http: [] } } };
  const client = createPublicClient({ chain, transport: custom(provider), pollingInterval: 10 }), wallet = createWalletClient({ chain, transport: custom(provider) });
  const [owner, alice, bob, carol, david, erin, frank, project, fund, outsider, next] = await wallet.getAddresses();
  const read = (contract, functionName, args = []) => client.readContract({ ...contract, functionName, args });
  const deploy = async (a, args = []) => { const hash = await wallet.deployContract({ ...a, args, account: owner, gas: 12000000n }); const receipt = await client.waitForTransactionReceipt({ hash }); assert.equal(receipt.status, 'success'); return { address: receipt.contractAddress, abi: a.abi }; };
  const send = async (contract, functionName, args = [], account = owner, expected = 'success') => { const hash = await wallet.writeContract({ ...contract, functionName, args, account, gas: 12000000n }); const receipt = await client.waitForTransactionReceipt({ hash }); assert.equal(receipt.status, expected, functionName); return receipt; };
  const fail = (contract, name, args = [], account = owner) => send(contract, name, args, account, 'reverted');
  try {
    const token = await deploy(artifact('XBTToken.sol', 'XBTToken'));
    const quote = await deploy(artifact('test/TestUSDT.sol', 'TestUSDT'), [decimals]);
    const sale = await deploy(artifact('XBTSale.sol', 'XBTSale'), [quote.address, token.address, project, fund]);
    const pool = await deploy(artifact('CaBiClaimPool.sol', 'CaBiClaimPool'), [token.address, sale.address, owner]);
    await send(sale, 'setClaimPool', [pool.address]);
    await send(token, 'setMaxWalletExempt', [pool.address, true]);
    await send(token, 'transfer', [pool.address, units(10000000)]);
    for (const user of [alice, bob, carol, david, erin, frank, outsider, next]) {
      await send(quote, 'mint', [user, parseUnits('1000', decimals)]);
      await send(quote, 'approve', [sale.address, parseUnits('1000', decimals)], user);
    }
    const fields = ['teamRewardShares', 'rewardShares', 'directShares', 'claimed', 'entitlementOf', 'claimableOf'];
    const snapshot = async (users = [alice, david, erin, frank, next]) => ({ reserved: await read(sale, 'reservedTokens'), balance: await read(pool, 'poolBalance'), users: await Promise.all(users.map(async user => [user, ...await Promise.all(fields.map(field => read(sale, field, [user])))])) });
    const rejected = async (args, account = owner, users) => { const before = await snapshot(users); const receipt = await fail(sale, 'batchSetTeamRewardTotals', args, account); assert.equal(receipt.logs.length, 0); assert.deepEqual(await snapshot(users), before); };
    await send(sale, 'subscribe', [2n, alice], bob); await send(sale, 'subscribe', [1n, alice], carol);
    assert.equal(await read(sale, 'directShares', [alice]), 3n); assert.equal(await read(sale, 'rewardShares', [alice]), 1n); assert.equal(await read(sale, 'teamRewardShares', [alice]), 0n); assert.equal(await read(sale, 'reservedTokens'), SHARE * 4n);
    pass(prefix + 'direct referral rewards remain separate from cumulative team totals');
    let receipt = await send(sale, 'batchSetTeamRewardTotals', [[alice], [3n]]);
    let event = parseEventLogs({ abi: sale.abi, eventName: 'TeamRewardTotalSet', logs: receipt.logs })[0].args;
    assert.equal(event.user.toLowerCase(), alice.toLowerCase()); assert.equal(event.total, 3n); assert.equal(event.added, 3n); assert.equal(await read(sale, 'rewardShares', [alice]), 4n); assert.equal(await read(sale, 'reservedTokens'), SHARE * 7n);
    pass(prefix + 'first cumulative team award reserves only its addition and emits total plus delta');
    await rejected([[alice], [3n]]); await rejected([[alice], [2n]]); await rejected([[frank], [0n]]);
    pass(prefix + 'identical totals, lower stale totals and all-zero batches revert without duplicate awards');
    receipt = await send(sale, 'batchSetTeamRewardTotals', [[alice], [5n]]);
    event = parseEventLogs({ abi: sale.abi, eventName: 'TeamRewardTotalSet', logs: receipt.logs })[0].args;
    assert.equal(event.total, 5n); assert.equal(event.added, 2n); assert.equal(await read(sale, 'rewardShares', [alice]), 6n); assert.equal(await read(sale, 'reservedTokens'), SHARE * 9n);
    pass(prefix + 'higher cumulative total credits only the unrecorded difference');
    receipt = await send(sale, 'batchSetTeamRewardTotals', [[alice, david, frank], [5n, 2n, 0n]]);
    const events = parseEventLogs({ abi: sale.abi, eventName: 'TeamRewardTotalSet', logs: receipt.logs }).map(log => log.args.added);
    assert.deepEqual(events, [0n, 2n, 0n]); assert.equal(await read(sale, 'reservedTokens'), SHARE * 11n);
    pass(prefix + 'mixed unchanged and zero entries do not block genuine additions or reserve duplicate value');
    receipt = await send(sale, 'batchSetTeamRewardTotals', [[erin, erin], [3n, 3n]]);
    assert.deepEqual(parseEventLogs({ abi: sale.abi, eventName: 'TeamRewardTotalSet', logs: receipt.logs }).map(log => log.args.added), [3n, 0n]);
    assert.equal(await read(sale, 'teamRewardShares', [erin]), 3n); assert.equal(await read(sale, 'rewardShares', [erin]), 3n);
    await send(sale, 'batchSetTeamRewardTotals', [[erin, erin], [4n, 5n]]); assert.equal(await read(sale, 'rewardShares', [erin]), 5n);
    await rejected([[erin, erin], [6n, 5n]]);
    pass(prefix + 'duplicate addresses cannot double-credit identical totals and decreasing duplicate totals roll back');
    await send(sale, 'batchCreditTeamReward', [[david], [1n]]); assert.equal(await read(sale, 'teamRewardShares', [david]), 3n);
    await rejected([[david], [3n]]); await send(sale, 'batchSetTeamRewardTotals', [[david], [4n]]);
    await send(sale, 'batchCreditTeamReward', [[david], [2n]]); assert.equal(await read(sale, 'teamRewardShares', [david]), 6n); assert.equal(await read(sale, 'rewardShares', [david]), 6n);
    await rejected([[david], [6n]]);
    pass(prefix + 'legacy increments synchronize cumulative team totals across mixed old and new calls');
    await rejected([[frank], [1n]], outsider); await rejected([[ZERO], [1n]]); await rejected([[], []]); await rejected([[alice], []]);
    pass(prefix + 'owner authorization, zero recipients and empty or mismatched arrays reject atomically');
    await rejected([[frank, alice], [2n, 4n]]); await rejected([[frank, ZERO], [2n, 1n]]);
    pass(prefix + 'a later invalid entry rolls back earlier valid allocations in the same batch');
    await rejected([[frank, alice], [2n, 1000000000n]]);
    pass(prefix + 'insufficient backing rolls back all totals, rewards, events and reserve growth');
    const addresses = Array.from({ length: 100 }, (_, i) => '0x' + BigInt(0x1000 + i).toString(16).padStart(40, '0'));
    const reserveBefore100 = await read(sale, 'reservedTokens');
    await send(sale, 'batchSetTeamRewardTotals', [addresses, addresses.map(() => 1n)]);
    assert.equal(await read(sale, 'reservedTokens'), reserveBefore100 + SHARE * 100n);
    assert.equal(await read(sale, 'teamRewardShares', [addresses[99]]), 1n);
    await rejected([[...addresses, frank], Array(101).fill(2n)], owner, [...addresses, frank]);
    pass(prefix + 'exactly 100 entries succeed while 101 entries reject before allocation');
    const timestamp = (await client.getBlock()).timestamp, startsAt = timestamp + 10n;
    await send(pool, 'setClaimStartsAt', [startsAt]);
    await provider.request({ method: 'evm_increaseTime', params: [20] }); await provider.request({ method: 'evm_mine', params: [] });
    const aliceEntitlement = SHARE * 6n;
    assert.equal(await read(pool, 'claimable', [alice]), aliceEntitlement);
    await send(pool, 'claim', [0], alice); assert.equal(await read(sale, 'claimed', [alice]), aliceEntitlement); assert.equal(await read(pool, 'claimed', [alice]), aliceEntitlement / 2n); assert.equal(await read(pool, 'claimable', [alice]), 0n); assert.equal(await read(sale, 'teamRewardShares', [alice]), 5n);
    await rejected([[alice], [5n]]);
    await send(sale, 'batchSetTeamRewardTotals', [[alice], [6n]]); assert.equal(await read(pool, 'claimable', [alice]), SHARE);
    await send(pool, 'claim', [0], alice); assert.equal(await read(pool, 'claimed', [alice]), SHARE * 7n / 2n); assert.equal(await read(pool, 'claimable', [alice]), 0n);
    pass(prefix + 'claimed team totals remain cumulative; only new team differences create fresh claimable rights');
    await send(sale, 'subscribe', [2n, alice], outsider); await send(sale, 'subscribe', [1n, alice], next);
    assert.equal(await read(sale, 'directShares', [alice]), 6n); assert.equal(await read(sale, 'teamRewardShares', [alice]), 6n); assert.equal(await read(sale, 'rewardShares', [alice]), 8n); assert.equal(await read(pool, 'claimable', [alice]), SHARE);
    await send(pool, 'claim', [0], alice); assert.equal(await read(pool, 'claimed', [alice]), SHARE * 4n);
    pass(prefix + 'later automatic direct rewards remain independently claimable without inflating team totals');
    await send(sale, 'setSubscribeLocked', [true]); await send(sale, 'finalize'); await rejected([[alice], [7n]]); await fail(sale, 'batchCreditTeamReward', [[alice], [1n]]);
    pass(prefix + 'finalization rejects both cumulative and legacy team allocations without damaging prior rights');
    const unfunded = await deploy(artifact('XBTSale.sol', 'XBTSale'), [quote.address, token.address, project, fund]);
    await fail(unfunded, 'batchSetTeamRewardTotals', [[alice], [1n]]); assert.equal(await read(unfunded, 'teamRewardShares', [alice]), 0n);
    const unboundPool = await deploy(artifact('CaBiClaimPool.sol', 'CaBiClaimPool'), [token.address, unfunded.address, owner]);
    await send(unfunded, 'setClaimPool', [unboundPool.address]);
    pass(prefix + 'failed unfunded allocations also roll back the entitlement-created binding lock');
    const legacy = await deploy(artifact('XBTSale.sol', 'XBTSale'), [quote.address, token.address, project, fund]);
    await send(token, 'setMaxWalletExempt', [legacy.address, true]); await send(token, 'transfer', [legacy.address, SHARE * 3n]);
    await send(legacy, 'batchSetTeamRewardTotals', [[frank], [1n]]); assert.equal(await read(legacy, 'claimableOf', [frank]), SHARE * 70n / 100n);
    const disallowedPool = await deploy(artifact('CaBiClaimPool.sol', 'CaBiClaimPool'), [token.address, legacy.address, owner]);
    await fail(legacy, 'setClaimPool', [disallowedPool.address]);
    await send(quote, 'approve', [legacy.address, parseUnits('100', decimals)], frank); await send(legacy, 'claim', [], frank);
    await send(legacy, 'batchSetTeamRewardTotals', [[frank], [2n]]); assert.equal(await read(legacy, 'claimableOf', [frank]), SHARE * 70n / 100n);
    await send(legacy, 'claim', [], frank); assert.equal(await read(legacy, 'teamRewardShares', [frank]), 2n);
    await fail(legacy, 'batchSetTeamRewardTotals', [[frank], [2n]]);
    pass(prefix + 'unbound legacy claims preserve 70% settlement and prevent binding after positive team rights');
  } finally { await provider.disconnect(); }
}
async function main() {
  const artifact = compile();
  for (const decimals of [18, 6]) await scenario(artifact, decimals);
  fs.mkdirSync(path.join(root, 'output', 'qa'), { recursive: true });
  fs.writeFileSync(path.join(root, 'output', 'qa', 'team-reward-contract-verification.json'), JSON.stringify({ scope: 'isolated synthetic Ganache cumulative team reward accounting; no public RPC or deployment', results }, null, 2));
  console.log(results.length + ' cumulative team reward contract checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
