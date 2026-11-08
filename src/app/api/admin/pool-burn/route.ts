import { chainConfig, contracts } from "@/lib/chain-config";
import { adminDataDirectory } from "@/lib/server/admin-db";
import { AdminRequestError, adminErrorResponse, assertSameOrigin, readJsonObject, requireCurrentAdmin } from "@/lib/server/admin-session";
import { BurnError, contextFromEnv, openStore, saveConfiguration, setEnabled, status } from "@/lib/server/pool-burn-automation.cjs";

export const runtime = "nodejs";
function context() {
  return contextFromEnv({ NEXT_PUBLIC_CHAIN_ID: String(chainConfig.id), NEXT_PUBLIC_TOKEN_ADDRESS: contracts.token,
    NEXT_PUBLIC_USDT_ADDRESS: contracts.usdt, POOL_BURN_RPC_URL: process.env.POOL_BURN_RPC_URL || chainConfig.rpcUrls[0] });
}
function errorResponse(error: unknown) {
  return adminErrorResponse(error instanceof BurnError ? new AdminRequestError(error.message, 400) : error);
}
export async function GET() {
  try {
    await requireCurrentAdmin();
    const store = openStore(adminDataDirectory());
    try { return Response.json(status(store, context()), { headers: { "Cache-Control": "no-store" } }); }
    finally { store.close(); }
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireCurrentAdmin(), body = await readJsonObject(request);
    if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0 || !["save", "enable", "pause"].includes(String(body.action))
      || Object.keys(body).some(key => !["action", "revision", "privateKey", "maxGasGwei"].includes(key))) throw new AdminRequestError("提交参数不正确，请刷新后重试", 400);
    const store = openStore(adminDataDirectory());
    try {
      const current = context();
      if (body.action === "save") {
        if (typeof body.privateKey !== "string" || typeof body.maxGasGwei !== "string") throw new AdminRequestError("请填写钱包与 GAS 配置", 400);
        saveConfiguration(store, current, { privateKey: body.privateKey, maxGasGwei: body.maxGasGwei, revision: Number(body.revision) }, admin.account);
      } else {
        await setEnabled(store, current, body.action === "enable", Number(body.revision), admin.account);
      }
      return Response.json(status(store, current), { headers: { "Cache-Control": "no-store" } });
    } finally { store.close(); }
  } catch (error) { return errorResponse(error); }
}
