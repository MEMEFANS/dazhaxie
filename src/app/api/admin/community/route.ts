import {
  appointAdmin, communityStats, kickMemberByPanel, listAdmins, listKicked, listLogs, listMembers, restoreMember, revokeAdmin,
} from "@/lib/server/community-db";
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
    const status = url.searchParams.get("status") === "kicked" ? "kicked" as const : "active" as const;
    const q = url.searchParams.get("q") || "";
    const members = listMembers({ status, q, page: number(url.searchParams.get("page"), 1), pageSize: number(url.searchParams.get("pageSize"), 20) });
    const logs = listLogs({ page: number(url.searchParams.get("logsPage"), 1), pageSize: 20, action: url.searchParams.get("logsAction") || "" });
    return Response.json({
      members: members.items, membersTotal: members.total, page: members.page, pageSize: members.pageSize,
      admins: listAdmins(), kicked: listKicked(), logs: logs.items, logsTotal: logs.total, logsPage: logs.page,
      stats: communityStats(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireCurrentAdmin(), body = await readJsonObject(request);
    if (typeof body.action !== "string" || !["appoint", "revoke", "kick", "restore"].includes(body.action)) throw new AdminRequestError("操作类型无效", 400);
    if (typeof body.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.address)) throw new AdminRequestError("成员地址格式不正确", 400);
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (reason.length > 200) throw new AdminRequestError("原因最多 200 字", 400);
    const actor = admin.account;
    let member;
    let action = "";
    if (body.action === "appoint") { member = appointAdmin(body.address, actor); action = "设为群管理员"; }
    else if (body.action === "revoke") { member = revokeAdmin(body.address, actor); action = "撤销群管理员"; }
    else if (body.action === "kick") { member = kickMemberByPanel(body.address, actor, reason); action = "后台移出社群成员"; }
    else { member = restoreMember(body.address, actor); action = "恢复社群成员"; }
    addAuditEntry(actor, action, JSON.stringify({ address: member.address, name: member.name, ...(reason ? { reason } : {}) }));
    return Response.json({ member, stats: communityStats() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
