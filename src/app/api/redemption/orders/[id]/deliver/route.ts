import { deliverRedemptionOrder } from "@/lib/server/redemption-db";
import { requireRedemptionWallet } from "@/lib/server/redemption-auth";
import { adminErrorResponse, assertSameOrigin } from "@/lib/server/admin-session";
export async function POST(request: Request, context:{params:Promise<{id:string}>}) { try { assertSameOrigin(request); const user=await requireRedemptionWallet(), {id}=await context.params; return Response.json({order:deliverRedemptionOrder(id,user.address)}, {headers:{"Cache-Control":"no-store"}}); } catch(error) { return adminErrorResponse(error); } }

