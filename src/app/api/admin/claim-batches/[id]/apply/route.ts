import { assertSameOrigin, readJsonObject, requireCurrentAdmin, adminErrorResponse, AdminRequestError } from "@/lib/server/admin-session";
import { getClaimBatch, markClaimBatch } from "@/lib/server/subscription-db";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    await requireCurrentAdmin();
    const { id } = await context.params, body = await readJsonObject(request);
    const before = getClaimBatch(id);
    if (before?.status === "applied") return Response.json({ batch: before, idempotent: true }, { headers: { "Cache-Control": "no-store" } });
    if (body.status === "failed") return Response.json({ batch: markClaimBatch(id, "failed"), idempotent: false }, { headers: { "Cache-Control": "no-store" } });
    if (typeof body.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.txHash)) throw new AdminRequestError("请填写有效的交易哈希", 400);
    const batch = markClaimBatch(id, "applied", body.txHash);
    return Response.json({ batch, idempotent: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
