import { searchRedemptionOrders } from "@/lib/server/redemption-db";
import { adminErrorResponse, requireCurrentAdmin } from "@/lib/server/admin-session";

function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: Request) {
  try {
    await requireCurrentAdmin();
    const url = new URL(request.url);
    const result = searchRedemptionOrders({
      q: url.searchParams.get("q") || "",
      status: url.searchParams.get("status") || "",
      from: Number(url.searchParams.get("from") || 0) || undefined,
      to: Number(url.searchParams.get("to") || 0) || undefined,
      page: 1,
      pageSize: 500,
    });
    const labels: Record<string, string> = { paid: "待发货", shipped: "已发货", delivered: "已完结", cancelled: "已取消" };
    const header = ["订单号", "用户地址", "状态", "份数", "代币数量(wei)", "收款地址", "收货人", "电话", "收货地址", "物流公司", "运单号", "备注", "下单时间", "发货时间"];
    const rows = result.items.map(order => [
      order.id, order.address, labels[order.status] || order.status, order.quantity, order.amount, order.payee,
      order.shipping.name, order.shipping.phone, order.shipping.address, order.carrier || "", order.trackingNumber || "", order.note || "",
      new Date(order.createdAt).toISOString(), order.shippedAt ? new Date(order.shippedAt).toISOString() : "",
    ].map(csvCell).join(","));
    const body = `\uFEFF${[header.join(","), ...rows].join("\r\n")}`;
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="cabi-orders-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) { return adminErrorResponse(error); }
}
