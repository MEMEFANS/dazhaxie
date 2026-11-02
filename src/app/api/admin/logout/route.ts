import { adminErrorResponse, assertSameOrigin, endAdminSession } from "@/lib/server/admin-session";
export async function POST(request: Request) {
  try { assertSameOrigin(request); await endAdminSession(); return Response.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return adminErrorResponse(error); }
}
