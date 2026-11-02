/* eslint-disable @typescript-eslint/no-require-imports -- Standalone offline signer. */
/*
 * 离线/独立进程写入领取池额度（备用方案）。
 *
 * 主路径是 CaBiSignedClaimPool 签名自领：额度由服务器按认购单 + 奖励实时聚合并签发，用户自己 claim。
 * 本脚本只适用于旧版 CaBiSimpleClaimPool（owner 批量写入），保留用于 HA 回退或紧急人工发放；
 * 不要用它写签名自领池——该池没有 batchSetClaimable。
 *
 * 安全边界：
 * - 私钥只从进程环境变量 CLAIM_POOL_OWNER_PRIVATE_KEY 读取，绝不读取 .env.local。
 * - 不打印私钥、签名原文或账户对象。
 * - 带锁文件避免同一台机器并发执行；带 gas 上限与 owner 校验。
 * - 默认增量写入（incremental=true），--overwrite 改为覆盖写入。
 * - 增量模式会跳过链上已领取地址；覆盖模式遇到已领取地址无法自动跳过，直接报错。
 *
 * 用法：
 *   set CLAIM_POOL_OWNER_PRIVATE_KEY=0x... && node scripts/push-claimable.cjs batch-xxx.csv --send
 *   node scripts/push-claimable.cjs batch-xxx.csv            # 只做本地校验与 gas 估算，不广播
 *
 * 环境变量：
 *   RPC_URL / CABI_RPC_URL                 必需，BSC RPC
 *   CLAIM_POOL_ADDRESS                     必需，领取池合约地址
 *   CLAIM_POOL_OWNER_PRIVATE_KEY           必需，owner 私钥（仅本进程）
 *   CHAIN_ID                               可选，默认 56
 *   MAX_GAS_LIMIT                          可选，默认 5,000,000
 *   LOCK_FILE                              可选，默认 ./output/.push-claimable.lock
 *   AMOUNT_UNIT                            可选，token（默认，按 CaBi 枚）| wei（已含 18 位精度）
 *
 * CSV 格式：address,amount（每行一条，最多 200 条；表头会被忽略）
 */
const fs = require('node:fs');
const path = require('node:path');
const {
  createPublicClient, createWalletClient, getAddress, http, isAddress, parseUnits, zeroAddress,
} = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { bsc, bscTestnet } = require('viem/chains');

const ABI = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'token', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'hasClaimed', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'claimableOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'batchSetClaimable', stateMutability: 'nonpayable', inputs: [{ type: 'address[]' }, { type: 'uint256[]' }, { type: 'bool' }], outputs: [] },
];
const MAX_BATCH = 200;
const DEFAULT_MAX_GAS = 5_000_000n;

class ScriptError extends Error {
  constructor(code, message) { super(message); this.name = code; }
}
function fail(code, message) { throw new ScriptError(code, message); }

function parseArgs(argv) {
  const file = argv.find(value => !value.startsWith('--'));
  const send = argv.includes('--send');
  const overwrite = argv.includes('--overwrite');
  const incremental = !overwrite;
  if (!file) fail('USAGE', '请提供 CSV 文件路径：node scripts/push-claimable.cjs <file.csv> [--send] [--overwrite]');
  return { file, send, incremental, overwrite };
}

function parseCsv(file, rawUnits) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch { fail('FILE_UNREADABLE', '无法读取 CSV 文件。'); }
  const rows = [];
  const seen = new Set();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const value = line.trim();
    if (!value) continue;
    if (/^address\s*,\s*amount$/i.test(value)) continue; // 表头
    const parts = value.split(/[,\s，]+/).filter(Boolean);
    if (parts.length !== 2) fail('ROW_FORMAT', `第 ${index + 1} 行应为 address,amount。`);
    if (!isAddress(parts[0], { strict: false }) || parts[0].toLowerCase() === zeroAddress) fail('ROW_ADDRESS', `第 ${index + 1} 行地址无效。`);
    const address = getAddress(parts[0].toLowerCase());
    if (seen.has(address.toLowerCase())) fail('ROW_DUPLICATE', `第 ${index + 1} 行地址重复。`);
    seen.add(address.toLowerCase());
    let amount;
    try {
      if (rawUnits) {
        if (!/^\d+$/.test(parts[1]) || BigInt(parts[1]) === 0n) throw new Error();
        amount = BigInt(parts[1]);
      } else {
        if (!/^\d+(\.\d+)?$/.test(parts[1]) || (parts[1].split('.')[1]?.length || 0) > 18) throw new Error();
        amount = parseUnits(parts[1], 18);
        if (amount === 0n) throw new Error();
      }
    } catch { fail('ROW_AMOUNT', `第 ${index + 1} 行数量无效（需大于 0，最多 18 位小数）。`); }
    rows.push({ address, amount, raw: parts[1] });
  }
  if (!rows.length) fail('EMPTY', 'CSV 中没有有效记录。');
  if (rows.length > MAX_BATCH) fail('TOO_MANY', `单批最多 ${MAX_BATCH} 个地址，请拆分。`);
  return rows;
}

function acquireLock(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let handle;
  try { handle = fs.openSync(file, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') fail('LOCKED', `检测到锁文件 ${file}。确认没有其它写入进程后手动删除再重试。`);
    throw error;
  }
  fs.writeSync(handle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  fs.closeSync(handle);
  return () => { try { fs.unlinkSync(file); } catch { /* Lock cleanup is best effort. */ } };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rpcUrl = process.env.RPC_URL || process.env.CABI_RPC_URL;
  const pool = process.env.CLAIM_POOL_ADDRESS;
  const privateKey = process.env.CLAIM_POOL_OWNER_PRIVATE_KEY;
  if (!rpcUrl) fail('RPC_REQUIRED', '请设置 RPC_URL。');
  if (!pool || !isAddress(pool, { strict: false }) || pool.toLowerCase() === zeroAddress) fail('POOL_REQUIRED', '请设置有效的 CLAIM_POOL_ADDRESS。');
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) fail('KEY_REQUIRED', '请仅在进程环境变量中提供 CLAIM_POOL_OWNER_PRIVATE_KEY。');
  const chainId = Number(process.env.CHAIN_ID || '56');
  if (chainId !== 56 && chainId !== 97) fail('CHAIN_INVALID', 'CHAIN_ID 仅支持 56 或 97。');
  const maxGas = BigInt(process.env.MAX_GAS_LIMIT || DEFAULT_MAX_GAS.toString());
  const lockFile = path.resolve(process.env.LOCK_FILE || path.join('output', '.push-claimable.lock'));
  const rawUnits = (process.env.AMOUNT_UNIT || 'token').toLowerCase() === 'wei';
  const rows = parseCsv(args.file, rawUnits);
  let release;
  try { release = acquireLock(lockFile); }
  catch (error) { if (error instanceof ScriptError) throw error; fail('LOCK_FAILED', '无法创建锁文件。'); }

  try {
    const account = privateKeyToAccount(privateKey);
    const chain = chainId === 97 ? bscTestnet : bsc;
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 20_000, retryCount: 1 }) });
    const actualChain = await publicClient.getChainId();
    if (actualChain !== chainId) fail('RPC_WRONG_CHAIN', `RPC 返回链 ID ${actualChain}，与 CHAIN_ID ${chainId} 不一致。`);
    const poolAddress = getAddress(pool.toLowerCase());
    const [owner, token, codes] = await Promise.all([
      publicClient.readContract({ address: poolAddress, abi: ABI, functionName: 'owner' }),
      publicClient.readContract({ address: poolAddress, abi: ABI, functionName: 'token' }),
      publicClient.getCode({ address: poolAddress }),
    ]);
    if (!codes || codes === '0x') fail('POOL_NOT_DEPLOYED', '领取池地址没有合约代码。');
    if (owner.toLowerCase() !== account.address.toLowerCase()) fail('NOT_OWNER', '当前私钥不是领取池 owner，拒绝写入。');
    if (token.toLowerCase() === zeroAddress) fail('TOKEN_INVALID', '领取池 token 地址无效。');

    const claimedFlags = await Promise.all(rows.map(row => publicClient.readContract({ address: poolAddress, abi: ABI, functionName: 'hasClaimed', args: [row.address] })));
    const addresses = [];
    const amounts = [];
    const skipped = [];
    for (const [index, row] of rows.entries()) {
      if (claimedFlags[index]) {
        if (!args.incremental) fail('ALREADY_CLAIMED', `地址 ${row.address} 已领取，覆盖写入会 revert；请改用增量并移除该地址。`);
        skipped.push(row.address);
        continue;
      }
      addresses.push(row.address);
      amounts.push(row.amount);
    }
    if (!addresses.length) fail('NOTHING_TO_WRITE', '所有地址均已领取，本次没有需要写入的额度。');
    const total = amounts.reduce((sum, value) => sum + value, 0n);
    const estimate = await publicClient.estimateContractGas({
      address: poolAddress, abi: ABI, functionName: 'batchSetClaimable', args: [addresses, amounts, args.incremental], account,
    });
    const gas = estimate * 120n / 100n;
    if (gas > maxGas) fail('GAS_TOO_HIGH', `估算 gas ${estimate} 超过上限 ${maxGas}，请拆分批次。`);
    console.log(JSON.stringify({
      mode: args.send ? 'broadcast' : 'dry-run', chainId, pool: poolAddress, owner: account.address,
      token, addresses: addresses.length, total: total.toString(), totalTokens: (Number(total) / 1e18).toFixed(6),
      skippedClaimed: skipped.length, incremental: args.incremental, estimatedGas: estimate.toString(), gasLimit: gas.toString(),
    }, null, 2));
    if (!args.send) { console.log('未广播。确认以上信息后追加 --send。'); return; }

    const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl, { timeout: 20_000, retryCount: 1 }) });
    const hash = await walletClient.writeContract({
      address: poolAddress, abi: ABI, functionName: 'batchSetClaimable', args: [addresses, amounts, args.incremental], gas,
    });
    console.log(JSON.stringify({ status: 'broadcast', transactionHash: hash, addresses: addresses.length, total: total.toString() }, null, 2));
    let receipt;
    try { receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000, pollingInterval: 3_000 }); }
    catch { console.log(JSON.stringify({ status: 'pending', transactionHash: hash, message: '已广播但暂未确认；后台登记哈希后等待确认，不要重复广播。' }, null, 2)); return; }
    if (receipt.status !== 'success') fail('REVERTED', `交易 ${hash} 执行失败，批次未生效，请核对后重试。`);
    console.log(JSON.stringify({ status: 'confirmed', transactionHash: hash, blockNumber: receipt.blockNumber.toString(), addresses: addresses.length, total: total.toString() }, null, 2));
  } finally {
    try { release(); } catch { /* best effort */ }
  }
}
main().catch(error => {
  if (error instanceof ScriptError) console.error(JSON.stringify({ error: error.name, message: error.message }));
  else console.error(JSON.stringify({ error: 'PUSH_CLAIMABLE_FAILED', message: '写入未完成；请检查 RPC、网络、gas 与合约状态。' }));
  process.exitCode = 1;
});
