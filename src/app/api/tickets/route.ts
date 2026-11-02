import { requireCommunityWallet } from "@/lib/server/community-auth";
import { createTicket, listTicketsFor } from "@/lib/server/community-db";
import { adminErrorResponse, assertSameOrigin, readJsonObject } from "@/lib/server/admin-session";

export async function GET() {
  try {
    const session = await requireCommunityWallet();
    return Response.json({ tickets: listTicketsFor(session.address) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireCommunityWallet(), body = await readJsonObject(request);
    return Response.json({ ticket: createTicket(session.address, body) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
