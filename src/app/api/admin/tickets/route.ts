import { listTickets, replyToTicket, setTicketStatus, type TicketStatus } from "@/lib/server/community-db";
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
    const result = listTickets({
      status: url.searchParams.get("status") || "all",
      q: url.searchParams.get("q") || "",
      page: number(url.searchParams.get("page"), 1),
      pageSize: number(url.searchParams.get("pageSize"), 20),
    });
    return Response.json({ ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireCurrentAdmin(), body = await readJsonObject(request);
    if (typeof body.id !== "string" || !body.id.trim()) throw new AdminRequestError("工单编号无效", 400);
    if (typeof body.content !== "string") throw new AdminRequestError("请填写回复内容", 400);
    const ticket = replyToTicket(body.id.trim(), admin.account, body.content);
    addAuditEntry(admin.account, "回复客服工单", JSON.stringify({ ticketId: ticket.id, address: ticket.address }));
    return Response.json({ ticket }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireCurrentAdmin(), body = await readJsonObject(request);
    if (typeof body.id !== "string" || !body.id.trim()) throw new AdminRequestError("工单编号无效", 400);
    if (typeof body.status !== "string" || !["processed", "closed"].includes(body.status)) throw new AdminRequestError("目标状态无效，仅支持已处理或已完结", 400);
    const ticket = setTicketStatus(body.id.trim(), body.status as TicketStatus);
    addAuditEntry(admin.account, body.status === "closed" ? "完结客服工单" : "标记工单已处理", JSON.stringify({ ticketId: ticket.id, address: ticket.address }));
    return Response.json({ ticket }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
