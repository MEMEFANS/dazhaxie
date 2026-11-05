/* eslint-disable @typescript-eslint/no-require-imports -- Isolated local contract verification. */
// 合成 Ganache 账户 + 本地 solc + viem；不读取 .env、私钥或公共 RPC。
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), solc = require('solc');
process.env.UWS_USE_FALLBACK ??= '1';
const ganache = require('ganache');
const { createPublicClient, createWalletClient, custom, parseUnits, parseEventLogs, keccak256, encodeAbiParameters, encodePacked } = require('viem');
const ROOT = path.resolve(__dirname, '..'), ZERO = '0x0000000000000000000000000000000000000000';
const units = (value, decimals = 18) => parseUnits(String(value), decimals), results = [];
function pass(name) { results.push(name); console.log('PASS ' + name); }

function compile() {
  const sources = {};
  for (const file of ['CaBiMerkleClaimPool.sol', 'test/TestUSDT.sol']) sources[file] = { content: fs.readFileSync(path.join(ROOT, 'contracts', file), 'utf8') };
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } })));
  const errors = (output.errors || []).filter(item => item.severity === 'error');
  assert.equal(errors.length, 0, errors.map(item => item.formattedMessage).join(' | '));
  const pool = output.contracts['CaBiMerkleClaimPool.sol'].CaBiMerkleClaimPool;
  assert(pool.evm.deployedBytecode.object.length / 2 < 24576, 'merkle claim pool bytecode exceeds EIP-170 limit');
  for (const forbidden of ['signer', 'setSigner', 'claimDigest', 'nonceUsed', 'deposit', 'withdrawUnused', 'mode', 'setClaimLimit']) {
    assert(!pool.abi.some(item => item.name === forbidden), 'ABI must not keep the EIP-712 path: ' + forbidden);
  }
  const claim = pool.abi.find(item => item.name === 'claim');
  assert(claim, 'claim exists');
  assert.deepEqual(claim.inputs.map(input => input.type), ['uint256', 'bytes32[]'], 'claim takes (cumulativeAmount, proof)');
  const setRoot = pool.abi.find(item => item.name === 'setMerkleRoot');
  assert.deepEqual(setRoot.inputs.map(input => input.type), ['bytes32', 'uint256'], 'setMerkleRoot takes (root, epoch)');
  return (file, name) => ({ abi: output.contracts[file][name].abi, bytecode: '0x' + output.contracts[file][name].evm.bytecode.object });
}

// 与合约一致的离线 Merkle 实现：leaf = keccak256(abi.encode(address, uint256, uint256))，节点按 bytes32 排序。
function claimLeaf(epoch, address, amount) {
  return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }], [address, amount, BigInt(epoch)]));
}
function hashPair(left, right) {
  return BigInt(left) <= BigInt(right) ? keccak256(encodePacked(['bytes32', 'bytes32'], [left, right])) : keccak256(encodePacked(['bytes32', 'bytes32'], [right, left]));
}
function buildMerkle(entries, epoch) {
  const sorted = [...entries].sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  const leaves = sorted.map(entry => claimLeaf(epoch, entry.address, entry.amount));
  const layers = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const current = layers[layers.length - 1], next = [];
    for (let i = 0; i < current.length; i += 2) next.push(i + 1 === current.length ? current[i] : hashPair(current[i], current[i + 1]));
    layers.push(next);
  }
  const proofs = new Map();
  sorted.forEach((entry, index) => {
    const proof = []; let cursor = index;
    for (let level = 0; level < layers.length - 1; level += 1) {
      const sibling = cursor ^ 1;
      if (sibling < layers[level].length) proof.push(layers[level][sibling]);
      cursor = Math.floor(cursor / 2);
    }
    proofs.set(entry.address.toLowerCase(), proof);
  });
  return { root: layers[layers.length - 1][0], proofs };
}

async function scenario(usdtDecimals) {
  const label = usdtDecimals + '-decimal USDT: ';
  const provider = ganache.provider({ logging: { quiet: true }, wallet: { deterministic: true, totalAccounts: 12 }, chain: { chainId: 31337, hardfork: 'shanghai' } });
  const chain = { id: 31337, name: 'Isolated merkle claim pool test', nativeCurrency: { name: 'Test', symbol: 'TEST', decimals: 18 }, rpcUrls: { default: { http: [] } } };
  const client = createPublicClient({ chain, transport: custom(provider), pollingInterval: 10 }), wallet = createWalletClient({ chain, transport: custom(provider) });
  const [owner, alice, bob, carol, lp, outsider, newOwner] = await wallet.getAddresses();
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
  const pool = await deploy(build('CaBiMerkleClaimPool.sol', 'CaBiMerkleClaimPool'), [token.address, owner]);

  assert.equal((await read(pool, 'owner')).toLowerCase(), owner.toLowerCase());
  assert.equal((await read(pool, 'token')).toLowerCase(), token.address.toLowerCase());
  assert.equal(await read(pool, 'PAYOUT_RATIO'), 70n);
  assert.equal(await read(pool, 'LP_TOKEN_RATIO'), 30n);
  assert.equal(await read(pool, 'LP_USDT_RATIO'), 30n);
  assert.equal(await read(pool, 'merkleRoot'), '0x' + '0'.repeat(64));
  assert.equal(await read(pool, 'epoch'), 0n);
  await assert.rejects(() => deploy(build('CaBiMerkleClaimPool.sol', 'CaBiMerkleClaimPool'), [ZERO, owner]));
  await assert.rejects(() => deploy(build('CaBiMerkleClaimPool.sol', 'CaBiMerkleClaimPool'), [token.address, ZERO]));
  pass(label + 'constructor takes (token, owner), rejects zero addresses and exposes fixed 70/30/30 rules');

  // owner 配置 USDT / LP；非 owner 不能改任何管理项。
  await send(pool, 'setUsdt', [usdt.address]);
  assert.equal(Number(await read(pool, 'usdtDecimals')), usdtDecimals);
  await send(pool, 'setLpReceiver', [lp]);
  await assert.rejects(() => send(pool, 'setUsdt', [ZERO]));
  await assert.rejects(() => send(pool, 'setLpReceiver', [ZERO]));
  for (const [fn, args] of [['setUsdt', [usdt.address]], ['setLpReceiver', [lp]], ['setMerkleRoot', [claimLeaf(1, alice, units(1)), 1n]]]) {
    await assert.rejects(() => send(pool, fn, args, outsider), undefined, fn);
  }
  pass(label + 'owner wires USDT/LP and only owner can publish roots');

  // owner 直接转入代币即可，无 deposit 入口。
  await send(token, 'mint', [owner, units(1000000)]);
  await send(token, 'transfer', [pool.address, units(1000000)]);
  assert.equal(await read(pool, 'poolBalance'), units(1000000));
  pass(label + 'owner funds the pool with a plain ERC20 transfer; no deposit or approval path exists');

  // 第一批：Alice 35000、Bob 7000、Carol 3500，累计额度。
  const batch1 = buildMerkle([
    { address: alice, amount: units(35000) }, { address: bob, amount: units(7000) }, { address: carol, amount: units(3500) },
  ], 1);
  await assert.rejects(() => send(pool, 'setMerkleRoot', ['0x' + '0'.repeat(64), 1n]));
  await assert.rejects(() => send(pool, 'setMerkleRoot', [batch1.root, 0n]));
  await send(pool, 'setMerkleRoot', [batch1.root, 1n]);
  assert.equal((await read(pool, 'merkleRoot')).toLowerCase(), batch1.root.toLowerCase());
  assert.equal(await read(pool, 'epoch'), 1n);
  pass(label + 'owner publishes the first Merkle root and epoch must advance from zero');

  // 错误 proof / 错误金额 / 未配置 LP 都整体回滚，不写入 claimedOf。
  const aliceProof = batch1.proofs.get(alice.toLowerCase()), bobProof = batch1.proofs.get(bob.toLowerCase());
  await assert.rejects(() => send(pool, 'claim', [units(35000), bobProof], alice), undefined, 'wrong proof');
  await assert.rejects(() => send(pool, 'claim', [units(70000), aliceProof], alice), undefined, 'tampered amount');
  assert.equal(await read(pool, 'claimedOf', [alice]), 0n);

  const lpUnsetPool = await deploy(build('CaBiMerkleClaimPool.sol', 'CaBiMerkleClaimPool'), [token.address, owner]);
  await send(lpUnsetPool, 'setUsdt', [usdt.address]);
  await send(token, 'mint', [owner, units(1000)]);
  await send(token, 'transfer', [lpUnsetPool.address, units(1000)]);
  const lpUnsetBatch = buildMerkle([{ address: alice, amount: units(1000) }], 1);
  await send(lpUnsetPool, 'setMerkleRoot', [lpUnsetBatch.root, 1n]);
  await send(usdt, 'mint', [alice, units('0.5', usdtDecimals)]);
  await send(usdt, 'approve', [lpUnsetPool.address, units('0.5', usdtDecimals)], alice);
  await assert.rejects(() => send(lpUnsetPool, 'claim', [units(1000), lpUnsetBatch.proofs.get(alice.toLowerCase())], alice), undefined, 'lp receiver unset');
  assert.equal(await read(lpUnsetPool, 'claimedOf', [alice]), 0n);
  pass(label + 'invalid proof and an unconfigured lpReceiver revert without touching claimed balances');

  // USDT 余额 / 授权不足时整笔回滚；补齐后 70% 到账、30% 代币与 30% USDT 进 LP。
  await assert.rejects(() => send(pool, 'claim', [units(35000), aliceProof], alice), undefined, 'missing USDT balance');
  await send(usdt, 'mint', [alice, units(15, usdtDecimals)]);
  await assert.rejects(() => send(pool, 'claim', [units(35000), aliceProof], alice), undefined, 'missing USDT allowance');
  assert.equal(await read(pool, 'claimedOf', [alice]), 0n);
  await send(usdt, 'approve', [pool.address, units(15, usdtDecimals)], alice);
  await send(pool, 'claim', [units(35000), aliceProof], alice);
  assert.equal(await read(token, 'balanceOf', [alice]), units(24500));
  assert.equal(await read(token, 'balanceOf', [lp]), units(10500));
  assert.equal(await read(usdt, 'balanceOf', [lp]), units(15, usdtDecimals));
  assert.equal(await read(usdt, 'balanceOf', [alice]), units('0.5', usdtDecimals));
  assert.equal(await read(pool, 'claimedOf', [alice]), units(35000));
  assert.equal(await read(pool, 'totalClaimed'), units(35000));
  assert.equal(await read(pool, 'totalLpTokens'), units(10500));
  assert.equal(await read(pool, 'totalUsdtCharged'), units(15, usdtDecimals));
  pass(label + 'claim pays 70%, routes 30% tokens to the LP receiver and charges the exact 30% USDT equivalent');

  // 重复领取同一累计额度被拒绝。
  await assert.rejects(() => send(pool, 'claim', [units(35000), aliceProof], alice), undefined, 'already claimed');
  pass(label + 'claiming the same cumulative amount twice is rejected');

  // 第二批：Alice 累计 70000，只补 35000 差额；epoch 2 使旧 proof 失效。
  const batch2 = buildMerkle([
    { address: alice, amount: units(70000) }, { address: bob, amount: units(7000) }, { address: carol, amount: units(3500) },
  ], 2);
  await send(pool, 'setMerkleRoot', [batch2.root, 2n]);
  await assert.rejects(() => send(pool, 'claim', [units(7000), bobProof], bob), undefined, 'stale proof');
  await send(usdt, 'mint', [alice, units(15, usdtDecimals)]);
  await send(usdt, 'approve', [pool.address, units(15, usdtDecimals)], alice);
  await send(pool, 'claim', [units(70000), batch2.proofs.get(alice.toLowerCase())], alice);
  assert.equal(await read(token, 'balanceOf', [alice]), units(49000));
  assert.equal(await read(pool, 'claimedOf', [alice]), units(70000));
  pass(label + 'a new epoch only pays the delta and invalidates the previous root proofs');

  // 池余额不足整体回滚，不写入 claimedOf，也不收 USDT。
  const sparsePool = await deploy(build('CaBiMerkleClaimPool.sol', 'CaBiMerkleClaimPool'), [token.address, owner]);
  await send(sparsePool, 'setUsdt', [usdt.address]);
  await send(sparsePool, 'setLpReceiver', [lp]);
  await send(token, 'mint', [owner, units(100)]);
  await send(token, 'transfer', [sparsePool.address, units(100)]);
  const sparseBatch = buildMerkle([{ address: outsider, amount: units(1000) }], 1);
  await send(sparsePool, 'setMerkleRoot', [sparseBatch.root, 1n]);
  await send(usdt, 'mint', [outsider, units('0.5', usdtDecimals)]);
  await send(usdt, 'approve', [sparsePool.address, units('0.5', usdtDecimals)], outsider);
  await assert.rejects(() => send(sparsePool, 'claim', [units(1000), sparseBatch.proofs.get(outsider.toLowerCase())], outsider), undefined, 'underfunded');
  assert.equal(await read(sparsePool, 'claimedOf', [outsider]), 0n);
  assert.equal(await read(usdt, 'balanceOf', [lp]), units(30, usdtDecimals));
  pass(label + 'an underfunded pool reverts atomically without consuming the entitlement or USDT');

  // 报价：差额 70000 -> 49000 / 21000 / 30 USDT。
  const preview = await read(pool, 'previewClaim', [carol, units(70000)]);
  assert.deepEqual(Array.from(preview), [units(70000), units(49000), units(21000), units(30, usdtDecimals)]);
  pass(label + 'previewClaim reports delta, 70/30 split and the exact 30% USDT equivalent');

  // 两步 owner。
  await send(pool, 'transferOwnership', [newOwner]);
  assert.equal(await read(pool, 'pendingOwner'), newOwner);
  await assert.rejects(() => send(pool, 'acceptOwnership', [], alice));
  await send(pool, 'acceptOwnership', [], newOwner);
  assert.equal(await read(pool, 'owner'), newOwner);
  pass(label + 'ownership is two-step and the previous owner loses privileges after acceptance');

  // 事件覆盖。
  const events = await client.getLogs({ address: pool.address, fromBlock: 0n, toBlock: 'latest' });
  const names = new Set(parseEventLogs({ abi: pool.abi, logs: events }).map(event => event.eventName));
  for (const name of ['MerkleRootUpdated', 'Claimed', 'LpReceiverUpdated', 'UsdtUpdated', 'OwnershipTransferred']) assert(names.has(name), 'missing event ' + name);
  pass(label + 'root, claim and configuration events are emitted');
}

(async () => {
  try {
    await scenario(6);
    await scenario(18);
    console.log(results.length + ' merkle claim pool checks passed.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();
