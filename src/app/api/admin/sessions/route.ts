import { addAuditEntry, deleteStoredSessionById, listStoredSessions } from "@/lib/server/admin-db";
import { AdminRequestError, adminErrorResponse, assertSameOrigin, readJsonObject, requireCurrentAdmin } from "@/lib/server/admin-session";

export async function GET() {
  try {
    await requireCurrentAdmin();
    return Response.json({ sessions: listStoredSessions() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireCurrentAdmin(), body = await readJsonObject(request);
    if (typeof body.id !== "string" || !/^[a-f0-9]{16}$/.test(body.id)) throw new AdminRequestError("会话标识无效", 400);
    if (!deleteStoredSessionById(body.id)) throw new AdminRequestError("会话不存在或已过期", 404);
    addAuditEntry(admin.account, "强制下线管理员会话", JSON.stringify({ session: body.id }));
    return Response.json({ sessions: listStoredSessions() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
