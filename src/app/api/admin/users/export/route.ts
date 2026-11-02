import { exportUsersCsv } from "@/lib/server/user-detail";
import { adminErrorResponse, requireCurrentAdmin } from "@/lib/server/admin-session";

export async function GET(request: Request) {
  try {
    await requireCurrentAdmin();
    const q = new URL(request.url).searchParams.get("q") || "";
    const csv = await exportUsersCsv(q);
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="cabi-users-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) { return adminErrorResponse(error); }
}
