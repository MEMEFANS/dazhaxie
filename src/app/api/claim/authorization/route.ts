import { connection } from "next/server";
import { claimEntitlement, claimSigningStatus, issueClaimAuthorization, recordClaimReceipt } from "@/lib/server/claim-auth";
import { AdminRequestError, adminErrorResponse, assertSameOrigin, readJsonObject } from "@/lib/server/admin-session";
import { currentCommunityWallet, requireCommunityWallet } from "@/lib/server/community-auth";

/** 领取卡初始化：签名服务是否就绪 + 当前会话地址的可领额度。 */
export async function GET() {
  await connection();
  const signing = claimSigningStatus(), wallet = await currentCommunityWallet();
  const headers = { "Cache-Control": "no-store" };
  if (!wallet) return Response.json({ ...signing, authenticated: false, claimable: null }, { headers });
  try {
    const state = await claimEntitlement(wallet.address);
    return Response.json({
      ...signing, authenticated: true, address: wallet.address,
      claimable: state.outstanding.toString(), entitlement: state.entitlement.toString(),
      chainClaimed: state.chainClaimed.toString(), localClaimed: state.localClaimed.toString(),
    }, { headers });
  } catch (error) {
    if (error instanceof AdminRequestError) {
      return Response.json({ ...signing, authenticated: true, address: wallet.address, claimable: null, error: error.message }, { headers });
    }
    throw error;
  }
}

/** POST 签发领取授权（body: { mode }）；body: { action: "receipt", nonce, hash } 登记领取回执。 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const wallet = await requireCommunityWallet(), body = await readJsonObject(request);
    if (body.action === "receipt") {
      return Response.json({ receipt: await recordClaimReceipt(wallet.address, body.nonce, body.hash) }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json(await issueClaimAuthorization(wallet.address, body.mode), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
