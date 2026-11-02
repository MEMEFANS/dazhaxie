import { assertSameOrigin, readJsonObject, adminErrorResponse } from "@/lib/server/admin-session";
import { createReferralChallenge } from "@/lib/server/referral-auth";
export async function POST(request: Request) {
  try { assertSameOrigin(request); const body=await readJsonObject(request); return Response.json(createReferralChallenge(request,body.address,body.code),{headers:{"Cache-Control":"no-store"}}); }
  catch(error){return adminErrorResponse(error);}
}
