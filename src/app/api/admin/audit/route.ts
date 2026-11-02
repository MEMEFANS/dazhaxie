import { addAuditEntry, listAuditActions, readAuditEntriesPage } from "@/lib/server/admin-db";
import { AdminRequestError, adminErrorResponse, assertSameOrigin, readJsonObject, requireCurrentAdmin } from "@/lib/server/admin-session";

function number(value: string | null, fallback: number) {
  const parsed = Number(value || "");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function GET(request: Request) {
  try {
    await requireCurrentAdmin();
    const url = new URL(request.url);
    const result = readAuditEntriesPage({
      page: number(url.searchParams.get("page"), 1),
      pageSize: number(url.searchParams.get("pageSize"), 20),
      q: url.searchParams.get("q") || "",
      action: url.searchParams.get("action") || "",
    });
    return Response.json({ ...result, actions: listAuditActions() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}

// 链上操作审计：操作者取当前管理员会话；前后参数、交易哈希与结果由前端在执行前后提交。
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireCurrentAdmin(), body = await readJsonObject(request);
    if (typeof body.action !== "string" || !body.action.trim() || body.action.length > 60) throw new AdminRequestError("审计动作名称无效", 400);
    if (body.status !== undefined && !["pending", "success", "failed"].includes(String(body.status))) throw new AdminRequestError("审计状态无效", 400);
    const payload = {
      before: body.before ?? null,
      after: body.after ?? null,
      txHash: typeof body.txHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(body.txHash) ? body.txHash : undefined,
      status: body.status ?? "pending",
      wallet: typeof body.wallet === "string" ? body.wallet.slice(0, 64) : undefined,
      error: typeof body.error === "string" ? body.error.slice(0, 300) : undefined,
    };
    addAuditEntry(admin.account, body.action.trim(), JSON.stringify(payload));
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
