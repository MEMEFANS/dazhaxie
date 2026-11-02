import { requireCommunityWallet } from "@/lib/server/community-auth";
import { kickMemberByGroup } from "@/lib/server/community-db";
import { addAuditEntry } from "@/lib/server/admin-db";
import { AdminRequestError, adminErrorResponse, assertSameOrigin, readJsonObject } from "@/lib/server/admin-session";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireCommunityWallet(), body = await readJsonObject(request);
    if (typeof body.address !== "string") throw new AdminRequestError("请选择要移出的成员", 400);
    const member = kickMemberByGroup(body.address, session.address);
    addAuditEntry(`钱包 ${session.address}`, "群内移出成员", JSON.stringify({ address: member.address, name: member.name }));
    return Response.json({ member }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
