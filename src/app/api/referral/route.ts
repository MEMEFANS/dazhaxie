import { assertSameOrigin, readJsonObject, adminErrorResponse, AdminRequestError } from "@/lib/server/admin-session";
import { currentReferralWallet, requireReferralWallet, logoutReferralWallet } from "@/lib/server/referral-auth";
import { readReferral, bindReferral } from "@/lib/server/referral-db";
const headers={"Cache-Control":"no-store"};
export async function GET() {
  try { const session=await currentReferralWallet(); return Response.json({session,data:session?readReferral(session.address):null},{headers}); }
  catch(error){return adminErrorResponse(error);}
}
export async function POST(request:Request) {
  try { assertSameOrigin(request); const session=await requireReferralWallet(),body=await readJsonObject(request);
    if(typeof body.account!=="string"||body.account.toLowerCase()!==session.address.toLowerCase())throw new AdminRequestError("钱包已切换，请重新登录",409);
    return Response.json({data:bindReferral(session.address,body.code)},{headers}); }
  catch(error){return adminErrorResponse(error);}
}
export async function DELETE(request:Request) {
  try { assertSameOrigin(request); await logoutReferralWallet(); return Response.json({ok:true},{headers}); }
  catch(error){return adminErrorResponse(error);}
}
