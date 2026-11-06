import { connection } from "next/server";
import { readOperationalSettings, saveOperationalSettings } from "@/lib/server/admin-db";
import { searchSubscriptions, shipSubscriptionOrder } from "@/lib/server/subscription-db";
import { AdminRequestError, adminErrorResponse, assertSameOrigin, readJsonObject, requireCurrentAdmin } from "@/lib/server/admin-session";

function number(value: string | null, fallback: number) {
  const parsed = Number(value || "");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function GET(request: Request) {
  await connection();
  try {
    await requireCurrentAdmin();
    const url = new URL(request.url);
    const result = searchSubscriptions({
      q: url.searchParams.get("q") || "",
      status: url.searchParams.get("status") || "",
      page: number(url.searchParams.get("page"), 1),
      pageSize: number(url.searchParams.get("pageSize"), 10),
    });
    const settings = readOperationalSettings();
    return Response.json({ ...result, subscribeLocked: settings.subscribeLocked, subscribePayee: settings.subscribePayee }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}

/** 认购收款地址与运营开关；私钥与链上写入不在这里发生。 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireCurrentAdmin(), body = await readJsonObject(request);
    if (body.action === "ship") {
      if (typeof body.id !== "string" || !body.id.trim() || typeof body.carrier !== "string" || !body.carrier.trim() || typeof body.trackingNumber !== "string" || !body.trackingNumber.trim()) throw new AdminRequestError("请填写订单、物流公司和运单号", 400);
      const order = shipSubscriptionOrder(body.id.trim(), body.carrier, body.trackingNumber);
      return Response.json({ order }, { headers: { "Cache-Control": "no-store" } });
    }
    const current = readOperationalSettings();
    if (body.subscribePayee !== undefined && typeof body.subscribePayee !== "string") throw new AdminRequestError("认购收款地址格式不正确", 400);
    if (body.subscribeLocked !== undefined && typeof body.subscribeLocked !== "boolean") throw new AdminRequestError("认购开关格式不正确", 400);
    if (body.subscribePayee === undefined && body.subscribeLocked === undefined) throw new AdminRequestError("没有需要更新的内容", 400);
    const settings = saveOperationalSettings({
      subscribeLocked: body.subscribeLocked === undefined ? current.subscribeLocked : body.subscribeLocked,
      exchangeEnabled: current.exchangeEnabled,
      sensitiveWords: current.sensitiveWords,
      subscribePayee: body.subscribePayee === undefined ? current.subscribePayee : (body.subscribePayee as string).trim(),
    }, admin.account);
    return Response.json({ settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
