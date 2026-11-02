import { AdminRequestError, adminErrorResponse, assertSameOrigin, createAdminSession, readJsonObject } from "@/lib/server/admin-session";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    if (typeof body.account !== "string" || typeof body.password !== "string" || !body.account.trim() || body.account.length > 100 || !body.password || body.password.length > 512) throw new AdminRequestError("请输入有效的管理员账号和密码", 400);
    return Response.json({ authenticated: true, ...await createAdminSession(request, body.account.trim(), body.password) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
