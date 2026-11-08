import "server-only";

type RpcRequest = { jsonrpc: "2.0"; id: string | number | null; method: string; params?: unknown[] };
type RpcResult = { result?: unknown; error?: { code: number; message: string; data?: unknown } };
const methods = new Set(["eth_chainId", "eth_blockNumber", "eth_call", "eth_getCode", "eth_getBalance", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getTransactionCount", "eth_gasPrice", "eth_maxPriorityFeePerGas"]);
const hex = /^0x[0-9a-f]*$/i, address = /^0x[0-9a-f]{40}$/i, hash = /^0x[0-9a-f]{64}$/i;
const block = (value: unknown) => typeof value === "string" && (/^0x[0-9a-f]+$/i.test(value) || ["latest", "pending", "safe", "finalized", "earliest"].includes(value));
export function validRpcRequest(value: unknown): value is RpcRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as RpcRequest, p = r.params || [];
  if (r.jsonrpc !== "2.0" || !(r.id === null || typeof r.id === "string" && r.id.length <= 100 || typeof r.id === "number" && Number.isSafeInteger(r.id)) || !methods.has(r.method) || !Array.isArray(p)) return false;
  if (["eth_chainId", "eth_blockNumber", "eth_gasPrice", "eth_maxPriorityFeePerGas"].includes(r.method)) return p.length === 0;
  if (["eth_getTransactionReceipt", "eth_getTransactionByHash"].includes(r.method)) return p.length === 1 && typeof p[0] === "string" && hash.test(p[0]);
  if (["eth_getCode", "eth_getBalance", "eth_getTransactionCount"].includes(r.method)) return p.length === 2 && typeof p[0] === "string" && address.test(p[0]) && block(p[1]);
  if (r.method === "eth_getBlockByNumber") return p.length === 2 && block(p[0]) && typeof p[1] === "boolean";
  if (r.method === "eth_getBlockByHash") return p.length === 2 && typeof p[0] === "string" && hash.test(p[0]) && typeof p[1] === "boolean";
  if (r.method !== "eth_call" || p.length !== 2 || !block(p[1]) || !p[0] || typeof p[0] !== "object" || Array.isArray(p[0])) return false;
  const call = p[0] as Record<string, unknown>;
  if (Object.keys(call).some(key => !["to", "from", "data", "input", "value", "gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"].includes(key))) return false;
  if (typeof call.to !== "string" || !address.test(call.to) || call.from !== undefined && (typeof call.from !== "string" || !address.test(call.from))) return false;
  for (const key of ["data", "input", "value", "gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"]) {
    const v = call[key]; if (v !== undefined && (typeof v !== "string" || !hex.test(v) || v.length > 16386)) return false;
  }
  try { return call.gas === undefined || BigInt(String(call.gas)) <= 3_000_000n; } catch { return false; }
}

/** Only public reads. Cache is process-local, bounded, and never used by server payment verification. */
export function createRpcRelay(urls: readonly string[], chainId: number, fetcher: typeof fetch = fetch) {
  const cache = new Map<string, { until: number; value: RpcResult }>();
  const pending = new Map<string, Promise<RpcResult>>();
  const checked = new Map<string, number>();
  const checking = new Map<string, Promise<void>>();
  let upstreamId = 0, preferred = 0;
  async function request(url: string, method: string, params: unknown[]): Promise<RpcResult> {
    const id = ++upstreamId;
    const response = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), cache: "no-store", signal: AbortSignal.timeout(4500) });
    if (!response.ok) throw new Error("RPC unavailable");
    const body = await response.json();
    if (body?.jsonrpc !== "2.0" || body.id !== id || !("result" in body || body.error)) throw new Error("Invalid RPC response");
    return body.error ? { error: { code: Number(body.error.code) || -32000, message: String(body.error.message || "RPC error").slice(0, 400), ...(body.error.data !== undefined ? { data: body.error.data } : {}) } } : { result: body.result };
  }
  async function forward(r: RpcRequest): Promise<RpcResult> {
    for (let attempt = 0; attempt < urls.length; attempt++) {
      const index = (preferred + attempt) % urls.length, url = urls[index];
      try {
        if ((checked.get(url) || 0) < Date.now()) {
          let check = checking.get(url);
          if (!check) {
            check = request(url, "eth_chainId", []).then(chain => {
              if (typeof chain.result !== "string" || Number(BigInt(chain.result)) !== chainId) throw new Error("Wrong RPC chain");
              checked.set(url, Date.now() + 60_000);
            }).finally(() => checking.delete(url));
            checking.set(url, check);
          }
          await check;
        }
        const params = r.params || [];
        const normalized = r.method === "eth_call" ? [{ ...(params[0] as object), gas: (params[0] as Record<string, unknown>).gas || "0x2dc6c0" }, params[1]] : params;
        const result = await request(url, r.method, normalized);
        if (result.error && ![3, -32000, -32015].includes(result.error.code)) throw new Error("RPC rejected request");
        preferred = index; return result;
      } catch { checked.delete(url); }
    }
    return { error: { code: -32002, message: "链上服务繁忙，请稍后重试" } };
  }
  return async (r: RpcRequest): Promise<RpcResult> => {
    const key = JSON.stringify([r.method, r.params || []]);
    const hit = cache.get(key); if (hit && hit.until > Date.now()) return hit.value;
    const running = pending.get(key); if (running) return running;
    if (pending.size >= 80) return { error: { code: -32005, message: "请求较多，请稍后重试" } };
    const task = forward(r).then(value => {
      if (!value.error && value.result !== null && !(r.params || []).includes("pending")) {
        const ttl = r.method === "eth_chainId" ? 60_000 : r.method === "eth_getCode" ? 30_000 : r.method === "eth_call" && block(r.params?.[1]) && String(r.params?.[1]).startsWith("0x") ? 10_000 : 800;
        if (cache.size >= 1500) cache.delete(cache.keys().next().value!);
        cache.set(key, { value, until: Date.now() + ttl });
      }
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, task); return task;
  };
}
