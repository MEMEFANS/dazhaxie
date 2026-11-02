import { connection } from "next/server";
import { addAuditEntry } from "@/lib/server/admin-db";
import { AdminRequestError, adminErrorResponse, assertSameOrigin, readJsonObject, requireCurrentAdmin } from "@/lib/server/admin-session";
import { claimPoolOverview, prepareSignerHandover } from "@/lib/server/claim-auth";

export async function GET() {
  await connection();
  try {
    await requireCurrentAdmin();
    return Response.json(await claimPoolOverview(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}

/** action=handover：只生成 setSigner 的 calldata 与指引并写审计，owner 私钥不进入 Web 服务。 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireCurrentAdmin(), body = await readJsonObject(request);
    if (body.action !== "handover") throw new AdminRequestError("不支持的操作", 400);
    const handover = prepareSignerHandover(body.signer);
    addAuditEntry(admin.account, "提交 signer 权限交接", `目标 signer：${handover.signer}；需由 owner 钱包调用 setSigner`);
    return Response.json({ ...handover, audit: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
