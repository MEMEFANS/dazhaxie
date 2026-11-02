import { createCommunityChallenge } from "@/lib/server/community-auth";
import { adminErrorResponse, readJsonObject } from "@/lib/server/admin-session";

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    return Response.json(createCommunityChallenge(request, body.address), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
