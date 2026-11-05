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
      <div className={styles.claimNote}><div><span>认购后可在代币中心领取</span><Link href="/dapp/token">前往领取 <ArrowUpRight size={13} /></Link></div><p><strong>70%</strong> 到账，30% CaBi 与对应 USDT 转入 LP 地址</p></div>
      <details className={styles.rules}><summary>认购规则 <ChevronDown size={16} /></summary><ul><li>{data ? `每份 ${data.unitPrice.toLocaleString("en-US")} USDT，对应 ${data.tokensPerShare.toLocaleString("en-US")} CaBi 配额。` : "认购价格与配额以实际配置为准。"}</li><li>{data ? `每个钱包限购 ${data.maxShares} 份，总量 ${data.hardCap.toLocaleString("en-US")} 份，售完即止。` : "配置未就绪时无法提交认购。"}</li><li>使用 BSC 网络 USDT 支付，到账后自动登记。</li><li>推荐关系绑定后不可更改，请确认后再参与。</li></ul></details>
      <Link href="/dapp/support" className={styles.support}><Headphones size={16} /><span>认购遇到问题？<strong>联系支持</strong></span><ArrowUpRight size={15} /></Link>
    </aside>
  );
}
