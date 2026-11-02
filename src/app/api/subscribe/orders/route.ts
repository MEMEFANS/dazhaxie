import { connection } from "next/server";
import { assertSharesAllowed, verifySubscriptionTransfer } from "@/lib/server/subscription-chain";
import { createSubscriptionOrder, listAddressSubscriptions } from "@/lib/server/subscription-db";
import { requireReferralWallet } from "@/lib/server/referral-auth";
import { readReferral } from "@/lib/server/referral-db";
import { AdminRequestError, adminErrorResponse, assertSameOrigin, readJsonObject } from "@/lib/server/admin-session";

export async function GET() {
  await connection();
  try {
    const user = await requireReferralWallet();
    return Response.json({ orders: listAddressSubscriptions(user.address, user.chainId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireReferralWallet(), body = await readJsonObject(request);
    // 邀请码门禁不变：未绑定推荐关系的钱包不能认购。
    if (!readReferral(user.address).bound) throw new AdminRequestError("请先绑定邀请码后再认购", 403);
    const shares = assertSharesAllowed(body.shares);
    if (typeof body.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.hash)) throw new AdminRequestError("请提供已完成 USDT 转账的交易哈希", 400);
    const amount = await verifySubscriptionTransfer({ address: user.address, hash: body.hash, shares });
    const order = createSubscriptionOrder({ address: user.address, shares, amount, txHash: body.hash });
    return Response.json({ order }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}
