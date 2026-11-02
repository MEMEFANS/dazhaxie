import { requireCommunityWallet } from "@/lib/server/community-auth";
import { createMessage } from "@/lib/server/community-db";
import { AdminRequestError, adminErrorResponse, assertSameOrigin, readJsonObject } from "@/lib/server/admin-session";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireCommunityWallet(), body = await readJsonObject(request);
    if (typeof body.text !== "string") throw new AdminRequestError("消息格式有误", 400);
    return Response.json({ message: createMessage(session.address, body.text) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
