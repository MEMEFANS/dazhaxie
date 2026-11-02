/* eslint-disable @typescript-eslint/no-require-imports -- Isolated local contract verification. */
// 合成 Ganache 账户与本地 solc 编译；不读取 .env、私钥、公共 RPC，不做真实部署。
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), solc = require('solc');
process.env.UWS_USE_FALLBACK ??= '1';
const ganache = require('ganache');
const { createPublicClient, createWalletClient, custom, parseUnits, parseEventLogs } = require('viem');
const ROOT = path.resolve(__dirname, '..'), ZERO = '0x0000000000000000000000000000000000000000', DEAD = '0x000000000000000000000000000000000000dEaD';
const units = (value, decimals = 18) => parseUnits(String(value), decimals), results = [];
function pass(name) { results.push(name); console.log('PASS ' + name); }

function compile() {
  const sources = {};
  for (const file of ['CaBiSimpleClaimPool.sol', 'test/TestUSDT.sol']) sources[file] = { content: fs.readFileSync(path.join(ROOT, 'contracts', file), 'utf8') };
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } })));
  const errors = (output.errors || []).filter(item => item.severity === 'error');
  assert.equal(errors.length, 0, errors.map(item => item.formattedMessage).join(' | '));
  const pool = output.contracts['CaBiSimpleClaimPool.sol'].CaBiSimpleClaimPool;
  assert(pool.evm.deployedBytecode.object.length / 2 < 24576, 'claim pool bytecode exceeds EIP-170 limit');
  return (file, name) => ({ abi: output.contracts[file][name].abi, bytecode: '0x' + output.contracts[file][name].evm.bytecode.object });
}

async function scenario(usdtDecimals) {
  const label = usdtDecimals + '-decimal USDT: ';
  const provider = ganache.provider({ logging: { quiet: true }, wallet: { deterministic: true, totalAccounts: 12 }, chain: { chainId: 31337, hardfork: 'shanghai' } });
  const chain = { id: 31337, name: 'Isolated claim pool test', nativeCurrency: { name: 'Test', symbol: 'TEST', decimals: 18 }, rpcUrls: { default: { http: [] } } };
  const client = createPublicClient({ chain, transport: custom(provider), pollingInterval: 10 }), wallet = createWalletClient({ chain, transport: custom(provider) });
  const [owner, alice, bob, carol, lp, outsider, nextOwner] = await wallet.getAddresses();
  const build = compile(), deploy = async (entry, args = [], account = owner) => {
    const hash = await wallet.deployContract({ ...entry, args, account, gas: 12000000n });
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success', 'deployment');
    return { address: receipt.contractAddress, abi: entry.abi };
  };
  const send = async (contract, functionName, args = [], account = owner, expected = 'success') => {
    const hash = await wallet.writeContract({ ...contract, functionName, args, account, gas: 12000000n });
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, expected, functionName + ' expected ' + expected);
    return receipt;
  };
  const read = (contract, functionName, args = []) => client.readContract({ ...contract, functionName, args });

  const token = await deploy(build('test/TestUSDT.sol', 'TestUSDT'), [18]);
  const usdt = await deploy(build('test/TestUSDT.sol', 'TestUSDT'), [usdtDecimals]);
  const pool = await deploy(build('CaBiSimpleClaimPool.sol', 'CaBiSimpleClaimPool'), [token.address, owner]);

  assert.equal((await read(pool, 'owner')).toLowerCase(), owner.toLowerCase());
  assert.equal((await read(pool, 'token')).toLowerCase(), token.address.toLowerCase());
  assert.equal(await read(pool, 'directRatio'), 50n);
  assert.equal(await read(pool, 'lpRatio'), 70n);
  assert.equal(await read(pool, 'lpTokenRatio'), 30n);
  assert.equal(await read(pool, 'lpUsdtRatio'), 30n);
  // 构造参数缺失/零地址必须失败。
  await assert.rejects(() => deploy(build('CaBiSimpleClaimPool.sol', 'CaBiSimpleClaimPool'), [ZERO, owner]));
  await assert.rejects(() => deploy(build('CaBiSimpleClaimPool.sol', 'CaBiSimpleClaimPool'), [token.address, ZERO]));
  pass(label + 'constructor takes (token, owner), validates zero addresses and keeps 50/70/30 defaults');

  await send(pool, 'setUsdt', [usdt.address]);
  assert.equal((await read(pool, 'usdt')).toLowerCase(), usdt.address.toLowerCase());
  assert.equal(Number(await read(pool, 'usdtDecimals')), usdtDecimals);
  await send(pool, 'setLpReceiver', [lp]);
  assert.equal((await read(pool, 'lpReceiver')).toLowerCase(), lp.toLowerCase());
  await assert.rejects(async () => send(pool, 'setUsdt', [ZERO], owner, 'success'));
  await assert.rejects(async () => send(pool, 'setLpReceiver', [ZERO], owner, 'success'));
  pass(label + 'owner wires USDT/LP receiver and rejects zero addresses');

  // 非 owner 操作全部失败。
  for (const [fn, args] of [['deposit', [units(1)]], ['withdrawUnused', [units(1)]], ['setLpReceiver', [bob]], ['setBurnRemainder', [false]], ['setRatios', [50, 70, 30, 30]]]) {
    await assert.rejects(() => send(pool, fn, args, outsider), undefined, fn);
  }
  await assert.rejects(() => send(pool, 'batchSetClaimable', [[alice], [units(1)], false], outsider));
  pass(label + 'non-owner cannot fund, withdraw, allocate or change policy');

  // 充值：owner 需要先 approve。
  await send(token, 'mint', [owner, units(1000000)]);
  await assert.rejects(() => send(pool, 'deposit', [units(1000)]));
  await send(token, 'approve', [pool.address, units(1000000)]);
  await send(pool, 'deposit', [units(1000000)]);
  assert.equal(await read(pool, 'poolBalance'), units(1000000));
  assert.equal(await read(pool, 'totalAllocated'), 0n);
  assert.equal(await read(pool, 'allocatedUnclaimed'), 0n);
  assert.equal(await read(pool, 'unusedBalance'), units(1000000));
  pass(label + 'deposit pulls CaBi after approval and counts entirely as unused before allocation');

  // 批量写入：增量 / 覆盖 / 已领取限制 / 参数校验。
  await send(pool, 'batchSetClaimable', [[alice, bob], [units(35000), units(70000)], false]);
  assert.equal(await read(pool, 'claimableOf', [alice]), units(35000));
  assert.equal(await read(pool, 'claimableOf', [bob]), units(70000));
  assert.equal(await read(pool, 'totalAllocated'), units(105000));
  assert.equal(await read(pool, 'allocatedUnclaimed'), units(105000));
  assert.equal(await read(pool, 'unusedBalance'), units(895000));
  await send(pool, 'batchSetClaimable', [[alice], [units(1000)], true]);
  assert.equal(await read(pool, 'claimableOf', [alice]), units(36000));
  assert.equal(await read(pool, 'totalAllocated'), units(106000));
  await send(pool, 'batchSetClaimable', [[alice], [units(35000)], false]);
  assert.equal(await read(pool, 'claimableOf', [alice]), units(35000));
  assert.equal(await read(pool, 'totalAllocated'), units(105000));
  await assert.rejects(() => send(pool, 'batchSetClaimable', [[ZERO], [units(1)], false]));
  await assert.rejects(() => send(pool, 'batchSetClaimable', [[alice, bob], [units(1)], false]));
  await assert.rejects(() => send(pool, 'batchSetClaimable', [[], [], false]));
  const many = Array.from({ length: 201 }, (_, index) => '0x' + (index + 1).toString(16).padStart(40, '0'));
  await assert.rejects(() => send(pool, 'batchSetClaimable', [many, many.map(() => units(1)), true]));
  const hundred = Array.from({ length: 100 }, (_, index) => '0x' + (index + 1001).toString(16).padStart(40, '0'));
  await send(pool, 'batchSetClaimable', [hundred, hundred.map(() => 0n), true]);
  pass(label + 'batchSetClaimable supports incremental and overwrite, tracks totals and rejects zero/empty/mismatched/oversized batches');

  // 预览：mode 0 / mode 1 与 30% USDT 折算。
  const preview0 = await read(pool, 'previewClaim', [alice, 0]);
  assert.deepEqual(Array.from(preview0), [units(35000), units(17500), units(17500), 0n, 0n]);
  const preview1 = await read(pool, 'previewClaim', [alice, 1]);
  assert.deepEqual(Array.from(preview1), [units(35000), units(24500), 0n, units(10500), units(15, usdtDecimals)]);
  await assert.rejects(() => read(pool, 'previewClaim', [alice, 2]));
  pass(label + 'previewClaim returns 50%/70%, burn vs LP split and exact 30% USDT equivalent');

  // mode 0：领 50%，剩余销毁，一次性领取。
  await send(pool, 'claim', [0], alice);
  assert.equal(await read(token, 'balanceOf', [alice]), units(17500));
  assert.equal(await read(token, 'balanceOf', [DEAD]), units(17500));
  assert.equal(await read(pool, 'hasClaimed', [alice]), true);
  assert.equal(await read(pool, 'claimableOf', [alice]), 0n);
  assert.equal(await read(pool, 'totalClaimed'), units(35000));
  assert.equal(await read(pool, 'totalBurned'), units(17500));
  assert.equal(await read(pool, 'allocatedUnclaimed'), units(70000));
  assert.equal(await read(pool, 'unusedBalance'), units(895000));
  await assert.rejects(() => send(pool, 'claim', [0], alice));
  await assert.rejects(() => send(pool, 'claim', [1], alice));
  await assert.rejects(() => send(pool, 'batchSetClaimable', [[alice], [units(1)], true]));
  pass(label + 'mode 0 pays 50%, burns the remainder, consumes the full entitlement once and blocks re-claims/re-allocations');

  // mode 1：领 70%，30% 代币进 LP，同时收 30% USDT 等值。
  await send(usdt, 'mint', [bob, units(30, usdtDecimals)]);
  await send(usdt, 'approve', [pool.address, units(30, usdtDecimals)], bob);
  await send(pool, 'claim', [1], bob);
  assert.equal(await read(token, 'balanceOf', [bob]), units(49000));
  assert.equal(await read(token, 'balanceOf', [lp]), units(21000));
  assert.equal(await read(usdt, 'balanceOf', [lp]), units(30, usdtDecimals));
  assert.equal(await read(usdt, 'balanceOf', [bob]), 0n);
  assert.equal(await read(pool, 'totalLpTokens'), units(21000));
  assert.equal(await read(pool, 'totalUsdtCharged'), units(30, usdtDecimals));
  assert.equal(await read(pool, 'totalClaimed'), units(105000));
  assert.equal(await read(pool, 'unusedBalance'), units(895000));
  pass(label + 'mode 1 pays 70%, sends 30% CaBi to LP receiver and charges the exact 30% USDT equivalent');

  // 未分配余额可取回，但已分配未领的额度必须留下。
  await send(pool, 'batchSetClaimable', [[carol], [units(70000)], false]);
  assert.equal(await read(pool, 'unusedBalance'), units(825000));
  await send(pool, 'withdrawUnused', [units(825000)]);
  assert.equal(await read(pool, 'unusedBalance'), 0n);
  assert.equal(await read(pool, 'poolBalance'), units(70000));
  assert.equal(await read(pool, 'allocatedUnclaimed'), units(70000));
  await assert.rejects(() => send(pool, 'withdrawUnused', [units(1)]));

  // 池内余额不足时整体 revert，不写入领取记录。
  await send(pool, 'batchSetClaimable', [[carol], [units(100000)], false]);
  await assert.rejects(() => send(pool, 'claim', [0], carol));
  assert.equal(await read(pool, 'hasClaimed', [carol]), false);
  assert.equal(await read(pool, 'claimableOf', [carol]), units(100000));
  await send(pool, 'batchSetClaimable', [[carol], [units(70000)], false]);
  pass(label + 'withdrawUnused cannot touch allocated-unclaimed value and an underfunded claim reverts atomically');

  // burnRemainder=false：剩余留在池内并转为未分配余额。
  await send(token, 'mint', [owner, units(70000)]);
  await send(token, 'approve', [pool.address, units(70000)]);
  await send(pool, 'deposit', [units(70000)]);
  await send(pool, 'setBurnRemainder', [false]);
  await send(pool, 'claim', [0], carol);
  assert.equal(await read(token, 'balanceOf', [carol]), units(35000));
  assert.equal(await read(pool, 'totalBurned'), units(17500));
  assert.equal(await read(pool, 'allocatedUnclaimed'), 0n);
  assert.equal(await read(pool, 'unusedBalance'), units(105000));
  assert.equal(await read(pool, 'poolBalance'), units(105000));
  pass(label + 'burnRemainder=false keeps the 50% remainder as reusable unused balance');

  // 比例 setter：上限 100、必须守恒 100。
  for (const ratios of [[0, 70, 30, 30], [101, 70, 30, 30], [50, 0, 30, 30], [50, 70, 101, 30], [50, 70, 0, 30], [50, 70, 30, 0], [50, 70, 20, 30], [50, 80, 30, 30]]) {
    await assert.rejects(() => send(pool, 'setRatios', ratios), undefined, JSON.stringify(ratios));
  }
  await send(pool, 'setRatios', [50, 70, 30, 30]);
  assert.equal(await read(pool, 'directRatio'), 50n);
  pass(label + 'setRatios enforces 0<ratio<=100 and direct+lpToken=lp+lpToken=100');

  // 两步 owner。
  await send(pool, 'transferOwnership', [nextOwner]);
  assert.equal(await read(pool, 'pendingOwner'), nextOwner);
  await assert.rejects(() => send(pool, 'acceptOwnership', [], alice));
  await send(pool, 'acceptOwnership', [], nextOwner);
  assert.equal(await read(pool, 'owner'), nextOwner);
  await assert.rejects(() => send(pool, 'deposit', [units(1)], owner));
  pass(label + 'ownership is two-step and old owner loses privileges after acceptance');

  // 事件覆盖。
  const events = await client.getLogs({ address: pool.address, fromBlock: 0n, toBlock: 'latest' });
  const names = new Set(parseEventLogs({ abi: pool.abi, logs: events }).map(event => event.eventName));
  for (const name of ['Deposit', 'WithdrawUnused', 'ClaimableSet', 'Claimed', 'LpReceiverUpdated', 'UsdtUpdated', 'BurnRemainderUpdated', 'RatiosUpdated', 'OwnershipTransferred']) assert(names.has(name), 'missing event ' + name);
  pass(label + 'funding, allocation, claim, policy and ownership events are emitted');
}

(async () => {
  try {
    await scenario(6);
    await scenario(18);
    console.log(results.length + ' simple claim pool checks passed.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();
