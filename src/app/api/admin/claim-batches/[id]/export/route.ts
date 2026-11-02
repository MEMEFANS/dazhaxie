import { connection } from "next/server";
import { formatUnits } from "viem";
import { getClaimBatch, listClaimBatchItems } from "@/lib/server/subscription-db";
import { AdminRequestError, adminErrorResponse, requireCurrentAdmin } from "@/lib/server/admin-session";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    await requireCurrentAdmin();
    const { id } = await context.params;
    const batch = getClaimBatch(id);
    if (!batch) throw new AdminRequestError("批次不存在", 404);
    const items = listClaimBatchItems(id);
    const lines = ["address,amount"];
    for (const item of items) {
      // CLI 默认按 CaBi 枚解析；这里输出 18 位精度的十进制数量。
      lines.push(`${item.address},${formatUnits(BigInt(item.amount), 18)}`);
    }
    return new Response(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${id}.csv"`,
        "Cache-Control": "no-store",
        "X-Claim-Batch-Id": id,
      },
    });
  } catch (error) { return adminErrorResponse(error); }
}
