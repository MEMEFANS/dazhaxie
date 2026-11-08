/* eslint-disable @typescript-eslint/no-require-imports -- Explicit offline reset; retains a complete restorable archive. */
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto'), { DatabaseSync } = require('node:sqlite');
const databases = {
  'operations.sqlite': ['settings', 'sessions', 'audit', 'liquidity_access', 'payment_epochs', 'pool_burn_config', 'pool_burn_worker', 'pool_burn_transactions'],
  'subscriptions.sqlite': ['subscription_orders', 'claim_root_batches', 'claim_root_items', 'claim_batches', 'claim_batch_items', 'claim_authorizations'],
  'referrals.sqlite': ['referral_members', 'referral_challenges', 'referral_sessions'],
  'redemption.sqlite': ['wallet_challenges', 'wallet_sessions', 'redemption_orders'],
  'community.sqlite': ['community_members', 'community_admins', 'community_kicks', 'community_logs', 'community_messages', 'tickets', 'ticket_replies', 'community_challenges', 'community_sessions'],
};
function tableNames(db) { return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name); }
function q(value) { return '"' + value.replaceAll('"', '""') + '"'; }
function inspect(directory) {
  const result = {};
  for (const [file, allowed] of Object.entries(databases)) {
    const filename = path.join(directory, file);
    if (!fs.existsSync(filename)) { result[file] = {}; continue; }
    const db = new DatabaseSync(filename, { readOnly: true });
    try {
      const tables = tableNames(db);
      if (tables.some(name => !allowed.includes(name))) throw new Error('Unknown table in ' + file + ': inspect before resetting');
      result[file] = Object.fromEntries(tables.map(name => [name, db.prepare(`SELECT COUNT(*) AS n FROM ${q(name)}`).get().n]));
      if (tables.includes('pool_burn_transactions') && db.prepare("SELECT COUNT(*) AS n FROM pool_burn_transactions WHERE status='pending'").get().n) throw new Error('Pending pool-burn transaction must be reconciled before reset');
    } finally { db.close(); }
  }
  return result;
}
function reset(options) {
  const { directory, backup, chainId, minBlock, token, pool } = options;
  if (!path.isAbsolute(directory) || !path.isAbsolute(backup) || fs.realpathSync(directory) !== path.resolve(directory)) throw new Error('Explicit absolute, non-symlink paths required');
  if (directory === path.parse(directory).root || backup === directory || backup.startsWith(directory + path.sep)) throw new Error('Unsafe data/backup paths');
  if (![56,97].includes(chainId) || !/^[1-9]\d*$/.test(minBlock) || ![token,pool].every(v => /^0x[0-9a-fA-F]{40}$/.test(v))) throw new Error('Invalid reset chain, cutoff block, token or pool');
  if (fs.existsSync(backup)) throw new Error('Use a new backup directory; never overwrite an earlier reset');
  const before = inspect(directory), stage = directory + '.reset-' + randomUUID();
  fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
  fs.mkdirSync(stage, { mode: 0o700 });
  const at = Date.now(), scope = [chainId,token.toLowerCase(),pool.toLowerCase()].join(':');
  const original = path.join(backup, 'data-before-reset');
  let moved = false;
  try {
    for (const [file] of Object.entries(databases)) {
      const source = path.join(directory, file), target = path.join(stage, file);
      if (fs.existsSync(source)) {
        const db = new DatabaseSync(source);
        try { db.exec('PRAGMA busy_timeout=5000'); db.prepare('VACUUM INTO ?').run(target); } finally { db.close(); }
      }
      const db = new DatabaseSync(target);
      try {
        db.exec('PRAGMA foreign_keys=OFF; PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE;');
        for (const name of tableNames(db)) {
          if (file === 'operations.sqlite' && ['settings','sessions'].includes(name)) continue;
          db.exec(`DELETE FROM ${q(name)}`);
        }
        if (file === 'operations.sqlite') {
          db.exec(`CREATE TABLE IF NOT EXISTS payment_epochs(chain_id INTEGER PRIMARY KEY,min_block TEXT NOT NULL,reset_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS liquidity_access(scope TEXT PRIMARY KEY,enabled INTEGER NOT NULL,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL);`);
          db.prepare('UPDATE settings SET subscribe_locked=1,exchange_enabled=0,updated_at=? WHERE id=1').run(at);
          db.prepare('INSERT INTO payment_epochs(chain_id,min_block,reset_at) VALUES(?,?,?)').run(chainId, minBlock, at);
          db.prepare('INSERT INTO liquidity_access(scope,enabled,revision,updated_at) VALUES(?,0,1,?)').run(scope, at);
          db.prepare('INSERT INTO audit(id,actor,action,detail,at) VALUES(?,?,?,?,?)').run(randomUUID(),'system','重新发行：清空旧业务数据',JSON.stringify({ backup, chainId, minBlock, retained: ['administrator','payee settings','server keys'] }),at);
        }
        db.exec('COMMIT; VACUUM;');
        if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Reset database integrity check failed');
      } finally { db.close(); }
      fs.chmodSync(target, 0o600);
    }
    const after = inspect(stage);
    fs.writeFileSync(path.join(backup,'manifest.json'), JSON.stringify({ at, directory, chainId, minBlock, token, pool, before, after }, null, 2), { mode: 0o600 });
    // Services MUST be stopped by the caller. Rename retains all original DBs,
    // WALs and auxiliary files, and supports exact rollback without deleting them.
    fs.renameSync(directory, original); moved = true;
    fs.renameSync(stage, directory);
    return { backup: original, directory, minBlock, before, after };
  } catch (error) {
    if (moved && !fs.existsSync(directory)) fs.renameSync(original, directory);
    throw error;
  }
}
module.exports = { inspect, reset };
if (require.main === module) {
  try {
    const args = process.argv.slice(2), directory = process.env.CABI_DATA_DIR;
    if (!directory) throw new Error('CABI_DATA_DIR is required');
    if (!args.length || args[0] === '--inspect') console.log(JSON.stringify(inspect(directory)));
    else if (args[0] === '--apply' && args.length === 6) console.log(JSON.stringify(reset({ directory, backup: path.resolve(args[1]), chainId: Number(args[2]), minBlock: args[3], token: args[4], pool: args[5] })));
    else throw new Error('Use --inspect or --apply BACKUP_DIR CHAIN_ID MIN_BLOCK TOKEN POOL; stop app and timer first');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
