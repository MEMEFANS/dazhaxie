"use client";

import Link from "next/link";
import { ArrowUpRight, BookOpen, ChevronDown, Coins, Headphones, Wallet } from "lucide-react";
import { useSubscribeConfig } from "@/lib/subscribe-data";
import styles from "./subscribe.module.css";

export function ProgressCard() {
  const { data } = useSubscribeConfig();
  const steps = [
    { title: "连接钱包", text: "使用 BSC 网络，完成邀请码绑定。", icon: Wallet },
    { title: "选择份额并支付", text: "核对金额后，在钱包中确认 USDT 转账。", icon: Coins },
    { title: "查看配额与领取", text: "认购登记完成后，前往代币中心查看。", icon: BookOpen },
  ];

  return (
    <aside className={styles.guide} aria-labelledby="subscribe-guide-title">
      <div className={styles.guideTitle}><span>HOW IT WORKS</span><h2 id="subscribe-guide-title">三步，开启你的份额</h2><p>从参与到领取，每一步都清楚。</p></div>
      <ol className={styles.steps}>{steps.map(({ title, text, icon: Icon }, index) => <li key={title}><span className={styles.stepNumber}>{String(index + 1).padStart(2, "0")}</span><div><h3>{title}<Icon size={15} /></h3><p>{text}</p></div></li>)}</ol>
      <div className={styles.claimNote}><div><span>领取方式 · 强制组 LP</span><Link href="/dapp/token">代币中心 <ArrowUpRight size={13} /></Link></div><p>支付 30% USDT 组建流动性，<strong>70%</strong> 到账</p><small>另 30% CaBi 与这笔 USDT 一并进入项目 LP 地址，未配置 LP 地址时不可领取。</small></div>
      <details className={styles.rules}><summary>认购规则与说明 <ChevronDown size={16} /></summary><ul><li>{data ? `每份 ${data.unitPrice.toLocaleString("en-US")} USDT，对应 ${data.tokensPerShare.toLocaleString("en-US")} CaBi 配额。` : "认购价格与配额以实际配置为准。"}</li><li>{data ? `每个钱包限购 ${data.maxShares} 份，总量 ${data.hardCap.toLocaleString("en-US")} 份，售完即止。` : "配置未就绪时无法提交认购。"}</li><li>仅支持 BSC 网络 USDT 支付，转账确认并登记后完成认购。</li><li>推荐关系绑定后不可更改，请在参与前核对。</li><li>认购获得的是 CaBi 配额，实际到账数量取决于领取方式。</li></ul></details>
      <Link href="/dapp/support" className={styles.support}><Headphones size={16} /><span>认购遇到问题？<strong>联系支持</strong></span><ArrowUpRight size={15} /></Link>
    </aside>
  );
}
