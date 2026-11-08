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
  shippingComplete: boolean;
};

export function PurchaseSuccess({ shares, paid, allocation, txHash, shippingComplete }: PurchaseSuccessProps) {
  const titleId = useId();
  const explorerUrl = getExplorerTxUrl(txHash);

  return (
    <section className={styles.success} aria-labelledby={titleId}>
      <div className={styles.heading} role="status">
        <span className={styles.successIcon}><CheckCircle2 size={22} strokeWidth={1.8} aria-hidden="true" /></span>
        <div><span className={styles.eyebrow}>认购已登记</span><h3 id={titleId}>认购成功，一起开启下一程</h3></div>
      </div>
      <p className={styles.description}>本次 <strong>{shares} 份</strong>认购已入账，CaBi 配额可到代币中心查看。{shippingComplete ? "蟹礼收货信息已保存。" : "蟹礼收货信息待补填。"}</p>
      <dl className={styles.summary}>
        <div><dt>本次支付</dt><dd>{paid}<span>USDT</span></dd></div>
        <div><dt>本次获得配额</dt><dd>{allocation}<span>CaBi</span></dd></div>
      </dl>
      <p className={styles.note}>{shippingComplete ? "后台将按收货信息安排蟹礼发货。" : "请在下方认购记录补填收货信息，以便安排蟹礼发货。"}领取 CaBi 前需另付 USDT 组 LP，完成后领取 70% CaBi。</p>
      <div className={styles.nextSteps}>
        {!shippingComplete ? <a href="#subscription-records" className={`${styles.viewAllocation} ${styles.shippingLink}`}>填写收货信息</a> : null}
        <Link href="/dapp/token#allocation" className={styles.viewAllocation}>查看配额</Link>
        <Link href="/dapp/token#claim-center" className={styles.claimTokens}>前往领取<ArrowRight size={15} aria-hidden="true" /></Link>
      </div>
      {explorerUrl ? <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className={styles.transaction}>查看链上交易 <span>{txHash.slice(0, 8)}…{txHash.slice(-6)}</span><ExternalLink size={12} aria-hidden="true" /><span className={styles.srOnly}>（在新窗口打开）</span></a> : null}
    </section>
  );
}
