import { readRedemptionConfig, verifyRedemptionTransfer } from "@/lib/server/redemption-chain";
import { createRedemptionOrder, listRedemptionOrders } from "@/lib/server/redemption-db";
import { requireRedemptionWallet } from "@/lib/server/redemption-auth";
import { AdminRequestError, adminErrorResponse, assertSameOrigin, readJsonObject } from "@/lib/server/admin-session";
export async function GET() { try { const user=await requireRedemptionWallet(); return Response.json({ orders: listRedemptionOrders(user.address,user.chainId) }, { headers: { "Cache-Control": "no-store" } }); } catch(error) { return adminErrorResponse(error); } }
export async function POST(request: Request) { try {
  assertSameOrigin(request); const user=await requireRedemptionWallet(), body=await readJsonObject(request), config=await readRedemptionConfig();
  if(!config.configured || !config.enabled || !config.payee || !config.unitPrice) throw new AdminRequestError(config.message || "兑换未开放",409);
  if(!Number.isSafeInteger(body.quantity) || Number(body.quantity)<1 || Number(body.quantity)>config.maxPerTransaction!) throw new AdminRequestError(`单次兑换需在 1–${config.maxPerTransaction} 份之间`,400);
  if(!body.shipping || typeof body.shipping!=="object" || Array.isArray(body.shipping)) throw new AdminRequestError("请填写完整收货信息",400);
  const shipping=body.shipping as Record<string,unknown>;
  if(typeof shipping.name!=="string" || !shipping.name.trim() || shipping.name.length>60 || typeof shipping.phone!=="string" || !/^[+0-9 ()-]{6,25}$/.test(shipping.phone) || typeof shipping.address!=="string" || shipping.address.trim().length<5 || shipping.address.length>500) throw new AdminRequestError("收货姓名、电话或地址格式有误",400);
  if(typeof body.hash!=="string" || !/^0x[0-9a-fA-F]{64}$/.test(body.hash)) throw new AdminRequestError("请提供已完成转账的交易哈希",400);
  const amount=(BigInt(config.unitPrice)*BigInt(Number(body.quantity))).toString();
  await verifyRedemptionTransfer({ address: user.address, hash: body.hash, payee: config.payee, amount: BigInt(amount) });
  const order=createRedemptionOrder({ address:user.address, chainId:user.chainId, payee:config.payee, quantity:Number(body.quantity), amount, transactionHash:body.hash, shipping:{name:shipping.name.trim(),phone:shipping.phone.trim(),address:shipping.address.trim()} });
  return Response.json({order}, { status:201,headers:{"Cache-Control":"no-store"}});
} catch(error) { return adminErrorResponse(error); } }
