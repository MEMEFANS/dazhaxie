/* eslint-disable @typescript-eslint/no-require-imports -- Local deployment console with plugin-wallet signing. */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createPublicClient, fallback, http: rpcHttp } = require('viem');
const { bsc } = require('viem/chains');
const { buildBundle, createSession } = require('./launch-deployment-session.cjs');
const { writeHandoff } = require('./relaunch-handoff.cjs');
const root = path.resolve(__dirname, '..');
const destination = path.resolve(process.env.CABI_LAUNCH_OUTPUT || path.join(root, 'output', 'launch-deployment'));
const config = JSON.parse(fs.readFileSync(process.env.CABI_LAUNCH_CONFIG || path.join(root, 'deploy', 'launch-mainnet.template.json'), 'utf8'));
const bundle = buildBundle();
const port = Number(process.env.CABI_LAUNCH_DEPLOY_PORT || 8789);
const origin = `http://127.0.0.1:${port}`;
const client = createPublicClient({ chain: bsc, transport: fallback([
  rpcHttp('https://bsc-rpc.publicnode.com', { timeout: 12000, retryCount: 0 }),
  rpcHttp('https://bsc-dataseed.bnbchain.org', { timeout: 12000, retryCount: 0 }),
], { retryCount: 0 }) });
const session = createSession({ client, config, bundle, recordFile: path.join(destination, 'result.json') });
const { kinds, labels } = session;
async function stateAndExport() {
  const result = await session.status();
  writeHandoff({ destination, config, state: result.state, fingerprint: session.fingerprint });
  return result;
}
const files = {
  '/': ['deploy/launch-console/index.html', 'text/html; charset=utf-8'],
  '/wallet.js': ['deploy/launch-console/wallet.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['deploy/launch-console/style.css', 'text/css; charset=utf-8'],
  '/standard-input.json': [path.join(destination, 'standard-input.json'), 'application/json'],
  '/manifest.json': [path.join(destination, 'manifest.json'), 'application/json'],
  '/website.env.pending': [path.join(destination, 'website.env.pending'), 'text/plain; charset=utf-8'],
  '/handoff.json': [path.join(destination, 'handoff.json'), 'application/json'],
};
let queue = Promise.resolve();
function sequential(action) {
  const operation = queue.then(action); queue = operation.catch(() => {}); return operation;
}
async function main() {
  fs.mkdirSync(destination, { recursive: true });
  // Validate an existing record before writing any build or deployment artifacts.
  await stateAndExport();
  const preflight = await session.preflight();
  const manifest = { ...config, kinds, labels, fingerprint: session.fingerprint, compiler: require('solc').version(), walletLimitEnabled: false, preflight, preparedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(destination, 'standard-input.json'), JSON.stringify(bundle.input, null, 2));
  fs.writeFileSync(path.join(destination, 'bundle.json'), JSON.stringify(bundle, null, 2));
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2));
  if (process.argv.includes('--prepare')) { console.log(JSON.stringify({ prepared: true, destination, url: origin, preflight })); return; }
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
    const json = (status, body) => response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
    try {
      const url = new URL(request.url, origin);
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(request.headers.host)) { json(403, { error: '请使用本机部署页面' }); return; }
      if (request.method === 'GET' && url.pathname === '/api/state') { json(200, await sequential(stateAndExport)); return; }
      if (request.method === 'GET' && url.pathname === '/api/plan') { json(200, await sequential(() => session.plan(url.searchParams.get('kind')))); return; }
      if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
        if (![origin, `http://localhost:${port}`].includes(request.headers.origin)) { json(403, { error: '请在本机页面操作' }); return; }
        let raw = '';
        for await (const chunk of request) { raw += chunk; if (raw.length > 4096) throw new Error('请求过长'); }
        const body = JSON.parse(raw);
        if (!kinds.includes(body.kind)) throw new Error('未知操作类型');
        const action = url.pathname.slice(5);
        const result = await sequential(async () => {
          if (action === 'begin') return { pending: await session.begin(body.kind, body.nonce, body.dataHash) };
          if (action === 'hash') { session.attachHash(body.kind, body.hash); return { saved: true }; }
          if (action === 'cancel') { session.cancelled(body.kind); return { cleared: true }; }
          if (action === 'verify') return session.verify(body.kind, body.hash);
          throw new Error('未知接口');
        });
        json(result.pending === true ? 202 : 200, result); return;
      }
      const entry = files[url.pathname];
      if (request.method !== 'GET' || !entry) { response.writeHead(404).end('Not found'); return; }
      response.writeHead(200, { 'Content-Type': entry[1] }).end(fs.readFileSync(path.resolve(root, entry[0])));
    } catch (error) {
      const message = error.shortMessage || error.message || '操作未完成';
      if (/not found|could not be found|receipt.*missing/i.test(message)) json(202, { pending: true, message: '等待交易上链确认' });
      else json(400, { error: message });
    }
  });
  server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ url: origin, ...preflight })));
}
main().catch(error => { console.error(error.shortMessage || error.message); process.exitCode = 1; });
