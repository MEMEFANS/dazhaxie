import { assertSameOrigin, readJsonObject, requireCurrentAdmin, adminErrorResponse } from "@/lib/server/admin-session";
import { createReferralRoot } from "@/lib/server/referral-db";
import { addAuditEntry } from "@/lib/server/admin-db";
export async function POST(request:Request) {
  try { assertSameOrigin(request); const admin=await requireCurrentAdmin(),body=await readJsonObject(request); const data=createReferralRoot(body.address); addAuditEntry(admin.account,"创建初始邀请人",JSON.stringify({address:data.account,code:data.code})); return Response.json({data},{headers:{"Cache-Control":"no-store"}}); }
  catch(error){return adminErrorResponse(error);}
}
