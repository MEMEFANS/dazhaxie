/* eslint-disable @typescript-eslint/no-require-imports -- Node 24 systemd worker; keys are loaded only by the shared server module. */
const { contextFromEnv, openStore, tick } = require('../src/lib/server/pool-burn-automation.cjs');
async function main() {
  const context = contextFromEnv(process.env), store = openStore();
  try { await tick(store, context); }
  finally { store.close(); }
}
main().catch(() => { console.error('Pool burn worker could not start; check service configuration. No secret values are logged.'); process.exitCode = 1; });
