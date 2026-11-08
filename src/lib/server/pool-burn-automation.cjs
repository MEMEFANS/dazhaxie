/* eslint-disable @typescript-eslint/no-require-imports -- Shared by the server-only API and Node 24 worker. */
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { homedir } = require('node:os');
const { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } = require('node:crypto');
const { createPublicClient, http, fallback, getAddress, isAddress, zeroAddress, parseAbi, parseGwei, parseEther, encodeFunctionData, keccak256, decodeEventLog } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { bsc, bscTestnet } = require('viem/chains');

const abi = parseAbi([
  'function POOL_BURN_INTERVAL() view returns (uint256)',
  'function POOL_BURN_BPS() view returns (uint256)',
  'function tradingPair() view returns (address)',
  'function usdt() view returns (address)',
  'function nextPoolBurnTime() view returns (uint256)',
  'function lastPoolBurnTime() view returns (uint256)',
  'function totalPoolBurned() view returns (uint256)',
  'function previewPoolBurn() view returns (uint256 amount,uint256 nextBurnAt,bool due)',
  'function burnPool() returns (uint256)',
  'event PoolBurned(address indexed pair,uint256 amount,uint256 poolBalanceBefore,uint256 executedAt)',
]);
const burnData = encodeFunctionData({ abi, functionName: 'burnPool' });
const MIN_BALANCE = parseEther('0.0001');
const LEASE_MS = 150_000;
class BurnError extends Error {}
function fail(message) { throw new BurnError(message); }
function address(value) {
  if (typeof value !== 'string' || !isAddress(value, { strict: false }) || value.toLowerCase() === zeroAddress) fail('代币或 USDT 地址未配置');
  return getAddress(value.toLowerCase());
}
function contextFromEnv(env) {
  const chainId = Number(env.NEXT_PUBLIC_CHAIN_ID);
  if (![56, 97].includes(chainId)) fail('只支持 BSC 主网和测试网');
  const defaults = chainId === 56 ? ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org'] : ['https://bsc-testnet-rpc.publicnode.com'];
  const rpc = env.POOL_BURN_RPC_URL || env.NEXT_PUBLIC_RPC_URL;
  if (rpc) {
    const url = new URL(rpc);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail('RPC 配置无效');
  }
  return { chainId, token: address(env.NEXT_PUBLIC_TOKEN_ADDRESS), quote: address(env.NEXT_PUBLIC_USDT_ADDRESS), rpcUrls: [...new Set([...(rpc ? [rpc] : []), ...defaults])] };
}
function sameContext(a, b) { return a.chainId === b.chainId && a.token?.toLowerCase() === b.token?.toLowerCase() && a.quote?.toLowerCase() === b.quote?.toLowerCase(); }
function clientFor(context) {
  return createPublicClient({ chain: context.chainId === 56 ? bsc : bscTestnet, cacheTime: 0,
    transport: fallback(context.rpcUrls.map(url => http(url, { timeout: 8_000, retryCount: 0 })), { retryCount: 0 }) });
}
function encryptionKey(env) {
  const secret = env.REDEMPTION_DATA_SECRET || env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) fail('服务器尚未配置加密密钥');
  return createHash('sha256').update('cabi/pool-burn/v1\0').update(secret).digest();
}
function aad(c, purpose) { return `${purpose}:${c.chainId}:${c.token.toLowerCase()}:${c.quote.toLowerCase()}:${c.address.toLowerCase()}`; }
function seal(plain, context, purpose, env) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(env), iv);
  cipher.setAAD(Buffer.from(aad(context, purpose)));
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(v => v.toString('base64url')).join('.');
}
function unseal(value, context, purpose, env) {
  try {
    const [iv, tag, encrypted] = value.split('.').map(v => Buffer.from(v, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(env), iv);
    decipher.setAAD(Buffer.from(aad(context, purpose))); decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch { fail('执行钱包无法解密，请检查服务器密钥或重新保存配置'); }
}
function json(value) { return JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v); }
function openStore(directory) {
  directory ||= process.env.CABI_DATA_DIR || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'CaBi', 'admin') : path.join(homedir(), '.local/share/cabi-admin'));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(directory, 'operations.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS pool_burn_config (id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pool_burn_worker (id INTEGER PRIMARY KEY CHECK(id=1), heartbeat INTEGER NOT NULL DEFAULT 0, lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0, document TEXT NOT NULL DEFAULT '{}');
    INSERT OR IGNORE INTO pool_burn_worker(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS pool_burn_transactions (hash TEXT PRIMARY KEY, status TEXT NOT NULL, created_at INTEGER NOT NULL, document TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS one_pool_burn_pending ON pool_burn_transactions((1)) WHERE status='pending';
    CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, at INTEGER NOT NULL);`);
  const store = {
    db, close: () => db.close(),
    atomic(fn) { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    config() { const row = db.prepare('SELECT document FROM pool_burn_config WHERE id=1').get(); return row ? JSON.parse(row.document) : null; },
    putConfig(c) { db.prepare('INSERT INTO pool_burn_config(id,document) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document').run(json(c)); },
    pending() { const row = db.prepare("SELECT document FROM pool_burn_transactions WHERE status='pending'").get(); return row ? JSON.parse(row.document) : null; },
    audit(actor, action, detail) { db.prepare('INSERT INTO audit(id,actor,action,detail,at) VALUES(?,?,?,?,?)').run(randomUUID(), actor, action, detail, Date.now()); },
    worker() { const row = db.prepare('SELECT * FROM pool_burn_worker WHERE id=1').get(); return { ...JSON.parse(row.document), heartbeat: row.heartbeat }; },
    lease() { const id = randomUUID(), now = Date.now(); const result = db.prepare('UPDATE pool_burn_worker SET lease=?,lease_until=? WHERE id=1 AND lease_until<?').run(id, now + LEASE_MS, now); return result.changes ? id : null; },
    owns(id) { const row = db.prepare('SELECT lease,lease_until FROM pool_burn_worker WHERE id=1').get(); return row.lease === id && row.lease_until > Date.now(); },
    report(id, document) { db.prepare('UPDATE pool_burn_worker SET heartbeat=?,document=? WHERE id=1 AND lease=?').run(Date.now(), json(document), id); },
    release(id) { db.prepare('UPDATE pool_burn_worker SET lease=NULL,lease_until=0 WHERE id=1 AND lease=?').run(id); },
  };
  return store;
}
function status(store, context) {
  const c = store.config(), worker = store.worker();
  // An explicit allow-list: neither encrypted keys nor signed transaction bytes leave the server.
  const config = c ? { address: c.address, chainId: c.chainId, token: c.token, quote: c.quote, maxGasGwei: c.maxGasGwei, enabled: c.enabled, revision: c.revision, updatedAt: c.updatedAt, matches: sameContext(c, context) } : null;
  const history = store.db.prepare('SELECT document,status FROM pool_burn_transactions ORDER BY created_at DESC LIMIT 20').all().map(row => {
    const tx = JSON.parse(row.document);
    return { hash: tx.hash, status: row.status, createdAt: tx.createdAt, confirmedAt: tx.confirmedAt || null, amount: tx.amount || null, address: tx.address, token: tx.token, chainId: tx.chainId };
  });
  const fresh = worker.heartbeat > Date.now() - 180_000 && sameContext(worker, context);
  const matched = sameContext(worker, context);
  return { config, context: { chainId: context.chainId, token: context.token, quote: context.quote }, worker: { heartbeat: worker.heartbeat, fresh,
    status: worker.status || 'starting', message: worker.message || '', balance: matched && worker.walletAddress === c?.address ? worker.balance ?? null : null,
    observedAt: worker.observedAt || null, chain: matched ? worker.chain || null : null }, history, pending: !!store.pending() };
}
function saveConfiguration(store, context, input, actor, env = process.env) {
  if (typeof input.maxGasGwei !== 'string' || !/^(?:0|[1-5])(?:\.\d{1,9})?$/.test(input.maxGasGwei) || parseGwei(input.maxGasGwei) <= 0n || parseGwei(input.maxGasGwei) > parseGwei('5')) fail('GAS 单价上限应大于 0 且不超过 5 Gwei');
  const key = typeof input.privateKey === 'string' ? input.privateKey.trim() : '';
  let account;
  if (key) {
    try { if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(); account = privateKeyToAccount(key); }
    catch { fail('私钥格式不正确，请填写专用执行钱包的 0x 私钥'); }
  }
  store.atomic(() => {
    const old = store.config();
    if ((old?.revision || 0) !== input.revision) fail('配置已更新，请刷新后重试');
    if (store.pending()) fail('有交易等待核对，暂不能更换执行配置');
    if (!account && (!old || !sameContext(old, context))) fail('请填写当前代币的专用执行钱包私钥');
    const c = { ...context, rpcUrls: undefined, address: account?.address || old.address, maxGasGwei: input.maxGasGwei, enabled: false, revision: (old?.revision || 0) + 1, updatedAt: Date.now() };
    c.encryptedKey = account ? seal(key, c, 'wallet', env) : old.encryptedKey;
    // Verify decryptability even when retaining the existing wallet.
    unseal(c.encryptedKey, c, 'wallet', env);
    store.putConfig(c);
    store.audit(actor, '保存底池燃烧配置', `执行钱包 ${c.address}；GAS 上限 ${c.maxGasGwei} Gwei；自动执行已暂停`);
  });
}
async function inspect(client, context) {
  if (await client.getChainId() !== context.chainId) fail('RPC 网络与配置不一致');
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const names = ['POOL_BURN_INTERVAL', 'POOL_BURN_BPS', 'tradingPair', 'usdt', 'nextPoolBurnTime', 'lastPoolBurnTime', 'totalPoolBurned', 'previewPoolBurn'];
  const [interval, bps, pair, quote, next, last, total, preview] = await Promise.all(names.map(functionName => client.readContract({ address: context.token, abi, functionName, blockNumber })));
  const block = await client.getBlock({ blockNumber });
  if (Math.abs(Date.now() / 1000 - Number(block.timestamp)) > 180) fail('RPC 区块时间已过期，请检查节点');
  if (interval !== 28800n || bps !== 100n || quote.toLowerCase() !== context.quote.toLowerCase() || !Array.isArray(preview) || preview.length !== 3) fail('链上燃烧规则或 USDT 地址不匹配');
  const [amount, nextBurnAt, due] = preview;
  if (typeof amount !== 'bigint' || typeof nextBurnAt !== 'bigint' || typeof due !== 'boolean' || amount < 0n || next !== nextBurnAt || last < 0n || last > block.timestamp || total < 0n || (next > 0n && next < last + interval) || (pair === zeroAddress && (next !== 0n || due || amount !== 0n)) || (due && (next === 0n || amount === 0n || next > block.timestamp))) fail('链上燃烧状态校验失败');
  return { pair, amount, nextBurnAt, due, lastBurnAt: last, totalBurned: total, timestamp: block.timestamp };
}
async function setEnabled(store, context, enabled, revision, actor, env = process.env, client = clientFor(context)) {
  const before = store.config();
  if (!before || before.revision !== revision) fail('配置已更新或尚未保存，请刷新后重试');
  if (enabled) {
    if (!sameContext(before, context)) fail('代币配置已变化，请重新保存执行钱包');
    if (!status(store, context).worker.fresh) fail('定时服务尚未就绪，请等一分钟后重试或检查服务');
    if (store.pending()) fail('上一笔交易正在核对，请稍后启用');
    unseal(before.encryptedKey, before, 'wallet', env);
    await inspect(client, context);
    if (await client.getBalance({ address: before.address }) < MIN_BALANCE) fail('执行钱包 BNB 不足，请先充值至少 0.0001 BNB');
  }
  store.atomic(() => {
    const current = store.config();
    if (current.revision !== revision || (enabled && store.pending())) fail('任务状态已变化，请刷新后重试');
    store.putConfig({ ...current, enabled, revision: revision + 1, updatedAt: Date.now() });
    store.audit(actor, enabled ? '启用底池自动燃烧' : '暂停底池自动燃烧', `执行钱包 ${current.address}；代币 ${current.token}`);
  });
}
function notFound(error) { return ['TransactionReceiptNotFoundError', 'TransactionNotFoundError'].includes(error?.name); }
function stop(store, message) {
  store.atomic(() => {
    const c = store.config();
    if (c?.enabled) { store.putConfig({ ...c, enabled: false, revision: c.revision + 1, updatedAt: Date.now() }); store.audit('system', '底池自动燃烧已暂停', message); }
  });
}
function complete(store, tx, result, amount) {
  store.atomic(() => {
    const record = { ...tx, encryptedRaw: undefined, confirmedAt: Date.now(), amount: amount?.toString() };
    store.db.prepare('UPDATE pool_burn_transactions SET status=?,document=? WHERE hash=? AND status=\'pending\'').run(result, json(record), tx.hash);
    store.audit('system', result === 'confirmed' ? '底池燃烧成功' : '底池燃烧交易异常', `${tx.hash}${amount ? `；${amount} 个最小单位` : ''}`);
    if (result !== 'confirmed') {
      const c = store.config();
      if (c) store.putConfig({ ...c, enabled: false, revision: c.revision + 1, updatedAt: Date.now() });
    }
  });
}
async function reconcile(store, client, context, tx, env, lease) {
  if (!sameContext(tx, context)) { stop(store, '待核对交易的代币与当前网站不一致'); return ['needs-review', '旧代币仍有待核对交易，请联系维护人员']; }
  if (await client.getChainId() !== tx.chainId) fail('RPC 网络不一致，暂不处理交易');
  let receipt;
  try { receipt = await client.getTransactionReceipt({ hash: tx.hash }); } catch (e) { if (!notFound(e)) throw e; }
  if (receipt) {
    const head = await client.getBlockNumber({ cacheTime: 0 });
    if (head < receipt.blockNumber + 1n) return ['pending', '交易已打包，等待第二个区块确认'];
    const transaction = await client.getTransaction({ hash: tx.hash });
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash) return ['pending', '链上区块变化，继续核对交易'];
    const identity = receipt.transactionHash.toLowerCase() === tx.hash.toLowerCase() && transaction.from.toLowerCase() === tx.address.toLowerCase() && transaction.to?.toLowerCase() === tx.token.toLowerCase() && transaction.input === burnData && transaction.value === 0n && transaction.nonce === tx.nonce;
    const events = receipt.logs.filter(log => log.address.toLowerCase() === tx.token.toLowerCase()).flatMap(log => {
      try { const event = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true }); return event.eventName === 'PoolBurned' ? [event.args] : []; } catch { return []; }
    });
    const event = events[0];
    if (!identity || (receipt.status === 'success' && (events.length !== 1 || event.pair.toLowerCase() !== tx.pair.toLowerCase() || event.amount <= 0n || event.amount !== event.poolBalanceBefore / 100n || event.executedAt !== block.timestamp))) {
      complete(store, tx, 'invalid'); return ['needs-review', '交易回执不符合预期，已暂停，请联系维护人员核对'];
    }
    complete(store, tx, receipt.status === 'success' ? 'confirmed' : 'reverted', event?.amount);
    return receipt.status === 'success' ? ['confirmed', '最近一笔燃烧已确认'] : ['reverted', '交易执行失败，已自动暂停，请核对后再启用'];
  }
  if (await client.getTransactionCount({ address: tx.address, blockTag: 'latest' }) > tx.nonce) {
    stop(store, '执行钱包的待确认 nonce 已被其他交易占用');
    return ['needs-review', '执行钱包发生其他交易，已暂停；请联系维护人员核对待处理记录'];
  }
  // Retry exactly the persisted bytes/hash, including after an ambiguous RPC timeout.
  // A pause prevents new transactions, but a signed transaction may already be on the network.
  if (!store.owns(lease)) return ['pending', '等待下次核对'];
  const raw = unseal(tx.encryptedRaw, tx, 'transaction', env);
  if (keccak256(raw) !== tx.hash) fail('待处理交易校验失败');
  try {
    const hash = await client.sendRawTransaction({ serializedTransaction: raw });
    if (hash.toLowerCase() !== tx.hash.toLowerCase()) fail('交易哈希不匹配');
  } catch { return ['pending', '等待链上确认；网络返回不确定，将继续核对同一笔交易']; }
  return ['pending', '已提交燃烧交易，等待链上确认'];
}
async function tick(store, context, env = process.env, client = clientFor(context)) {
  const lease = store.lease(); if (!lease) return;
  let snapshot = { ...context, rpcUrls: undefined, observedAt: Date.now(), balance: null, chain: null };
  const report = (state, message) => store.report(lease, { ...snapshot, status: state, message });
  try {
    // Publish a heartbeat even when RPC reads fail. No transaction is made without an enabled configuration.
    report('checking', '正在检查');
    const pending = store.pending();
    if (pending) {
      const [state, message] = await reconcile(store, client, context, pending, env, lease);
      report(state, message); return;
    }
    const c = store.config();
    if (c && !sameContext(c, context)) { stop(store, '网站代币已变更，需要重新配置'); report('mismatch', '网站代币已变更，请重新保存执行钱包'); return; }
    const [chain, balance] = await Promise.all([inspect(client, context), c ? client.getBalance({ address: c.address }) : Promise.resolve(null)]);
    snapshot = { ...snapshot, chain, walletAddress: c?.address || null, balance: balance?.toString() ?? null, observedAt: Date.now() };
    if (!c) { report('unconfigured', '请先保存专用执行钱包'); return; }
    if (!c.enabled) { report('paused', '自动执行已暂停'); return; }
    if (balance < MIN_BALANCE) { report('low-balance', 'BNB 余额不足，请充值 GAS；到账后自动重试'); return; }
    if (!chain.due) { report('waiting', chain.nextBurnAt === 0n ? '等待合约开启燃烧计时' : chain.timestamp < chain.nextBurnAt ? '等待下一次燃烧时间' : '等待池内流动性和储备满足条件'); return; }
    const gasPrice = await client.getGasPrice();
    if (gasPrice > parseGwei(c.maxGasGwei)) { report('high-gas', '当前 GAS 单价超过上限，等待费用下降'); return; }
    const key = unseal(c.encryptedKey, c, 'wallet', env), account = privateKeyToAccount(key);
    if (account.address.toLowerCase() !== c.address.toLowerCase()) fail('执行钱包校验失败');
    await client.simulateContract({ address: c.token, abi, functionName: 'burnPool', account: account.address, gasPrice });
    const estimate = await client.estimateContractGas({ address: c.token, abi, functionName: 'burnPool', account: account.address, gasPrice });
    const gas = (estimate * 120n + 99n) / 100n;
    if (gas > 500_000n) { report('gas-limit', '预估 GAS 用量异常，暂不发送'); return; }
    if (await client.getBalance({ address: c.address }) < gas * gasPrice) { report('low-balance', 'BNB 不足以支付本次 GAS，请充值'); return; }
    const [nonce, latestNonce] = await Promise.all(['pending', 'latest'].map(blockTag => client.getTransactionCount({ address: c.address, blockTag })));
    if (nonce !== latestNonce) { report('wallet-busy', '执行钱包有其他待确认交易，请等待其完成'); return; }
    const raw = await account.signTransaction({ chainId: c.chainId, type: 'legacy', to: c.token, data: burnData, value: 0n, gas, gasPrice, nonce });
    const hash = keccak256(raw), tx = { chainId: c.chainId, token: c.token, quote: c.quote, address: c.address, pair: chain.pair, nonce, hash, createdAt: Date.now(), encryptedRaw: seal(raw, c, 'transaction', env) };
    // Durable intent precedes broadcast. Config revision and lease are checked in the same SQLite transaction.
    store.atomic(() => {
      const current = store.config();
      if (!store.owns(lease) || !current?.enabled || current.revision !== c.revision) fail('配置已更新，本次未发送');
      store.db.prepare("INSERT INTO pool_burn_transactions(hash,status,created_at,document) VALUES(?,'pending',?,?)").run(hash, tx.createdAt, json(tx));
    });
    const [state, message] = await reconcile(store, client, context, tx, env, lease);
    report(state, message);
  } catch (e) {
    // Never forward RPC/viem error objects: they can include transaction material or URLs.
    report('error', e instanceof BurnError ? e.message : '链上检查暂未完成，将在下一分钟重试；请检查节点和钱包状态');
  } finally { store.release(lease); }
}
module.exports = { BurnError, contextFromEnv, clientFor, openStore, status, saveConfiguration, setEnabled, tick, inspect, abi };
