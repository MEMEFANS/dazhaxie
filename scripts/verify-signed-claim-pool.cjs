/* eslint-disable @typescript-eslint/no-require-imports -- Isolated local contract verification. */
// 合成 Ganache 账户 + 本地 solc 编译 + viem 本地签名；不读取 .env、私钥文件或公共 RPC。
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), solc = require('solc');
process.env.UWS_USE_FALLBACK ??= '1';
const ganache = require('ganache');
const { createPublicClient, createWalletClient, custom, parseUnits, parseEventLogs, hashTypedData } = require('viem');
const { privateKeyToAccount, generatePrivateKey } = require('viem/accounts');
const ROOT = path.resolve(__dirname, '..'), ZERO = '0x0000000000000000000000000000000000000000';
const units = (value, decimals = 18) => parseUnits(String(value), decimals), results = [];
function pass(name) { results.push(name); console.log('PASS ' + name); }

function compile() {
  const sources = {};
  for (const file of ['CaBiSignedClaimPool.sol', 'CaBiPancakeToken.sol', 'test/TestUSDT.sol']) sources[file] = { content: fs.readFileSync(path.join(ROOT, 'contracts', file), 'utf8') };
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } })));
  const errors = (output.errors || []).filter(item => item.severity === 'error');
  assert.equal(errors.length, 0, errors.map(item => item.formattedMessage).join(' | '));
  const pool = output.contracts['CaBiSignedClaimPool.sol'].CaBiSignedClaimPool;
  assert(pool.evm.deployedBytecode.object.length / 2 < 24576, 'signed claim pool bytecode exceeds EIP-170 limit');
  const poolAbi = pool.abi;
  for (const forbidden of ['mode', 'burnRemainder', 'directRatio', 'setRatios', 'totalBurned']) {
    assert(!poolAbi.some(item => item.name === forbidden), 'ABI must not expose legacy entry: ' + forbidden);
  }
  for (const name of ['claim', 'previewClaim', 'claimDigest']) {
    const method = poolAbi.find(item => item.name === name);
    assert(method, name);
    assert(!method.inputs.some(input => input.name === 'mode'), name + ' must not take a mode parameter');
  }
  return (file, name) => ({ abi: output.contracts[file][name].abi, bytecode: '0x' + output.contracts[file][name].evm.bytecode.object });
}

const CLAIM_TYPES = {
  Claim: [
    { name: 'user', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'cumulativeLimit', type: 'uint256' }, { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
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
  async function sign(signerAccount, user, amount, options = {}) {
    const currentSigner = options.signer || signerAccount;
    const cumulativeLimit = options.cumulativeLimit ?? (await read(pool, 'claimedOf', [user])) + amount;
    const nonce = options.nonce !== undefined ? options.nonce : BigInt(nonceSeed++);
    const deadline = options.deadline !== undefined ? options.deadline : BigInt(await now() + 600);
    const signature = await currentSigner.signTypedData({
      domain: { name: 'CaBiSignedClaimPool', version: '1', chainId: 31337, verifyingContract: pool.address },
      types: CLAIM_TYPES, primaryType: 'Claim', message: { user, amount, cumulativeLimit, nonce, deadline },
    });
    return { amount, cumulativeLimit, nonce, deadline, signature };
  }
  const claim = (account, authorization, expectedAmount) => send(pool, 'claim',
    [expectedAmount ?? authorization.amount, authorization.cumulativeLimit, authorization.nonce, authorization.deadline, authorization.signature], account);

  assert.equal((await read(pool, 'owner')).toLowerCase(), owner.toLowerCase());
  assert.equal((await read(pool, 'signer')).toLowerCase(), signer.address.toLowerCase());
  assert.equal((await read(pool, 'token')).toLowerCase(), token.address.toLowerCase());
  assert.equal(await read(pool, 'PAYOUT_RATIO'), 70n);
  assert.equal(await read(pool, 'LP_TOKEN_RATIO'), 30n);
  assert.equal(await read(pool, 'LP_USDT_RATIO'), 30n);
  await assert.rejects(() => deploy(build('CaBiSignedClaimPool.sol', 'CaBiSignedClaimPool'), [ZERO, signer.address, owner]));
  await assert.rejects(() => deploy(build('CaBiSignedClaimPool.sol', 'CaBiSignedClaimPool'), [token.address, ZERO, owner]));
  await assert.rejects(() => deploy(build('CaBiSignedClaimPool.sol', 'CaBiSignedClaimPool'), [token.address, signer.address, ZERO]));
  pass(label + 'constructor takes (token, signer, owner), rejects zero addresses and fixes 70/30/30 rules');

  // owner 配置 USDT / LP；非 owner 不能改任何管理项。
  await send(pool, 'setUsdt', [usdt.address]);
  assert.equal(Number(await read(pool, 'usdtDecimals')), usdtDecimals);
  await send(pool, 'setLpReceiver', [lp]);
  await assert.rejects(() => send(pool, 'setUsdt', [ZERO]));
  await assert.rejects(() => send(pool, 'setLpReceiver', [ZERO]));
  await assert.rejects(() => send(pool, 'setSigner', [ZERO]));
  for (const [fn, args] of [['setUsdt', [usdt.address]], ['setLpReceiver', [lp]], ['setSigner', [outsider]], ['setClaimLimit', [alice, units(1)]]]) {
    await assert.rejects(() => send(pool, fn, args, outsider), undefined, fn);
  }
  pass(label + 'owner wires USDT/LP and only owner can change signer or claim limits');

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
  await send(token, 'mint', [owner, units(1000)]);
  await send(token, 'transfer', [pool.address, units(1000)]);
  assert.equal(await read(pool, 'poolBalance'), units(1001000));
  pass(label + 'the owner can fund the pool with a direct token transfer, without calling deposit');

  // 摘要与 viem 的 EIP-712 实现一致（不含 mode）。
  const digest = await read(pool, 'claimDigest', [alice, units(35000), units(35000), 7n, 1000000n]);
  assert.equal(digest, hashTypedData({
    domain: { name: 'CaBiSignedClaimPool', version: '1', chainId: 31337, verifyingContract: pool.address },
    types: CLAIM_TYPES, primaryType: 'Claim', message: { user: alice, amount: units(35000), cumulativeLimit: units(35000), nonce: 7n, deadline: 1000000n },
  }));
  pass(label + 'on-chain EIP-712 digest matches standard typed-data hashing without a mode field');

  // LP 接收地址未配置时，合法签名也必须整体 revert（不存在 50% 兜底路径）。
  const lpUnsetPool = await deploy(build('CaBiSignedClaimPool.sol', 'CaBiSignedClaimPool'), [token.address, signer.address, owner]);
  await send(lpUnsetPool, 'setUsdt', [usdt.address]);
  await send(token, 'mint', [owner, units(1000)]);
  await send(token, 'approve', [lpUnsetPool.address, units(1000)]);
  await send(lpUnsetPool, 'deposit', [units(1000)]);
  const lpUnsetDeadline = BigInt(await now() + 600);
  const lpAuthorization = await signer.signTypedData({
    domain: { name: 'CaBiSignedClaimPool', version: '1', chainId: 31337, verifyingContract: lpUnsetPool.address },
    types: CLAIM_TYPES, primaryType: 'Claim', message: { user: alice, amount: units(1000), cumulativeLimit: units(1000), nonce: 1n, deadline: lpUnsetDeadline },
  });
  await assert.rejects(() => send(lpUnsetPool, 'claim', [units(1000), units(1000), 1n, lpUnsetDeadline, lpAuthorization], alice), undefined, 'lp receiver unset');
  assert.equal(await read(lpUnsetPool, 'claimedOf', [alice]), 0n);
  pass(label + 'a claim reverts when lpReceiver is unconfigured instead of falling back to a 50% path');

  // 正确签名可领：70% 到账，30% 代币进 LP，同时收 30% USDT 等值。
  const aliceAuthorization = await sign(signer, alice, units(35000));
  await assert.rejects(() => claim(alice, aliceAuthorization), undefined, 'missing USDT balance');
  assert.equal(await read(pool, 'claimedOf', [alice]), 0n);
  assert.equal(await read(pool, 'nonceUsed', [alice, aliceAuthorization.nonce]), false);
  await send(usdt, 'mint', [alice, units(15, usdtDecimals)]);
  await assert.rejects(() => claim(alice, aliceAuthorization), undefined, 'missing USDT allowance');
  await send(usdt, 'approve', [pool.address, units(15, usdtDecimals)], alice);
  await claim(alice, aliceAuthorization);
  assert.equal(await read(token, 'balanceOf', [alice]), units(24500));
  assert.equal(await read(token, 'balanceOf', [lp]), units(10500));
  assert.equal(await read(usdt, 'balanceOf', [lp]), units(15, usdtDecimals));
  assert.equal(await read(usdt, 'balanceOf', [alice]), 0n);
  assert.equal(await read(pool, 'claimedOf', [alice]), units(35000));
  assert.equal(await read(pool, 'totalClaimed'), units(35000));
  assert.equal(await read(pool, 'totalLpTokens'), units(10500));
  assert.equal(await read(pool, 'totalUsdtCharged'), units(15, usdtDecimals));
  assert.equal(await read(pool, 'nonceUsed', [alice, aliceAuthorization.nonce]), true);
  pass(label + 'a signed claim pays 70%, routes 30% to the LP receiver and charges the 30% USDT equivalent');

  // nonce 复用拒绝（换金额也不能复用同一 nonce）。
  const replayAmount = await sign(signer, alice, units(1000), { nonce: aliceAuthorization.nonce });
  await assert.rejects(() => claim(alice, replayAmount), undefined, 'nonce replay');
  pass(label + 'replaying a used nonce is rejected even with a fresh signature');

  // 过期签名拒绝。
  const expired = await sign(signer, bob, units(3500), { deadline: BigInt((await now()) - 1) });
  await assert.rejects(() => claim(bob, expired));
  assert.equal(await read(pool, 'claimedOf', [bob]), 0n);
  pass(label + 'an authorization past its deadline is rejected before any payout');

  // 篡改金额拒绝（服务端签 3500，链上提交 35000）。
  const tampered = await sign(signer, bob, units(3500));
  await assert.rejects(() => claim(bob, tampered, units(35000)), undefined, 'tampered amount');
  assert.equal(await read(pool, 'claimedOf', [bob]), 0n);
  pass(label + 'changing the amount after signing invalidates the signature');

  // 其他地址不能使用别人的签名。
  await assert.rejects(() => claim(carol, tampered), undefined, 'wrong signer address');
  pass(label + 'an authorization signed for one wallet cannot be used by another');

  // 超出 owner 设定的累计上限拒绝。
  await send(pool, 'setClaimLimit', [bob, units(3500)]);
  const overLimit = await sign(signer, bob, units(7000));
  await assert.rejects(() => claim(bob, overLimit), undefined, 'claim limit');
  assert.equal(await read(pool, 'claimedOf', [bob]), 0n);
  await send(usdt, 'mint', [bob, units(3, usdtDecimals)]);
  await send(usdt, 'approve', [pool.address, units(3, usdtDecimals)], bob);
  const withinLimit = await sign(signer, bob, units(3500));
  await claim(bob, withinLimit);
  assert.equal(await read(pool, 'claimedOf', [bob]), units(3500));
  const overLimitAgain = await sign(signer, bob, units(1));
  await assert.rejects(() => claim(bob, overLimitAgain), undefined, 'cumulative claim limit');
  pass(label + 'owner claim limits cap the cumulative amount and never consume a failed claim');

  // 报价：70% / 30% / 30% USDT 等值。
  const preview = await read(pool, 'previewClaim', [units(70000)]);
  assert.deepEqual(Array.from(preview), [units(49000), units(21000), units(30, usdtDecimals)]);
  pass(label + 'previewClaim reports the 70/30 split and the exact 30% USDT equivalent');

  // 两张未上链授权即使 nonce 不同，也不能突破同一累计额度。
  const simultaneousCap = units(3500);
  const first = await sign(signer, carol, units(3500), { cumulativeLimit: simultaneousCap });
  const second = await sign(signer, carol, units(3500), { cumulativeLimit: simultaneousCap });
  await send(usdt, 'mint', [carol, units(3, usdtDecimals)]);
  await send(usdt, 'approve', [pool.address, units(3, usdtDecimals)], carol);
  await claim(carol, first);
  await assert.rejects(() => claim(carol, second), undefined, 'concurrent authorizations cannot exceed the cumulative cap');
  assert.equal(await read(pool, 'claimedOf', [carol]), simultaneousCap);
  assert.equal(await read(pool, 'nonceUsed', [carol, second.nonce]), false);
  pass(label + 'overlapping signatures cannot overclaim the same cumulative entitlement');

  // 池内余额不足整体 revert，不写入 nonce / 已领取。
  await send(pool, 'withdrawUnused', [await read(pool, 'unusedBalance')]);
  assert.equal(await read(pool, 'poolBalance'), 0n);
  const unfunded = await sign(signer, outsider, units(1000));
  await assert.rejects(() => claim(outsider, unfunded), undefined, 'unfunded pool');
  assert.equal(await read(pool, 'claimedOf', [outsider]), 0n);
  assert.equal(await read(pool, 'nonceUsed', [outsider, unfunded.nonce]), false);
  await send(token, 'mint', [owner, units(10000)]);
  await send(token, 'approve', [pool.address, units(10000)]);
  await send(pool, 'deposit', [units(10000)]);
  await send(usdt, 'mint', [outsider, units('2.5', usdtDecimals)]);
  await send(usdt, 'approve', [pool.address, units('2.5', usdtDecimals)], outsider);
  await claim(outsider, unfunded);
  assert.equal(await read(token, 'balanceOf', [outsider]), units(700));
  pass(label + 'withdrawUnused can drain unused funds and an underfunded claim reverts atomically without consuming the nonce');

  // 换 signer 后旧签名立即失效；新 signer 生效。
  await send(pool, 'setSigner', [nextSigner.address]);
  assert.equal((await read(pool, 'signer')).toLowerCase(), nextSigner.address.toLowerCase());
  const stale = await sign(signer, alice, units(1000));
  await assert.rejects(() => claim(alice, stale), undefined, 'old signer');
  await send(usdt, 'mint', [alice, units('1.5', usdtDecimals)]);
  await send(usdt, 'approve', [pool.address, units('1.5', usdtDecimals)], alice);
  const fresh = await sign(nextSigner, alice, units(1000));
  await claim(alice, fresh);
  assert.equal(await read(token, 'balanceOf', [alice]), units(25200));
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
  for (const name of ['Deposit', 'WithdrawUnused', 'Claimed', 'SignerChanged', 'ClaimLimitUpdated', 'LpReceiverUpdated', 'UsdtUpdated', 'OwnershipTransferred']) assert(names.has(name), 'missing event ' + name);
  assert(!names.has('RatiosUpdated'), 'RatiosUpdated event must be removed');
  pass(label + 'funding, claim, signer and ownership events are emitted without legacy ratio events');
}

async function realTokenScenario() {
  const provider = ganache.provider({ logging: { quiet: true }, wallet: { deterministic: true, totalAccounts: 8 }, chain: { chainId: 31337, hardfork: 'shanghai' } });
  const chain = { id: 31337, name: 'Isolated CaBi test', nativeCurrency: { name: 'Test', symbol: 'TEST', decimals: 18 }, rpcUrls: { default: { http: [] } } };
  const client = createPublicClient({ chain, transport: custom(provider), pollingInterval: 10 });
  const wallet = createWalletClient({ chain, transport: custom(provider) });
  const [owner, alice, lp, outsider, distribution, buyback] = await wallet.getAddresses();
  const signer = privateKeyToAccount(generatePrivateKey());
  const build = compile();
  const deploy = async (file, name, args) => {
    const artifact = build(file, name);
    const hash = await wallet.deployContract({ ...artifact, args, account: owner, gas: 12000000n });
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success');
    return { address: receipt.contractAddress, abi: artifact.abi };
  };
  const send = async (contract, functionName, args = [], account = owner, status = 'success') => {
    const hash = await wallet.writeContract({ ...contract, functionName, args, account, gas: 12000000n });
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, status, functionName);
  };
  const read = (contract, functionName, args = []) => client.readContract({ ...contract, functionName, args });
  const token = await deploy('CaBiPancakeToken.sol', 'CaBiPancakeToken', [distribution, buyback, owner]);
  const usdt = await deploy('test/TestUSDT.sol', 'TestUSDT', [18]);
  const pool = await deploy('CaBiSignedClaimPool.sol', 'CaBiSignedClaimPool', [token.address, signer.address, owner]);
  await send(pool, 'setUsdt', [usdt.address]);
  await send(pool, 'setLpReceiver', [lp]);
  await send(token, 'transfer', [pool.address, units(300000)], owner, 'reverted');
  await send(token, 'setMaxWalletExempt', [pool.address, true]);
  await send(token, 'transfer', [pool.address, units(300000)]);
  assert.equal(await read(pool, 'poolBalance'), units(300000));
  pass('real CaBi: pool can receive 300,000 tokens directly after owner grants holding exemption');

  await send(usdt, 'mint', [alice, units(130)]);
  await send(usdt, 'approve', [pool.address, units(130)], alice);
  const cap = units(300000);
  async function claimPart(nonce, expectedStatus = 'success') {
    const amount = units(100000);
    const deadline = BigInt(Number((await client.getBlock()).timestamp) + 600);
    const signature = await signer.signTypedData({
      domain: { name: 'CaBiSignedClaimPool', version: '1', chainId: 31337, verifyingContract: pool.address },
      types: CLAIM_TYPES, primaryType: 'Claim',
      message: { user: alice, amount, cumulativeLimit: cap, nonce, deadline },
    });
    await send(pool, 'claim', [amount, cap, nonce, deadline, signature], alice, expectedStatus);
  }
  await claimPart(1n);
  await claimPart(2n);
  assert.equal(await read(token, 'balanceOf', [alice]), units(140000));
  await claimPart(3n, 'reverted');
  assert.equal(await read(pool, 'claimedOf', [alice]), units(200000));
  await send(token, 'transfer', [outsider, units(70000)], alice);
  await claimPart(3n);
  assert.equal(await read(pool, 'claimedOf', [alice]), cap);
  assert.equal(await read(token, 'balanceOf', [lp]), units(90000));
  assert.equal(await read(token, 'balanceOf', [alice]), units(140000));
  pass('real CaBi: partial self-claims respect the 200,000 holding cap and settle 70/30 after a transfer out');
}

(async () => {
  try {
    await scenario(6);
    await scenario(18);
    await realTokenScenario();
    console.log(results.length + ' signed claim pool checks passed.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();
