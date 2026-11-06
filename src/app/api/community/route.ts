import { currentCommunityWallet, requireCommunityWallet } from "@/lib/server/community-auth";
import { findMember, listAdmins, listMembers, listMessages, setMemberName } from "@/lib/server/community-db";
import { AdminRequestError, adminErrorResponse, assertSameOrigin, readJsonObject } from "@/lib/server/admin-session";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") || "1");
    const q = url.searchParams.get("q") || "";
    const members = listMembers({ status: "active", page: Number.isFinite(page) ? page : 1, pageSize: 100, q });
    const admins = listAdmins();
    const session = await currentCommunityWallet();
    const member = session ? findMember(session.address) : null;
    return Response.json({
      members: members.items,
      membersTotal: members.total,
      admins: admins.map(admin => ({ address: admin.address, name: admin.name, at: admin.at })),
      messages: listMessages(100),
      me: session ? {
        address: session.address,
        isAdmin: Boolean(member?.isAdmin),
        isKicked: member?.status === "kicked",
        member: member ? { name: member.name, joinedAt: member.joinedAt, official: member.official } : null,
      } : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireCommunityWallet(), body = await readJsonObject(request);
    if (body.action !== "rename" || typeof body.name !== "string") throw new AdminRequestError("设置内容有误", 400);
    const name = body.name.trim();
    if (!name || name.length > 32) throw new AdminRequestError("名称需为 1–32 个字符", 400);
    setMemberName(session.address, name);
    return Response.json({ member: findMember(session.address) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
