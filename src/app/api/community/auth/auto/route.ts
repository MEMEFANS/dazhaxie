import { assertSameOrigin, adminErrorResponse, AdminRequestError } from "@/lib/server/admin-session";
import { grantCommunitySessionFromReferral } from "@/lib/server/community-auth";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await grantCommunitySessionFromReferral();
    if (!session) throw new AdminRequestError("请先完成邀请绑定", 401);
    return Response.json({ session }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
