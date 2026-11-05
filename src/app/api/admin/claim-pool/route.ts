import { connection } from "next/server";
import { addAuditEntry } from "@/lib/server/admin-db";
import { AdminRequestError, adminErrorResponse, assertSameOrigin, readJsonObject, requireCurrentAdmin } from "@/lib/server/admin-session";
import { claimPoolOverview, prepareRootPublish } from "@/lib/server/claim-proof";
import { getClaimRootBatch } from "@/lib/server/subscription-db";

export async function GET() {
  await connection();
  try {
    await requireCurrentAdmin();
    return Response.json(await claimPoolOverview(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}

/** action=publish：只生成 setMerkleRoot 的 calldata 与操作指引并写审计，owner 私钥不进入 Web 服务。 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireCurrentAdmin(), body = await readJsonObject(request);
    if (body.action !== "publish") throw new AdminRequestError("不支持的操作", 400);
    const id = typeof body.batchId === "string" ? body.batchId.trim() : "";
    const batch = getClaimRootBatch(id);
    if (!batch) throw new AdminRequestError("批次不存在", 404);
    const publish = prepareRootPublish(batch.root, batch.epoch);
    addAuditEntry(admin.account, "生成发布 root 的 calldata", `批次 ${batch.id}；epoch ${batch.epoch}；root ${batch.root}`);
    return Response.json({ ...publish, batch, audit: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
