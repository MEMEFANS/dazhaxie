import { adminErrorResponse } from "@/lib/server/admin-session";
import { readReferralBinding } from "@/lib/server/referral-db";

// Only the binding flag is public. Account data and writes still require a wallet session.
export async function GET(request: Request) {
  try {
    const account = new URL(request.url).searchParams.get("account");
    return Response.json(readReferralBinding(account), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
