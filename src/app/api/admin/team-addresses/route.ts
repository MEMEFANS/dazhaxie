import { referralTreeRows } from "@/lib/server/referral-db";
import { allSubscriptionShares } from "@/lib/server/subscription-db";
import { adminErrorResponse, requireCurrentAdmin } from "@/lib/server/admin-session";

// 关系边与服务器认购份数；直接发放给后台团队名单，不再读写 XBTSale。
export async function GET() {
  try {
    await requireCurrentAdmin();
    const shares = allSubscriptionShares();
    return Response.json({
      chainAvailable: true,
      source: "server-ledger",
      rows: referralTreeRows().map(row => ({ ...row, purchased: shares.get(String(row.address).toLowerCase()) || 0 })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
