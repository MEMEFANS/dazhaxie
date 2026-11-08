/* eslint-disable @typescript-eslint/no-require-imports -- Temporary databases only, never production data. */
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { DatabaseSync } = require('node:sqlite');
const { reset, inspect } = require('./reset-business-data.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'cabi-reset-test-')), directory = path.join(root,'data'), backup = path.join(root,'backup');
fs.mkdirSync(directory);
const tables = {
  'subscriptions.sqlite': ['subscription_orders','claim_root_batches','claim_root_items','claim_authorizations'],
  'referrals.sqlite': ['referral_members','referral_challenges','referral_sessions'],
  'redemption.sqlite': ['wallet_challenges','wallet_sessions','redemption_orders'],
  'community.sqlite': ['community_members','community_admins','community_kicks','community_logs','community_messages','tickets','ticket_replies','community_challenges','community_sessions'],
};
function open(file, fn) { const db = new DatabaseSync(file); try { return fn(db); } finally { db.close(); } }
try {
  open(path.join(directory,'operations.sqlite'), db => {
    db.exec(`CREATE TABLE settings(id INTEGER PRIMARY KEY,subscribe_locked INTEGER,exchange_enabled INTEGER,subscribe_payee TEXT,exchange_payee TEXT,updated_at INTEGER);
      INSERT INTO settings VALUES(1,0,1,'keep-subscribe-payee','keep-exchange-payee',1);
      CREATE TABLE sessions(id TEXT); INSERT INTO sessions VALUES('keep-admin-session');
      CREATE TABLE audit(id TEXT,actor TEXT,action TEXT,detail TEXT,at INTEGER); INSERT INTO audit VALUES('old','old','old','old',0);
      CREATE TABLE pool_burn_config(id INTEGER,document TEXT); INSERT INTO pool_burn_config VALUES(1,'encrypted-wallet-fixture');
      CREATE TABLE pool_burn_worker(id INTEGER,document TEXT); INSERT INTO pool_burn_worker VALUES(1,'old-status');
      CREATE TABLE pool_burn_transactions(hash TEXT,status TEXT); INSERT INTO pool_burn_transactions VALUES('old-tx','confirmed');`);
  });
  for (const [file,names] of Object.entries(tables)) open(path.join(directory,file), db => { for(const name of names) db.exec(`CREATE TABLE ${name}(id TEXT); INSERT INTO ${name} VALUES('old-business-record');`); });
  fs.writeFileSync(path.join(directory,'extra-archive-record.json'),'keep in archive');
  const options = { directory, backup, chainId:56, minBlock:'1234', token:'0x'+'1'.repeat(40),pool:'0x'+'2'.repeat(40) };
  assert.throws(()=>reset({...options,minBlock:'bad'})); assert(!fs.existsSync(backup));
  open(path.join(directory,'operations.sqlite'),db=>db.exec("UPDATE pool_burn_transactions SET status='pending'"));
  assert.throws(()=>reset(options),/Pending/); assert(!fs.existsSync(backup));
  open(path.join(directory,'operations.sqlite'),db=>db.exec("UPDATE pool_burn_transactions SET status='confirmed'"));
  const result=reset(options); assert.equal(result.minBlock,'1234');
  for(const [file,names] of Object.entries(tables)) {
    const old=inspect(path.join(backup,'data-before-reset'))[file],fresh=inspect(directory)[file];
    for(const name of names){assert.equal(old[name],1);assert.equal(fresh[name],0);}
  }
  open(path.join(directory,'operations.sqlite'),db=>{
    const s=db.prepare('SELECT * FROM settings').get();assert.equal(s.subscribe_locked,1);assert.equal(s.exchange_enabled,0);assert.equal(s.subscribe_payee,'keep-subscribe-payee');assert.equal(s.exchange_payee,'keep-exchange-payee');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pool_burn_config').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pool_burn_transactions').get().n,0);
    assert.equal(db.prepare('SELECT min_block FROM payment_epochs').get().min_block,'1234');assert.equal(db.prepare('SELECT enabled FROM liquidity_access').get().enabled,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit').get().n,1);
  });
  assert.equal(fs.readFileSync(path.join(backup,'data-before-reset','extra-archive-record.json'),'utf8'),'keep in archive');
  assert.throws(()=>reset(options),/never overwrite/);
  const clean=path.join(root,'clean-copy');fs.renameSync(directory,clean);fs.renameSync(path.join(backup,'data-before-reset'),directory);
  assert.equal(inspect(directory)['subscriptions.sqlite'].subscription_orders,1);
  console.log('PASS reset clears all business tables, preserves administrator/payees, closes services, stores payment cutoff, archives original files, refuses pending tx/overwrite; exact rollback restored original rows.');
} finally { fs.rmSync(root,{recursive:true,force:true}); }
