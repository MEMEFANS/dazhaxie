import { connection } from "next/server";
import { readOperationalSettings } from "@/lib/server/admin-db";
export async function GET() {
  await connection();
  try { const { subscribeLocked, exchangeEnabled, updatedAt } = readOperationalSettings(); return Response.json({ subscribeLocked, exchangeEnabled, updatedAt }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    console.error("[operations] Persistent settings unavailable:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "运营设置暂时不可用" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
