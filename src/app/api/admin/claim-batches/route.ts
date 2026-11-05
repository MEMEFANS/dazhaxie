import { connection } from "next/server";
import { AdminRequestError, adminErrorResponse, assertSameOrigin, readJsonObject, requireCurrentAdmin } from "@/lib/server/admin-session";
import { prepareRootPublish } from "@/lib/server/claim-proof";
import {
  computeClaimTargets, createClaimRootBatch, listClaimRootBatches, nextClaimRootEpoch,
} from "@/lib/server/subscription-db";
import { addAuditEntry } from "@/lib/server/admin-db";

/**
 * Merkle 领取批次。
 * preview：只计算当前应得额度与下一个 epoch，不写库。
 * generate：生成 root + 每人 proof 并落库，返回 owner 上链所需的 calldata。
 */
export async function GET(request: Request) {
  await connection();
  try {
    await requireCurrentAdmin();
    const page = Number(new URL(request.url).searchParams.get("page") || "1");
    return Response.json(listClaimRootBatches({ page: Number.isFinite(page) && page > 0 ? page : 1, pageSize: 10 }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireCurrentAdmin();
    const body = await readJsonObject(request);
    const action = body.action === "preview" ? "preview" : "generate";
    const targets = computeClaimTargets();
    const total = targets.reduce((sum, target) => sum + target.tokens, 0n);
    const epoch = nextClaimRootEpoch();
    if (action === "preview") {
      return Response.json({
        epoch,
        addresses: targets.length,
        total: total.toString(),
        totalTokens: (Number(total) / 1e18).toFixed(2),
        targets: targets.slice(0, 200).map(item => ({ address: item.address, shares: item.shares, tokens: item.tokens.toString(), reason: item.reason })),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const note = typeof body.note === "string" ? body.note.trim().slice(0, 80) : "";
    const result = createClaimRootBatch({ note });
    const publish = prepareRootPublish(result.root, result.epoch);
    addAuditEntry(admin.account, "生成 Merkle 领取批次", `批次 ${result.batch.id}；epoch ${result.epoch}；地址 ${result.batch.addresses}；root ${result.root}`);
    return Response.json({
      batch: result.batch,
      epoch: result.epoch,
      root: result.root,
      calldata: publish.calldata,
      instruction: publish.instruction,
      items: result.items.slice(0, 200).map(item => ({ address: item.address, amount: item.amount, proof: item.proof })),
      total: result.total.toString(),
      exportUrl: `/api/admin/claim-batches/${result.batch.id}/export`,
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AdminRequestError) return adminErrorResponse(error);
    return adminErrorResponse(new AdminRequestError("生成 Merkle 批次失败，请稍后重试", 500));
  }
}
