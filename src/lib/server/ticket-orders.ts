import "server-only";
import { SUPPORT_ORDER_LABELS, type SupportOrderType } from "../support";
import { AdminRequestError } from "./admin-session";
import { subscriptionDatabase } from "./subscription-db";
import { redemptionDatabase } from "./redemption-db";

/** Return an order reference for the authenticated buyer without reading shipping details. */
export function ticketOrderSummary(value: unknown, address: string, chainId: number) {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new AdminRequestError("售后订单信息无效", 400);
  const input = value as Record<string, unknown>;
  if ((input.type !== "subscribe" && input.type !== "exchange") || typeof input.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(input.id)) throw new AdminRequestError("售后订单信息无效", 400);
  const type: SupportOrderType = input.type;
  const db = type === "subscribe" ? subscriptionDatabase() : redemptionDatabase();
  const table = type === "subscribe" ? "subscription_orders" : "redemption_orders";
  const order = db.prepare(`SELECT id FROM ${table} WHERE id=? AND address=? AND chain_id=?`).get(input.id, address.toLowerCase(), chainId);
  if (!order) throw new AdminRequestError("未找到当前钱包的订单，请从自己的订单记录进入售后。", 404);
  return `${SUPPORT_ORDER_LABELS[type]}售后\n订单号：${String(order.id)}\n网络 ID：${chainId}`;
}
