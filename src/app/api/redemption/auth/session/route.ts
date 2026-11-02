import { currentRedemptionWallet, logoutRedemptionWallet } from "@/lib/server/redemption-auth";
import { adminErrorResponse, assertSameOrigin } from "@/lib/server/admin-session";
export async function GET() { try { return Response.json({ session: await currentRedemptionWallet() }, { headers: { "Cache-Control": "no-store" } }); } catch(error) { return adminErrorResponse(error); } }
export async function DELETE(request: Request) { try { assertSameOrigin(request); await logoutRedemptionWallet(); return Response.json({ ok:true }); } catch(error) { return adminErrorResponse(error); } }

