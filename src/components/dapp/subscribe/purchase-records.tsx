"use client";

import { useId, useState } from "react";
import { Check, Copy, ExternalLink, LoaderCircle } from "lucide-react";
import { formatAssetAmount } from "@/lib/amounts";
import { getExplorerTxUrl } from "@/lib/chain-config";
import type { SubscribeOrderView } from "@/lib/subscribe-data";
import styles from "./purchase-records.module.css";

type PurchaseRecordsProps = {
  orders: SubscribeOrderView[];
  usdtDecimals?: number;
};

function orderStatus(status: string) {
  switch (status.trim().toLowerCase()) {
    case "confirmed": return { label: "认购成功", tone: "success" };
    case "pending": return { label: "确认中", tone: "pending" };
    case "verifying": return { label: "登记中", tone: "pending" };
    case "failed": return { label: "认购失败", tone: "failed" };
    case "cancelled":
    case "canceled": return { label: "已取消", tone: "cancelled" };
    default: return { label: "状态待确认", tone: "unknown" };
  }
}

function orderAmount(amount: string, decimals?: number) {
  if (decimals === undefined) return undefined;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255 || !/^\d+$/.test(amount)) return undefined;
  try { return formatAssetAmount(BigInt(amount), decimals); } catch { return undefined; }
}

function PurchaseRecord({ order, usdtDecimals }: { order: SubscribeOrderView; usdtDecimals?: number }) {
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const status = orderStatus(order.status);
  const paid = orderAmount(order.amount, usdtDecimals);
  const date = new Date(order.createdAt);
  const validDate = Number.isFinite(date.getTime());
  const explorerUrl = getExplorerTxUrl(order.txHash);
  const shortHash = order.txHash.length > 18 ? `${order.txHash.slice(0, 8)}…${order.txHash.slice(-6)}` : order.txHash;

  async function copyHash() {
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(order.txHash);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <li className={styles.record}>
      <div className={styles.recordHeading}>
        <strong>{order.shares}<span>份生态份额</span></strong>
        <span className={styles.status} data-tone={status.tone}><i aria-hidden="true" />{status.label}</span>
      </div>
      <div className={styles.details}>
        <time dateTime={validDate ? date.toISOString() : undefined}>{validDate ? date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "时间待确认"}</time>
        <p><span>{status.tone === "success" ? "实付" : "订单金额"}</span><strong>{paid ?? (usdtDecimals === undefined ? "待配置" : "暂不可用")}{paid !== undefined ? <small>USDT</small> : null}</strong></p>
      </div>
      <div className={styles.hashRow}>
        <span className={styles.hash} title={order.txHash}><span>交易哈希</span><code>{shortHash || "暂无交易哈希"}</code></span>
        <div className={styles.recordActions}>
          <button type="button" onClick={() => void copyHash()} disabled={!order.txHash || copyState === "copying"} aria-label={`复制 ${order.shares} 份认购的完整交易哈希`} className={styles.copyButton}>
            {copyState === "copied" ? <Check size={14} aria-hidden="true" /> : copyState === "copying" ? <LoaderCircle size={14} aria-hidden="true" className={styles.spinner} /> : <Copy size={14} aria-hidden="true" />}
            <span>{copyState === "copied" ? "已复制" : copyState === "copying" ? "复制中" : "复制"}</span>
          </button>
          {explorerUrl ? <a href={explorerUrl} target="_blank" rel="noopener noreferrer" aria-label={`查看 ${order.shares} 份认购的链上交易（新窗口）`}><span className={styles.explorerText}>链上查看</span><ExternalLink size={14} aria-hidden="true" /></a> : null}
        </div>
      </div>
      {copyState === "copied" ? <p role="status" className={styles.copyFeedback}>完整交易哈希已复制</p> : null}
      {copyState === "failed" ? <div className={styles.copyError}><p role="status">复制失败，请手动复制下方完整哈希。</p><code>{order.txHash}</code></div> : null}
    </li>
  );
}

export function PurchaseRecords({ orders, usdtDecimals }: PurchaseRecordsProps) {
  const titleId = useId();
  if (!orders.length) return null;

  return (
    <section className={styles.records} aria-labelledby={titleId}>
      <div className={styles.heading}><h3 id={titleId}>我的认购记录</h3><span>{orders.length} 笔</span></div>
      <ol className={styles.list}>{orders.map(order => <PurchaseRecord key={order.id} order={order} usdtDecimals={usdtDecimals} />)}</ol>
    </section>
  );
}
