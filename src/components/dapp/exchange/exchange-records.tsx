"use client";
import { useState } from "react";
import Link from "next/link";
import { Headphones, Package, RefreshCw } from "lucide-react";
import { useStore } from "@/lib/store";
import { useRedemptionAccount, redemptionRequest, notifyRedemptionChanged } from "@/lib/redemption-client";
import { getExplorerTxUrl } from "@/lib/chain-config";
import { formatAssetAmount } from "@/lib/amounts";
import { Badge, EmptyRow, SectionTitle, StatusPill } from "@/components/dapp/ui";
import type { RedemptionOrder } from "@/lib/redemption";
import { afterSalesUrl } from "@/lib/support";

const labels: Record<RedemptionOrder["status"], string> = { paid: "待发货", shipped: "已发货", delivered: "已完结", cancelled: "已取消" };
const tones: Record<RedemptionOrder["status"], "live" | "soon" | "paused"> = { paid: "soon", shipped: "live", delivered: "paused", cancelled: "paused" };

export default function ExchangeRecords() {
  const { state, connect } = useStore();
  const account = useRedemptionAccount();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function deliver(id: string) {
    setBusy(id);
    setError("");
    try {
      await redemptionRequest(`/api/redemption/orders/${id}/deliver`, { method: "POST", body: JSON.stringify({}) });
      notifyRedemptionChanged();
      await account.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "订单操作未完成"); }
    finally { setBusy(""); }
  }
  return (
    <section className="card p-5 sm:p-6">
      <SectionTitle icon={Package} title="我的兑换" extra={account.authenticated ? <Badge tone="gray">{account.orders.length} 笔</Badge> : null} />
      {account.authenticated ? <button onClick={() => void account.refresh()} className="btn btn-outline mb-4 min-h-11 px-3 text-xs"><RefreshCw size={13} />刷新订单</button> : null}
      {error || account.error ? <p role="alert" className="mb-3 text-sm text-down">{error || account.error}</p> : null}
      {!account.authenticated ? <button type="button" onClick={state.connected ? () => void account.login() : connect} disabled={account.busy} className="btn btn-outline min-h-11 w-full text-xs">{account.busy ? "请在钱包中确认…" : "查看我的订单"}</button>
        : !account.orders.length ? <EmptyRow text="暂无兑换订单" />
          : <div className="space-y-4">
            {account.orders.map(order => (
              <article key={order.id} className="rounded-xl border border-line p-4">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="text-sm font-medium">{order.quantity} 份蟹礼 · {formatAssetAmount(BigInt(order.amount), 18)} CaBi</p>
                  <StatusPill tone={tones[order.status]}>{labels[order.status]}</StatusPill>
                </div>
                <p className="mt-2 break-all font-mono text-[10px] text-faint">订单 {order.id}</p>
                <p className="mt-2 text-xs leading-6 text-mute">{order.shipping.name} · {order.shipping.phone}<br />{order.shipping.address}</p>
                {order.transactionHash ? <a href={getExplorerTxUrl(order.transactionHash)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs leading-8 text-purple-deep underline">查看转账交易</a> : null}
                {order.carrier ? <p className="mt-2 text-sm leading-6">{order.carrier} · {order.trackingNumber}</p> : null}
                {order.note ? <p className="mt-2 text-xs leading-6 text-faint">备注：{order.note}</p> : null}
                {order.status === "shipped" ? <button disabled={busy === order.id} onClick={() => void deliver(order.id)} className="btn btn-outline mt-3 min-h-11 px-3 text-xs">确认已收到实物</button> : null}
                <Link href={afterSalesUrl({ type: "exchange", id: order.id })} className="btn btn-outline mt-3 flex min-h-11 w-full gap-2 px-3 text-xs"><Headphones size={15} />售后服务</Link>
              </article>
            ))}
          </div>}
    </section>
  );
}
