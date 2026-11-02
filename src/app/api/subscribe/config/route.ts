import { connection } from "next/server";
import { isAddress } from "viem";
import { readSubscribeConfig } from "@/lib/server/subscription-chain";
import { adminErrorResponse } from "@/lib/server/admin-session";

export async function GET(request: Request) {
  await connection();
  try {
    const address = new URL(request.url).searchParams.get("address") || "";
    const config = await readSubscribeConfig(isAddress(address, { strict: false }) ? address : undefined);
    return Response.json(config, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
