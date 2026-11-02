/* eslint-disable @typescript-eslint/no-require-imports -- Isolated local contract verification. */
// 合成 Ganache 账户 + 本地 solc 编译 + viem 本地签名；不读取 .env、私钥文件或公共 RPC。
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), solc = require('solc');
process.env.UWS_USE_FALLBACK ??= '1';
const ganache = require('ganache');
const { createPublicClient, createWalletClient, custom, parseUnits, parseEventLogs, hashTypedData } = require('viem');
const { privateKeyToAccount, generatePrivateKey } = require('viem/accounts');
const ROOT = path.resolve(__dirname, '..'), ZERO = '0x0000000000000000000000000000000000000000', DEAD = '0x000000000000000000000000000000000000dEaD';
const units = (value, decimals = 18) => parseUnits(String(value), decimals), results = [];
function pass(name) { results.push(name); console.log('PASS ' + name); }

function compile() {
  const sources = {};
  for (const file of ['CaBiSignedClaimPool.sol', 'test/TestUSDT.sol']) sources[file] = { content: fs.readFileSync(path.join(ROOT, 'contracts', file), 'utf8') };
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } })));
  const errors = (output.errors || []).filter(item => item.severity === 'error');
  assert.equal(errors.length, 0, errors.map(item => item.formattedMessage).join(' | '));
  const pool = output.contracts['CaBiSignedClaimPool.sol'].CaBiSignedClaimPool;
  assert(pool.evm.deployedBytecode.object.length / 2 < 24576, 'signed claim pool bytecode exceeds EIP-170 limit');
  return (file, name) => ({ abi: output.contracts[file][name].abi, bytecode: '0x' + output.contracts[file][name].evm.bytecode.object });
}

const CLAIM_TYPES = {
  Claim: [
    { name: 'user', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }, { name: 'mode', type: 'uint8' },
  ],
};

async function scenario(usdtDecimals) {
  const label = usdtDecimals + '-decimal USDT: ';
  const provider = ganache.provider({ logging: { quiet: true }, wallet: { deterministic: true, totalAccounts: 12 }, chain: { chainId: 31337, hardfork: 'shanghai' } });
  const chain = { id: 31337, name: 'Isolated signed claim pool test', nativeCurrency: { name: 'Test', symbol: 'TEST', decimals: 18 }, rpcUrls: { default: { http: [] } } };
  const client = createPublicClient({ chain, transport: custom(provider), pollingInterval: 10 }), wallet = createWalletClient({ chain, transport: custom(provider) });
  const [owner, alice, bob, carol, lp, outsider, newOwner] = await wallet.getAddresses();
  const signer = privateKeyToAccount(generatePrivateKey()), nextSigner = privateKeyToAccount(generatePrivateKey());
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
  const pool = await deploy(build('CaBiSignedClaimPool.sol', 'CaBiSignedClaimPool'), [token.address, signer.address, owner]);

  const now = async () => Number((await client.getBlock({ blockTag: 'latest' })).timestamp);
  let nonceSeed = 1;
  async function sign(signerAccount, user, amount, mode, options = {}) {
    const currentSigner = options.signer || signerAccount;
    const nonce = options.nonce !== undefined ? options.nonce : BigInt(nonceSeed++);
    const deadline = options.deadline !== undefined ? options.deadline : BigInt(await now() + 600);
    const signature = await currentSigner.signTypedData({
      domain: { name: 'CaBiSignedClaimPool', version: '1', chainId: 31337, verifyingContract: pool.address },
      types: CLAIM_TYPES, primaryType: 'Claim', message: { user, amount, nonce, deadline, mode },
    });
    return { amount, nonce, deadline, mode, signature };
  }
  const claim = (account, authorization, expectedAmount) => send(pool, 'claim',
    [expectedAmount ?? authorization.amount, authorization.nonce, authorization.deadline, authorization.mode, authorization.signature], account);

  assert.equal((await read(pool, 'owner')).toLowerCase(), owner.toLowerCase());
  assert.equal((await read(pool, 'signer')).toLowerCase(), signer.address.toLowerCase());
  assert.equal((await read(pool, 'token')).toLowerCase(), token.address.toLowerCase());
  assert.equal(await read(pool, 'directRatio'), 50n);
  assert.equal(await read(pool, 'lpRatio'), 70n);
  assert.equal(await read(pool, 'lpTokenRatio'), 30n);
  assert.equal(await read(pool, 'lpUsdtRatio'), 30n);
  await assert.rejects(() => deploy(build('CaBiSignedClaimPool.sol', 'CaBiSignedClaimPool'), [ZERO, signer.address, owner]));
  await assert.rejects(() => deploy(build('CaBiSignedClaimPool.sol', 'CaBiSignedClaimPool'), [token.address, ZERO, owner]));
  await assert.rejects(() => deploy(build('CaBiSignedClaimPool.sol', 'CaBiSignedClaimPool'), [token.address, signer.address, ZERO]));
  pass(label + 'constructor takes (token, signer, owner), rejects zero addresses and keeps 50/70/30 defaults');

  // owner 配置 USDT / LP / 比例；signer 不能改任何管理项。
  await send(pool, 'setUsdt', [usdt.address]);
  assert.equal(Number(await read(pool, 'usdtDecimals')), usdtDecimals);
  await send(pool, 'setLpReceiver', [lp]);
  await assert.rejects(() => send(pool, 'setUsdt', [ZERO]));
  await assert.rejects(() => send(pool, 'setLpReceiver', [ZERO]));
  await assert.rejects(() => send(pool, 'setSigner', [ZERO]));
  for (const [fn, args] of [['setUsdt', [usdt.address]], ['setLpReceiver', [lp]], ['setSigner', [outsider]], ['setRatios', [50, 70, 30, 30]], ['setBurnRemainder', [false]], ['setClaimLimit', [alice, units(1)]]]) {
    await assert.rejects(() => send(pool, fn, args, outsider), undefined, fn);
  }
  pass(label + 'owner wires USDT/LP and only owner can change signer, policy or claim limits');

  // signer 私钥无权转移资金。
  for (const [fn, args] of [['deposit', [units(1)]], ['withdrawUnused', [units(1)]]]) {
    await assert.rejects(() => wallet.writeContract({ address: pool.address, abi: pool.abi, functionName: fn, args, account: signer, gas: 12000000n }), undefined, fn);
  }
  pass(label + 'the signer key cannot move pool funds or call owner-only settlement');

  // 充值：owner 需要先 approve。
  await send(token, 'mint', [owner, units(1000000)]);
  await assert.rejects(() => send(pool, 'deposit', [units(1000)]));
  await send(token, 'approve', [pool.address, units(1000000)]);
  await send(pool, 'deposit', [units(1000000)]);
  assert.equal(await read(pool, 'poolBalance'), units(1000000));
  assert.equal(await read(pool, 'unusedBalance'), units(1000000));
  pass(label + 'deposit pulls CaBi after approval and counts as unused before any signed claim');

  // 摘要与 viem 的 EIP-712 实现一致。
  const digest = await read(pool, 'claimDigest', [alice, units(35000), 7n, 1000000n, 0]);
  assert.equal(digest, hashTypedData({
    domain: { name: 'CaBiSignedClaimPool', version: '1', chainId: 31337, verifyingContract: pool.address },
    types: CLAIM_TYPES, primaryType: 'Claim', message: { user: alice, amount: units(35000), nonce: 7n, deadline: 1000000n, mode: 0 },
  }));
  pass(label + 'on-chain EIP-712 digest matches standard typed-data hashing');

  // 正确签名可领：mode 0 → 50% 到账，剩余销毁。
  const aliceAuthorization = await sign(signer, alice, units(35000), 0);
  await claim(alice, aliceAuthorization);
  assert.equal(await read(token, 'balanceOf', [alice]), units(17500));
  assert.equal(await read(token, 'balanceOf', [DEAD]), units(17500));
  assert.equal(await read(pool, 'claimedOf', [alice]), units(35000));
  assert.equal(await read(pool, 'totalClaimed'), units(35000));
  assert.equal(await read(pool, 'totalBurned'), units(17500));
  assert.equal(await read(pool, 'nonceUsed', [alice, aliceAuthorization.nonce]), true);
  pass(label + 'a correctly signed mode-0 claim pays 50%, burns the remainder and records the nonce');

  // nonce 复用拒绝（换金额/换 mode 都不能复用同一 nonce）。
  const replayAmount = await sign(signer, alice, units(1000), 0, { nonce: aliceAuthorization.nonce });
  await assert.rejects(() => claim(alice, replayAmount), undefined, 'nonce replay');
  pass(label + 'replaying a used nonce is rejected even with a fresh signature');

  // 过期签名拒绝。
  const expired = await sign(signer, bob, units(35000), 0, { deadline: BigInt((await now()) - 1) });
  await assert.rejects(() => claim(bob, expired));
  assert.equal(await read(pool, 'claimedOf', [bob]), 0n);
  pass(label + 'an authorization past its deadline is rejected before any payout');

  // 篡改金额拒绝（服务端签 35000，链上提交 350000）。
  const tampered = await sign(signer, bob, units(35000), 0);
  await assert.rejects(() => claim(bob, tampered, units(350000)), undefined, 'tampered amount');
  assert.equal(await read(pool, 'claimedOf', [bob]), 0n);
  pass(label + 'changing the amount after signing invalidates the signature');

  // 其他地址不能使用别人的签名。
  await assert.rejects(() => claim(carol, tampered), undefined, 'wrong signer address');
  pass(label + 'an authorization signed for one wallet cannot be used by another');

  // 超出 owner 设定的累计上限拒绝。
  await send(pool, 'setClaimLimit', [bob, units(35000)]);
  const overLimit = await sign(signer, bob, units(70000), 0);
  await assert.rejects(() => claim(bob, overLimit), undefined, 'claim limit');
  assert.equal(await read(pool, 'claimedOf', [bob]), 0n);
  const withinLimit = await sign(signer, bob, units(35000), 0);
  await claim(bob, withinLimit);
  assert.equal(await read(pool, 'claimedOf', [bob]), units(35000));
  const overLimitAgain = await sign(signer, bob, units(1), 0);
  await assert.rejects(() => claim(bob, overLimitAgain), undefined, 'cumulative claim limit');
  pass(label + 'owner claim limits cap the cumulative amount and never consume a failed claim');

  // mode 1：70% 到账，30% 代币进 LP，同时收 30% USDT 等值。
  const preview1 = await read(pool, 'previewClaim', [units(70000), 1]);
  assert.deepEqual(Array.from(preview1), [units(49000), 0n, units(21000), units(30, usdtDecimals)]);
  const preview0 = await read(pool, 'previewClaim', [units(70000), 0]);
  assert.deepEqual(Array.from(preview0), [units(35000), units(35000), 0n, 0n]);
  await assert.rejects(() => read(pool, 'previewClaim', [units(70000), 2]));
  pass(label + 'previewClaim reports 50%/70%, burn vs LP split and exact 30% USDT equivalent');

  for (const ratios of [[0, 70, 30, 30], [101, 70, 30, 30], [50, 0, 30, 30], [50, 70, 101, 30], [50, 70, 0, 30], [50, 70, 30, 0], [50, 70, 20, 30], [50, 80, 30, 30]]) {
    await assert.rejects(() => send(pool, 'setRatios', ratios), undefined, JSON.stringify(ratios));
  }
  await send(pool, 'setRatios', [50, 70, 30, 30]);
  assert.equal(await read(pool, 'directRatio'), 50n);
  pass(label + 'setRatios enforces 0<ratio<=100 and lpToken must equal 100-lp');

  const lpAuthorization = await sign(signer, carol, units(70000), 1);
  await assert.rejects(() => claim(carol, lpAuthorization), undefined, 'missing USDT balance');
  assert.equal(await read(pool, 'claimedOf', [carol]), 0n);
  assert.equal(await read(pool, 'totalClaimed'), units(70000));
  await send(usdt, 'mint', [carol, units(30, usdtDecimals)]);
  await send(usdt, 'approve', [pool.address, units(30, usdtDecimals)], carol);
  await claim(carol, lpAuthorization);
  assert.equal(await read(token, 'balanceOf', [carol]), units(49000));
  assert.equal(await read(token, 'balanceOf', [lp]), units(21000));
  assert.equal(await read(usdt, 'balanceOf', [lp]), units(30, usdtDecimals));
  assert.equal(await read(usdt, 'balanceOf', [carol]), 0n);
  assert.equal(await read(pool, 'totalLpTokens'), units(21000));
  assert.equal(await read(pool, 'totalUsdtCharged'), units(30, usdtDecimals));
  pass(label + 'mode 1 reverts when USDT is short, then pays 70%, routes 30% to LP and charges the 30% equivalent');

  // 池内余额不足整体 revert，不写入 nonce / 已领取。
  await send(pool, 'withdrawUnused', [await read(pool, 'unusedBalance')]);
  assert.equal(await read(pool, 'poolBalance'), 0n);
  const unfunded = await sign(signer, outsider, units(1000), 0);
  await assert.rejects(() => claim(outsider, unfunded), undefined, 'unfunded pool');
  assert.equal(await read(pool, 'claimedOf', [outsider]), 0n);
  assert.equal(await read(pool, 'nonceUsed', [outsider, unfunded.nonce]), false);
  await send(token, 'mint', [owner, units(10000)]);
  await send(token, 'approve', [pool.address, units(10000)]);
  await send(pool, 'deposit', [units(10000)]);
  await claim(outsider, unfunded);
  assert.equal(await read(token, 'balanceOf', [outsider]), units(500));
  pass(label + 'withdrawUnused can drain unused funds and an underfunded claim reverts atomically without consuming the nonce');

  // 换 signer 后旧签名立即失效；新 signer 生效。
  await send(pool, 'setSigner', [nextSigner.address]);
  assert.equal((await read(pool, 'signer')).toLowerCase(), nextSigner.address.toLowerCase());
  const stale = await sign(signer, alice, units(1000), 0);
  await assert.rejects(() => claim(alice, stale), undefined, 'old signer');
  const fresh = await sign(nextSigner, alice, units(1000), 0);
  await claim(alice, fresh);
  pass(label + 'rotating the signer invalidates every authorization signed by the previous key');

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
  for (const name of ['Deposit', 'WithdrawUnused', 'Claimed', 'SignerChanged', 'ClaimLimitUpdated', 'LpReceiverUpdated', 'UsdtUpdated', 'RatiosUpdated', 'OwnershipTransferred']) assert(names.has(name), 'missing event ' + name);
  pass(label + 'funding, claim, signer, policy and ownership events are emitted');
}

(async () => {
  try {
    await scenario(6);
    await scenario(18);
    console.log(results.length + ' signed claim pool checks passed.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();
