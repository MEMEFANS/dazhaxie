import { connection } from "next/server";
import { searchSubscriptions } from "@/lib/server/subscription-db";
import { adminErrorResponse, requireCurrentAdmin } from "@/lib/server/admin-session";

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function GET(request: Request) {
  await connection();
  try {
    await requireCurrentAdmin();
    const q = new URL(request.url).searchParams.get("q") || "";
    const result = searchSubscriptions({ q, page: 1, pageSize: 100 });
    const header = ["地址", "份数", "USDT 金额", "交易哈希", "状态", "收货人", "电话", "收货地址", "物流公司", "运单号", "时间"];
    const lines = [header.map(csvCell).join(",")];
    for (const item of result.items) {
      lines.push([item.address, item.shares, item.amount, item.txHash, item.status, item.shipping?.name || "", item.shipping?.phone || "", item.shipping?.address || "", item.carrier || "", item.trackingNumber || "", new Date(item.createdAt).toISOString()].map(csvCell).join(","));
    }
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response("\uFEFF" + lines.join("\n"), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="cabi-subscriptions-${stamp}.csv"`, "Cache-Control": "no-store" },
    });
  } catch (error) { return adminErrorResponse(error); }
}
