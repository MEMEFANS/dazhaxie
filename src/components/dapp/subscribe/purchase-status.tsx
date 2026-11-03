"use client";

import { CircleMinus, CircleX, Clock3, ExternalLink, LoaderCircle } from "lucide-react";
import { getExplorerTxUrl } from "@/lib/chain-config";
import styles from "./purchase-status.module.css";

export type PurchaseStatusKind = "checking" | "wallet" | "confirming" | "registering" | "registration-failed" | "failed" | "cancelled";

const labels: Record<PurchaseStatusKind, { title: string; message: string }> = {
  checking: { title: "正在核对认购", message: "正在核对本次份额与推荐关系，请稍候。" },
  wallet: { title: "等待钱包确认", message: "请在钱包中核对支付金额与收款地址，并确认本次认购。" },
  confirming: { title: "转账确认中", message: "转账已提交，正在等待链上确认。可查询结果，无需再次支付。" },
  registering: { title: "正在登记认购", message: "转账已确认，正在登记本次份额，请稍候。" },
  "registration-failed": { title: "转账已确认，登记待处理", message: "暂未完成认购登记，请查询本次结果，无需再次支付。" },
  failed: { title: "认购失败", message: "本次认购未完成，请根据钱包或交易提示核对后重试。" },
  cancelled: { title: "认购已取消", message: "你已取消钱包确认，可重新发起认购。" },
};

export function PurchaseStatus({ kind, message, hash, onQuery, querying = false }: {
  kind: PurchaseStatusKind;
  message?: string;
  hash?: string;
  onQuery?: () => void;
  querying?: boolean;
}) {
  const status = labels[kind];
  const spinning = kind === "checking" || kind === "wallet" || kind === "confirming" || kind === "registering";
  const Icon = spinning ? LoaderCircle : kind === "failed" ? CircleX : kind === "cancelled" ? CircleMinus : Clock3;
  const explorer = hash ? getExplorerTxUrl(hash) : "";

  return <div className={styles.status} data-kind={kind} role={kind === "failed" ? "alert" : "status"} aria-live="polite">
    <div className={styles.heading}><Icon size={19} className={spinning ? styles.spinning : undefined} aria-hidden="true" /><strong>{status.title}</strong></div>
    <p>{message || status.message}</p>
    {onQuery || explorer ? <div className={styles.actions}>
      {onQuery ? <button type="button" onClick={onQuery} disabled={querying}>{querying ? "正在查询…" : kind === "confirming" ? "查询转账结果" : "查询认购结果"}</button> : null}
      {explorer ? <a href={explorer} target="_blank" rel="noopener noreferrer">查看链上交易<ExternalLink size={12} aria-hidden="true" /></a> : null}
    </div> : null}
  </div>;
}
