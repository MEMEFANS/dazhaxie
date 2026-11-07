import { connection } from "next/server";
import { assertSharesAllowed, verifySubscriptionTransfer } from "@/lib/server/subscription-chain";
import { createSubscriptionOrder, listAddressSubscriptions, saveSubscriptionShipping, subscriptionOrderByHash } from "@/lib/server/subscription-db";
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
    const existing = subscriptionOrderByHash(body.hash, user.chainId);
    if (existing) {
      if (existing.address !== user.address.toLowerCase() || existing.shares !== shares) throw new AdminRequestError("该交易哈希已用于其他认购单", 409);
      return Response.json({ order: existing }, { headers: { "Cache-Control": "no-store" } });
    }
    const shipping = body.shipping == null ? undefined : parseShipping(body.shipping);
    const amount = await verifySubscriptionTransfer({ address: user.address, hash: body.hash, shares });
    const order = createSubscriptionOrder({
      address: user.address, shares, amount, txHash: body.hash,
      shipping,
    });
    return Response.json({ order }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireReferralWallet(), body = await readJsonObject(request);
    if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) throw new AdminRequestError("认购单编号无效", 400);
    const order = saveSubscriptionShipping(body.id, user.address, parseShipping(body.shipping));
    return Response.json({ order }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminErrorResponse(error); }
}

function parseShipping(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AdminRequestError("请填写完整收货信息", 400);
  const shipping = value as Record<string, unknown>;
  if (typeof shipping.name !== "string" || !shipping.name.trim() || shipping.name.length > 60
    || typeof shipping.phone !== "string" || !/^[+0-9 ()-]{6,25}$/.test(shipping.phone)
    || typeof shipping.address !== "string" || shipping.address.trim().length < 5 || shipping.address.length > 500)
    throw new AdminRequestError("收货姓名、电话或地址格式有误", 400);
  return { name: shipping.name.trim(), phone: shipping.phone.trim(), address: shipping.address.trim() };
}
