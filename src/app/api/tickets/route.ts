import { requireCommunityWallet } from "@/lib/server/community-auth";
import { createTicket, listTicketsFor } from "@/lib/server/community-db";
import { adminErrorResponse, assertSameOrigin, readJsonObject } from "@/lib/server/admin-session";
import { ticketOrderSummary } from "@/lib/server/ticket-orders";

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
    const orderSummary = ticketOrderSummary(body.order, session.address, session.chainId);
    return Response.json({ ticket: createTicket(session.address, orderSummary ? { ...body, category: "售后服务" } : body, orderSummary) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
