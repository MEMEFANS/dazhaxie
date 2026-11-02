import { listUserDetails } from "@/lib/server/user-detail";
import { adminErrorResponse, requireCurrentAdmin } from "@/lib/server/admin-session";

function number(value: string | null, fallback: number) {
  const parsed = Number(value || "");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function GET(request: Request) {
  try {
    await requireCurrentAdmin();
    const url = new URL(request.url);
    const result = await listUserDetails({
      q: url.searchParams.get("q") || "",
      page: number(url.searchParams.get("page"), 1),
      pageSize: number(url.searchParams.get("pageSize"), 10),
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
