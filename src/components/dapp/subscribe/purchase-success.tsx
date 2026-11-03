"use client";

import { useId } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ExternalLink } from "lucide-react";
import { getExplorerTxUrl } from "@/lib/chain-config";
import styles from "./purchase-success.module.css";

type PurchaseSuccessProps = {
  shares: number;
  paid: string;
  allocation: string;
  txHash: string;
};

export function PurchaseSuccess({ shares, paid, allocation, txHash }: PurchaseSuccessProps) {
  const titleId = useId();
  const explorerUrl = getExplorerTxUrl(txHash);

  return (
    <section className={styles.success} aria-labelledby={titleId}>
      <div className={styles.heading} role="status">
        <span className={styles.successIcon}><CheckCircle2 size={22} strokeWidth={1.8} aria-hidden="true" /></span>
        <div><span className={styles.eyebrow}>认购已登记</span><h3 id={titleId}>认购成功，一起开启下一程</h3></div>
      </div>
      <p className={styles.description}>本次 <strong>{shares} 份</strong>生态份额已登记，CaBi 配额可到代币中心查看。</p>
      <dl className={styles.summary}>
        <div><dt>本次支付</dt><dd>{paid}<span>USDT</span></dd></div>
        <div><dt>本次获得配额</dt><dd>{allocation}<span>CaBi</span></dd></div>
      </dl>
      <p className={styles.note}>配额尚需领取，实际到账数量以你选择的领取方式为准。</p>
      <div className={styles.nextSteps}>
        <Link href="/dapp/token#allocation" className={styles.viewAllocation}>查看配额</Link>
        <Link href="/dapp/token#claim-center" className={styles.claimTokens}>前往领取<ArrowRight size={15} aria-hidden="true" /></Link>
      </div>
      {explorerUrl ? <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className={styles.transaction}>查看链上交易 <span>{txHash.slice(0, 8)}…{txHash.slice(-6)}</span><ExternalLink size={12} aria-hidden="true" /><span className={styles.srOnly}>（在新窗口打开）</span></a> : null}
    </section>
  );
}
