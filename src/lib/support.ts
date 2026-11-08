export const SUPPORT_CATEGORIES = ["售后服务", "认购问题", "奖励问题", "兑换问题", "交易问题", "其他"];
export type SupportOrderType = "subscribe" | "exchange";
export interface SupportOrder { type: SupportOrderType; id: string }
export const SUPPORT_ORDER_LABELS: Record<SupportOrderType, string> = { subscribe: "认购蟹礼", exchange: "兑换蟹礼" };

export function afterSalesUrl(order?: SupportOrder) {
  const query = new URLSearchParams({ category: "after-sales" });
  if (order) { query.set("type", order.type); query.set("order", order.id); }
  return `/support?${query}`;
}
