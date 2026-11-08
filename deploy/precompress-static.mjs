// Build once; Caddy serves Brotli/gzip sidecars without compressing each request.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
const root = path.resolve(process.argv[2] || '.next/static');
let raw = 0, gzip = 0, brotli = 0, count = 0;
async function compress(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) { await compress(file); continue; }
    if (!/\.(js|css|json|svg)$/.test(file)) continue;
    const content = await readFile(file);
    if (content.length < 512) continue;
    const br = brotliCompressSync(content, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } });
    const gz = gzipSync(content, { level: 9 });
    await writeFile(file + '.br', br); await writeFile(file + '.gz', gz);
    raw += content.length; brotli += br.length; gzip += gz.length; count++;
  }
}
await compress(root);
console.log(JSON.stringify({ precompressed: count, rawBytes: raw, gzipBytes: gzip, brotliBytes: brotli }));
