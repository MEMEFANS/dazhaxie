/* eslint-disable @typescript-eslint/no-require-imports -- Local-only launch console; all signing stays in the wallet. */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createPublicClient, fallback, http: rpcHttp } = require('viem');
const { bsc } = require('viem/chains');
const { buildBundle, createSession } = require('./launch-deployment-session.cjs');
const { createStage2Session } = require('./launch-stage2-session.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output', 'launch-deployment');
const deployConfig = JSON.parse(fs.readFileSync(path.join(root, 'deploy', 'launch-mainnet.template.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(root, 'deploy', 'launch-stage2.json'), 'utf8'));
const bundle = buildBundle();
const port = Number(process.env.CABI_LAUNCH_STAGE2_PORT || 8791);
const origin = `http://127.0.0.1:${port}`;
const client = createPublicClient({ chain: bsc, transport: fallback([
  rpcHttp('https://bsc-rpc.publicnode.com', { timeout: 12000, retryCount: 0 }),
  rpcHttp('https://bsc-dataseed.bnbchain.org', { timeout: 12000, retryCount: 0 }),
], { retryCount: 0 }) });
const deployment = createSession({ client, config: deployConfig, bundle, recordFile: path.join(output, 'result.json') });
const session = createStage2Session({ client, config, recordFile: path.join(output, 'stage2-result.json') });
const files = {
  '/': ['deploy/launch-stage2-console/index.html', 'text/html; charset=utf-8'],
  '/wallet.js': ['deploy/launch-stage2-console/wallet.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['deploy/launch-console/style.css', 'text/css; charset=utf-8'],
  '/manifest.json': ['output/launch-deployment/stage2-manifest.json', 'application/json; charset=utf-8'],
};
let queue = Promise.resolve();
function sequential(action) { const operation = queue.then(action); queue = operation.catch(() => {}); return operation; }
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const { state } = await deployment.status();
  if (!state.complete || state.token.toLowerCase() !== config.token.toLowerCase() || state.pool.toLowerCase() !== config.pool.toLowerCase() || state.pair.toLowerCase() !== config.pair.toLowerCase()) throw new Error('新代币、交易对和领取池未全部核验，停止操作');
  const initial = await session.status();
  const manifest = { ...config, kinds: session.kinds, labels: session.labels, fingerprint: session.fingerprint, initialState: initial.state };
  fs.writeFileSync(path.join(output, 'stage2-manifest.json'), JSON.stringify(manifest, null, 2));
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
    const json = (status, body) => response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
    try {
      const url = new URL(request.url, origin);
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(request.headers.host)) { json(403, { error: '请使用本机加池页面' }); return; }
      if (request.method === 'GET' && url.pathname === '/api/state') { json(200, await sequential(() => session.status())); return; }
      if (request.method === 'GET' && url.pathname === '/api/plan') { json(200, await sequential(() => session.plan(url.searchParams.get('kind')))); return; }
      if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
        if (![origin, `http://localhost:${port}`].includes(request.headers.origin)) { json(403, { error: '请在本机页面操作' }); return; }
        let raw = '';
        for await (const chunk of request) { raw += chunk; if (raw.length > 4096) throw new Error('请求过长'); }
        const body = JSON.parse(raw);
        if (!session.kinds.includes(body.kind)) throw new Error('未知操作步骤');
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
      const file = files[url.pathname];
      if (request.method !== 'GET' || !file) { response.writeHead(404).end('Not found'); return; }
      response.writeHead(200, { 'Content-Type': file[1] }).end(fs.readFileSync(path.join(root, file[0])));
    } catch (error) {
      const message = error.shortMessage || error.message || '操作未完成';
      if (/not found|could not be found|receipt.*missing/i.test(message)) json(202, { pending: true, message: '等待交易上链确认' });
      else json(400, { error: message });
    }
  });
  server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ url: origin, state: initial.state })));
}
main().catch(error => { console.error(error.shortMessage || error.message); process.exitCode = 1; });
