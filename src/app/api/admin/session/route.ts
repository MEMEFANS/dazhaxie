import { adminErrorResponse, getCurrentAdmin, isAdminConfigured } from "@/lib/server/admin-session";
export async function GET() {
  try { const session = await getCurrentAdmin(); return Response.json({ configured: isAdminConfigured(), authenticated: Boolean(session), ...session }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return adminErrorResponse(error); }
}
