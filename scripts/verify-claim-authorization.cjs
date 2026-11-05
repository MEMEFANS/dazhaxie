/* eslint-disable @typescript-eslint/no-require-imports -- Isolated server fixture; generated test key, no private files, network or real wallet. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const viem = require('viem');
const { generatePrivateKey, privateKeyToAccount } = require('viem/accounts');
const key = generatePrivateKey(), signer = privateKeyToAccount(key);
const USER = '0x1111111111111111111111111111111111111111';
const POOL = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const USDT = '0x4444444444444444444444444444444444444444';
const LP = '0x5555555555555555555555555555555555555555';
const unit = 10n ** 18n, entitlement = 70000n * unit;
let balance = 100n * unit, reads = [], saved = [];
class AdminRequestError extends Error { constructor(message, status) { super(message); this.status = status; } }
const client = {
  getCode: async () => '0x6000', getChainId: async () => 56,
  readContract: async ({ functionName }) => {
    reads.push(functionName);
    const values = { token: TOKEN, signer: signer.address, claimedOf: 0n, lpReceiver: LP, usdt: USDT, usdtDecimals: 18, balanceOf: balance, allowance: 0n };
    assert(Object.hasOwn(values, functionName), 'unexpected read ' + functionName);
    return values[functionName];
  },
};
const db = {
  entitlementTokens: () => entitlement, localClaimedTokens: () => 0n,
  countAuthorizationsSince: () => 0, latestOpenAuthorization: () => saved.at(-1),
  nextAuthorizationNonce: () => String(saved.length + 1),
  saveClaimAuthorization: value => saved.push({ ...value, amount: String(value.amount) }),
};
const replacements = {
  'server-only': {}, viem: { ...viem, createPublicClient: () => client },
  '../chain-config': { appChain: { id: 56 }, chainConfig: { id: 56, rpcUrls: ['http://isolated.invalid'] }, chainConfigurationValid: true, contracts: { token: TOKEN, usdt: USDT, claimPool: POOL } },
  './admin-session': { AdminRequestError }, './subscription-db': db,
};
const file = path.resolve(__dirname, '../src/lib/server/claim-auth.ts');
const state = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, {
  module: state, exports: state.exports,
  require: name => Object.hasOwn(replacements, name) ? replacements[name] : require(name),
  process: { env: { CLAIM_SIGNER_PRIVATE_KEY: key } }, Error, Date, console,
}, { filename: file });
async function main() {
  const authorization = await state.exports.issueClaimAuthorization(USER, String(entitlement));
  assert.equal(authorization.usdtRequired, String(30n * unit));
  assert.equal(authorization.amount, String(entitlement));
  assert.equal(authorization.cumulativeLimit, String(entitlement));
  assert.match(authorization.signature, /^0x[0-9a-fA-F]{130}$/);
  assert.equal(saved.length, 1);
  assert(!reads.includes('allowance'));
  console.log('PASS a funded wallet with no USDT allowance receives its claim authorization so the frontend can request exact approval');
  const reused = await state.exports.issueClaimAuthorization(USER, String(entitlement));
  assert.equal(reused.nonce, authorization.nonce);
  assert.equal(reused.signature, authorization.signature);
  assert.equal(saved.length, 1);
  console.log('PASS returning from wallet approval can reuse the outstanding claim authorization');
  balance = 29n * unit;
  await assert.rejects(() => state.exports.issueClaimAuthorization(USER, String(entitlement)), error => error.status === 400 && error.message.includes('USDT 余额不足'));
  assert.equal(saved.length, 1);
  console.log('PASS insufficient USDT balance still stops issuance with the correct balance message');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
