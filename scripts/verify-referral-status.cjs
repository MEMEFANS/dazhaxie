/* eslint-disable @typescript-eslint/no-require-imports -- Real SQLite with isolated synthetic membership fixtures. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cabi-referral-display-'));
const config = { chainConfig: { id: 56 }, contracts: {} };
class AdminRequestError extends Error { constructor(message, status) { super(message); this.status = status; } }
const admin = { AdminRequestError, adminErrorResponse: error => Response.json({ error: error.message }, { status: error.status || 500 }) };
function load(file, replacements) {
  const loaded = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, { module: loaded, exports: loaded.exports, require: name => Object.hasOwn(replacements, name) ? replacements[name] : require(name), globalThis, Response, URL, console });
  return loaded.exports;
}
const referral = load('src/lib/referral.ts', {});
const db = load('src/lib/server/referral-db.ts', { 'server-only': {}, '../chain-config': config, '../referral': referral, './admin-db': { adminDataDirectory: () => temp }, './admin-session': admin });
const route = load('src/app/api/referral/status/route.ts', { '@/lib/server/admin-session': admin, '@/lib/server/referral-db': db });
const A = '0x1111111111111111111111111111111111111111', B = '0x2222222222222222222222222222222222222222', C = '0x3333333333333333333333333333333333333333';
(async () => {
  const project = db.createReferralRoot(A);
  db.bindReferral(B, project.code);
  const count = () => Number(db.referralDatabase().prepare('SELECT COUNT(*) AS n FROM referral_members').get().n);
  const before = count();
  for (const [account, bound] of [[A, true], [B, true], [C, false]]) {
    const response = await route.GET(new Request('http://localhost/api/referral/status?account=' + account));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { account, chainId: 56, bound });
  }
  assert.equal(count(), before, 'display queries must not create members');
  assert.equal(db.readReferral(B).referrer.toLowerCase(), A);
  console.log('PASS existing root, bound account and new account display states; read-only membership query and unchanged binding.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  globalThis.cabiReferralDb?.db.close();
  delete globalThis.cabiReferralDb;
  // Only the exact temporary fixture directory created above is removed.
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
  assert(path.basename(temp).startsWith('cabi-referral-display-'));
  fs.rmSync(temp, { recursive: true, force: true });
});
