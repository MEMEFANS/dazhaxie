import { normalizePayee, readAuditEntries, readOperationalSettings, saveOperationalSettings } from "@/lib/server/admin-db";
import { invalidateRedemptionConfigCache } from "@/lib/server/redemption-chain";
import { AdminRequestError, adminErrorResponse, assertSameOrigin, readJsonObject, requireCurrentAdmin } from "@/lib/server/admin-session";
export async function GET() {
  try { await requireCurrentAdmin(); return Response.json({ settings: readOperationalSettings(), logs: readAuditEntries() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return adminErrorResponse(error); }
}
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireCurrentAdmin(), body = await readJsonObject(request);
    if (Object.keys(body).some(key => !["subscribeLocked", "exchangeEnabled", "sensitiveWords", "exchangePayee", "subscribePayee"].includes(key)) || typeof body.subscribeLocked !== "boolean" || typeof body.exchangeEnabled !== "boolean" || !Array.isArray(body.sensitiveWords) || body.sensitiveWords.length > 200 || body.sensitiveWords.some(word => typeof word !== "string" || !word.trim() || word.trim().length > 20)) throw new AdminRequestError("设置格式有误，词库最多 200 条，每条最多 20 字", 400);
    if (body.exchangePayee !== undefined && (typeof body.exchangePayee !== "string" || !body.exchangePayee.trim())) throw new AdminRequestError("请填写合法的兑换收款地址", 400);
    if (body.subscribePayee !== undefined && typeof body.subscribePayee !== "string") throw new AdminRequestError("认购收款地址格式不正确", 400);
    let exchangePayee: string | undefined, subscribePayee: string | undefined;
    try { exchangePayee = body.exchangePayee === undefined ? undefined : normalizePayee((body.exchangePayee as string).trim()); }
    catch (error) { throw new AdminRequestError(error instanceof Error ? error.message : "收款地址格式不正确", 400); }
    try { subscribePayee = body.subscribePayee === undefined ? undefined : (body.subscribePayee as string).trim() ? normalizePayee((body.subscribePayee as string).trim()) : ""; }
    catch (error) { throw new AdminRequestError(error instanceof Error ? error.message : "认购收款地址格式不正确", 400); }
    const settings = saveOperationalSettings({ subscribeLocked: body.subscribeLocked, exchangeEnabled: body.exchangeEnabled, sensitiveWords: [...new Set(body.sensitiveWords.map((word: string) => word.trim()))], exchangePayee, subscribePayee }, admin.account);
    // 收款地址或兑换开关变化后立刻失效兑换配置缓存，避免最长 60 秒的旧配置。
    invalidateRedemptionConfigCache();
    return Response.json({ settings, logs: readAuditEntries() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
