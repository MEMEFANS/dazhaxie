import { connection } from "next/server";
import { requireReferralWallet } from "@/lib/server/referral-auth";
import { promotionBranches, promotionStats } from "@/lib/server/subscription-db";
import { adminErrorResponse } from "@/lib/server/admin-session";

export async function GET() {
  await connection();
  try {
    const user = await requireReferralWallet();
    return Response.json({ stats: promotionStats(user.address), branches: promotionBranches(user.address) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
