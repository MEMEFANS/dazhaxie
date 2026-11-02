import { createWalletChallenge } from "@/lib/server/redemption-auth";
import { adminErrorResponse, assertSameOrigin, readJsonObject } from "@/lib/server/admin-session";
export async function POST(request: Request) { try { assertSameOrigin(request); const body=await readJsonObject(request); return Response.json(createWalletChallenge(request, body.address), { headers: { "Cache-Control": "no-store" } }); } catch(error) { return adminErrorResponse(error); } }

