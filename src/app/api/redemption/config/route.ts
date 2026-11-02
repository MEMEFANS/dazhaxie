import { connection } from "next/server";
import { readRedemptionConfigSnapshot } from "@/lib/server/redemption-chain";
import { adminErrorResponse } from "@/lib/server/admin-session";
export async function GET() {
  await connection();
  try {
    const snapshot = await readRedemptionConfigSnapshot();
    return Response.json(snapshot.config, { headers: { "Cache-Control": "no-store", "X-Redemption-Config-Cache": snapshot.cache } });
  } catch(error) { return adminErrorResponse(error); }
}

