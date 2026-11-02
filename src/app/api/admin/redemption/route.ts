import { cancelRedemptionOrder, searchRedemptionOrders, shipRedemptionOrder, updateRedemptionNote } from "@/lib/server/redemption-db";
import { addAuditEntry } from "@/lib/server/admin-db";
import { AdminRequestError, adminErrorResponse, assertSameOrigin, readJsonObject, requireCurrentAdmin } from "@/lib/server/admin-session";

function number(value: string | null, fallback: number) {
  const parsed = Number(value || "");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function GET(request: Request) {
  try {
    await requireCurrentAdmin();
    const url = new URL(request.url);
    const result = searchRedemptionOrders({
      q: url.searchParams.get("q") || "",
      status: url.searchParams.get("status") || "",
      from: number(url.searchParams.get("from"), 0) || undefined,
      to: number(url.searchParams.get("to"), 0) || undefined,
      page: number(url.searchParams.get("page"), 1),
      pageSize: number(url.searchParams.get("pageSize"), 20),
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireCurrentAdmin(), body = await readJsonObject(request);
    if (typeof body.id !== "string" || !/^0x[0-9a-f]{64}$/.test(body.id)) throw new AdminRequestError("兑换单号无效", 400);
    if (body.action === "cancel") {
      if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 200) throw new AdminRequestError("请填写 1–200 字的取消原因", 400);
      const order = cancelRedemptionOrder(body.id, body.reason);
      addAuditEntry(admin.account, "取消兑换订单", JSON.stringify({ orderId: order.id, reason: order.note || "" }));
      return Response.json({ order }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.note !== undefined) {
      if (typeof body.note !== "string" || body.note.length > 200) throw new AdminRequestError("备注最多 200 字", 400);
      const order = updateRedemptionNote(body.id, body.note.trim());
      addAuditEntry(admin.account, "更新兑换备注", JSON.stringify({ orderId: order.id }));
      return Response.json({ order }, { headers: { "Cache-Control": "no-store" } });
    }
    if (typeof body.carrier !== "string" || !body.carrier.trim() || body.carrier.length > 60 || typeof body.trackingNumber !== "string" || !/^[a-zA-Z0-9-]{5,80}$/.test(body.trackingNumber)) throw new AdminRequestError("请填写物流公司和有效运单号", 400);
    const order = shipRedemptionOrder(body.id, body.carrier.trim(), body.trackingNumber.trim());
    addAuditEntry(admin.account, "蟹礼订单发货", JSON.stringify({ orderId: order.id }));
    return Response.json({ order }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
