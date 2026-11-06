import { connection } from "next/server";
import { adminErrorResponse, requireCurrentAdmin } from "@/lib/server/admin-session";
import { claimPoolOverview } from "@/lib/server/claim-auth";

export async function GET() {
  await connection();
  try {
    await requireCurrentAdmin();
    return Response.json(await claimPoolOverview(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}

