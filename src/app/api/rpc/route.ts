import { chainConfig, chainConfigurationValid } from "@/lib/chain-config";
import { createRpcRelay, validRpcRequest } from "@/lib/server/rpc-relay";

export const runtime = "nodejs";
const relay = createRpcRelay(chainConfig.rpcUrls, chainConfig.id);
const buckets = new Map<string, { used: number; reset: number }>();
const headers = { "Cache-Control": "no-store" };
export async function POST(request: Request) {
  const origin = request.headers.get("origin"), expected = process.env.APP_ORIGIN || new URL(request.url).origin;
  if (request.headers.get("sec-fetch-site") === "cross-site" || origin && origin !== expected) return Response.json({ error: "请从本站读取链上数据" }, { status: 403, headers });
  if (!chainConfigurationValid) return Response.json({ error: "网络配置无效" }, { status: 503, headers });
  if (Number(request.headers.get("content-length") || 0) > 64_000) return Response.json({ error: "请求过长" }, { status: 413, headers });
  let body: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64_000) {
        await reader.cancel();
        return Response.json({ error: "请求过长" }, { status: 413, headers });
      }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return Response.json({ error: "请求格式无效" }, { status: 400, headers }); }
  const batch = Array.isArray(body), calls: unknown[] = Array.isArray(body) ? body : [body];
  if (!calls.length || calls.length > 40 || !calls.every(validRpcRequest)) return Response.json({ error: "仅支持网站所需的链上只读查询" }, { status: 400, headers });
  const key = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local", now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.reset <= now) {
    if (buckets.size >= 4000) for (const [ip, value] of buckets) if (value.reset <= now) buckets.delete(ip);
    if (buckets.size >= 4000) buckets.delete(buckets.keys().next().value!);
    buckets.set(key, { used: calls.length, reset: now + 60_000 });
  } else { bucket.used += calls.length; if (bucket.used > 1200) return Response.json({ error: "请求频繁，请稍后重试" }, { status: 429, headers: { ...headers, "Retry-After": "60" } }); }
  const results = await Promise.all(calls.map(async call => {
    // every(validRpcRequest) above validates the complete batch before forwarding.
    if (!validRpcRequest(call)) throw new Error("Invalid call");
    return { jsonrpc: "2.0", id: call.id, ...await relay(call) };
  }));
  return Response.json(batch ? results : results[0], { headers });
}
