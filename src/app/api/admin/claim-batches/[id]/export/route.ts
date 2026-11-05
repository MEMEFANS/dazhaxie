import { connection } from "next/server";
import { formatUnits } from "viem";
import { getClaimRootBatch, listClaimRootItems } from "@/lib/server/subscription-db";
import { AdminRequestError, adminErrorResponse, requireCurrentAdmin } from "@/lib/server/admin-session";

/** 导出 owner 发布 root 所需的完整名单：地址、累计额度、epoch、root 与每人 proof。 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    await requireCurrentAdmin();
    const { id } = await context.params;
    const batch = getClaimRootBatch(id);
    if (!batch) throw new AdminRequestError("批次不存在", 404);
    const items = listClaimRootItems(id);
    // proof 用分号连接，避免 CSV 逗号转义问题；tokens 为 18 位精度的十进制数量。
    const lines = ["address,epoch,root,tokens,proof"];
    for (const item of items) {
      lines.push(`${item.address},${batch.epoch},${batch.root},${formatUnits(BigInt(item.amount), 18)},${item.proof.join(";")}`);
    }
    return new Response(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${id}.csv"`,
        "Cache-Control": "no-store",
        "X-Claim-Batch-Id": id,
        "X-Claim-Batch-Epoch": String(batch.epoch),
        "X-Claim-Batch-Root": batch.root,
      },
    });
  } catch (error) { return adminErrorResponse(error); }
}
