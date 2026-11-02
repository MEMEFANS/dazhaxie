import { assertSameOrigin, readJsonObject, adminErrorResponse } from "@/lib/server/admin-session";
import { verifyReferralChallenge } from "@/lib/server/referral-auth";
export async function POST(request: Request) {
  try { assertSameOrigin(request); const body=await readJsonObject(request); return Response.json({session:await verifyReferralChallenge(request,body.id,body.signature)},{headers:{"Cache-Control":"no-store"}}); }
  catch(error){return adminErrorResponse(error);}
}
