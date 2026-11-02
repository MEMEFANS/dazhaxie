import { connection } from "next/server";
import { computeClaimTargets, createClaimBatch, listClaimBatches, previewClaimBatch } from "@/lib/server/subscription-db";
import { readClaimedAddresses } from "@/lib/server/subscription-chain";
import { AdminRequestError, adminErrorResponse, assertSameOrigin, readJsonObject, requireCurrentAdmin } from "@/lib/server/admin-session";

export async function GET(request: Request) {
  await connection();
  try {
    await requireCurrentAdmin();
    const page = Number(new URL(request.url).searchParams.get("page") || "1");
    return Response.json(listClaimBatches({ page: Number.isFinite(page) && page > 0 ? page : 1, pageSize: 10 }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireCurrentAdmin();
    const body = await readJsonObject(request);
    const action = body.action === "preview" ? "preview" : "generate";
    const targets = computeClaimTargets();
    const skipClaimed = await readClaimedAddresses(targets.map(target => target.address));
    if (action === "preview") {
      const preview = previewClaimBatch({ skipClaimed });
      return Response.json({
        targets: preview.items.map(item => ({ address: item.address, amount: item.amount.toString() })),
        skipped: preview.skipped, total: preview.total.toString(), totalTokens: (Number(preview.total) / 1e18).toFixed(2),
      }, { headers: { "Cache-Control": "no-store" } });
    }
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 80) : "";
    const result = createClaimBatch({ skipClaimed, note });
    const { batch } = result;
    return Response.json({
      batch: { ...batch, total: batch.total },
      items: result.items.map(item => ({ address: item.address, amount: item.amount.toString(), tokens: (Number(item.amount) / 1e18).toFixed(6) })),
      skipped: result.skipped,
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AdminRequestError) return adminErrorResponse(error);
    return adminErrorResponse(new AdminRequestError("生成批次失败，请稍后重试", 500));
  }
}
