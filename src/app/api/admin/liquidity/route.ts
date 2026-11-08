import { AdminRequestError, adminErrorResponse, assertSameOrigin, readJsonObject, requireCurrentAdmin } from "@/lib/server/admin-session";
import { saveLiquidityAccess } from "@/lib/server/admin-db";
import { liquidityAccessStatus, liquidityScope } from "@/lib/server/liquidity-access";

export async function GET() {
  try { await requireCurrentAdmin(); return Response.json(await liquidityAccessStatus(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return adminErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireCurrentAdmin(), body = await readJsonObject(request);
    if (typeof body.enabled !== "boolean" || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0 || body.scope !== liquidityScope()
      || Object.keys(body).some(key => !["enabled", "revision", "scope"].includes(key))) throw new AdminRequestError("设置参数或合约已变化，请刷新后重试", 400);
    if (body.enabled) {
      const state = await liquidityAccessStatus();
      if (!state.chain?.canPrepare) throw new AdminRequestError(state.reason, state.chain ? 409 : 503);
    }
    const settings = saveLiquidityAccess(liquidityScope(), body.enabled, Number(body.revision), admin.account);
    if (!settings) throw new AdminRequestError("设置已被更新，请刷新后重试", 409);
    // Pausing persists immediately and does not depend on RPC availability.
    return Response.json({ settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
