import { connection } from "next/server";
import { liquidityAccessStatus } from "@/lib/server/liquidity-access";
import { adminErrorResponse } from "@/lib/server/admin-session";

export async function GET() {
  await connection();
  try { return Response.json(await liquidityAccessStatus(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return adminErrorResponse(error); }
}
