"use client";

import Link from "next/link";
import { ArrowUpRight, RefreshCw, Sparkles, Wallet } from "lucide-react";
import { formatUnits } from "viem";
import { useStore } from "@/lib/store";
import { shortAddr } from "@/lib/constants";
import { chainConfig } from "@/lib/chain-config";
import { useTokenData } from "@/lib/chain-data";
import { useSubscribeConfig, usePromotionStats } from "@/lib/subscribe-data";
import { useClaimPoolData } from "@/lib/claim-pool-data";
import { useRedemptionConfig } from "@/lib/redemption-client";
import { formatAssetAmount } from "@/lib/amounts";
import { TierProgress } from "@/components/dapp/subscribe/tier-progress";
import styles from "./landing.module.css";

export function OverviewStatus() {
  const { state, hydrated, connect } = useStore();
  const connected = hydrated && state.connected;
  const correctNetwork = connected && state.chainId === chainConfig.id;
  const account = correctNetwork ? state.address : undefined;
  const token = useTokenData(account);
  const subscribeQuery = useSubscribeConfig(account);
  const promotion = usePromotionStats(correctNetwork);
  const rewardQuery = useClaimPoolData(account);
  const redemption = useRedemptionConfig();
  const config = subscribeQuery.data, stats = promotion.stats, reward = rewardQuery.data;
  const hardCap = config?.hardCap ?? 0, sold = config?.globalSold ?? 0;
  const progress = hardCap > 0 ? Math.min(100, sold * 100 / hardCap) : 0;
  const subscriptionClosed = Boolean(config && (!config.enabled || config.remainingGlobal <= 0));
  const accountMetrics = [
    { label: "我的份额", display: stats ? (stats.purchased + stats.directRewardShares + stats.differentialShares).toLocaleString("en-US") : "—", unit: "份", href: "/subscribe" },
    { label: "可用 CaBi", display: correctNetwork && token.data?.balance !== undefined ? formatAssetAmount(token.data.balance, token.data.decimals) : "—", exact: token.data?.balance !== undefined ? formatUnits(token.data.balance, token.data.decimals) : undefined, unit: "枚", href: "/token" },
    { label: "待领 CaBi", display: correctNetwork && reward?.server.claimable !== undefined ? formatAssetAmount(reward.server.claimable, reward.tokenDecimals) : "—", unit: "枚", href: "/token" },
  ];
  const accountNote = !connected ? "连接钱包，查看当前网络下的个人资产。"
    : !correctNetwork ? `请先在顶部切换至 ${chainConfig.shortName}。`
      : token.status === "error" ? token.error || "余额查询失败，请重试。"
        : token.status === "loading" ? "正在从链上查询 CaBi 余额…"
          : token.status === "ready" ? "余额读取链上；认购份额、直推与团队业绩由服务器认购单聚合。" : "正式代币地址待配置，个人资产暂不可查询。";
  const stateLabel = (status: string) => ({ ready: "已接入", error: "查询失败", loading: "查询中", unconfigured: "待配置" }[status] || "待配置");
  return <section className={styles.statusGrid} aria-label="账户与生态概况">
    <div className={styles.statusCard}>
      <div className={styles.statusHeading}><h2><Wallet size={16} /> 我的参与</h2>{connected ? <span className={styles.accountAddress}>{shortAddr(state.address)}</span> : <button onClick={connect}>连接钱包 <ArrowUpRight size={12} /></button>}</div>
      <div className={styles.accountMetrics}>{accountMetrics.map(metric => <Link href={metric.href} key={metric.label}><small>{metric.label}</small><strong title={"exact" in metric ? metric.exact : metric.display}>{metric.display}<span>{metric.unit}</span></strong></Link>)}</div>
      <p className={styles.statusNote}>{accountNote}</p>
      {correctNetwork ? <button onClick={() => { token.refresh(); subscribeQuery.refresh(); promotion.refresh(); rewardQuery.refresh(); }} className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-xs text-mute"><RefreshCw size={13} />刷新数据</button> : null}
      {subscribeQuery.error || promotion.error || rewardQuery.error ? <p className="mt-2 text-xs leading-6 text-down" role="alert">{subscribeQuery.error || promotion.error || rewardQuery.error}</p> : null}
    </div>
    <div className={styles.statusCard}>
      <div className={styles.statusHeading}><h2><Sparkles size={16} /> 认购进度</h2><span className={styles.demoBadge}>{stateLabel(subscribeQuery.status)}</span></div>
      <div className={styles.progressSummary}><strong>{config ? sold.toLocaleString("en-US") : "—"}<small> / {hardCap ? hardCap.toLocaleString("en-US") : "—"} 份</small></strong><span>{config ? progress.toFixed(1) + "%" : "—"}</span></div>
      <TierProgress sold={config?.globalSold} tiers={config?.priceTiers} />
      <div className={styles.progressFooter}><span>{config ? subscriptionClosed ? "认购已关闭" : `剩余 ${config.remainingGlobal.toLocaleString("en-US")} 份` : "等待服务器记账数据"}</span><Link href="/subscribe">查看详情 <ArrowUpRight size={12} /></Link></div>
      <p className={styles.statusNote}>转账认购：{stateLabel(subscribeQuery.status)} · 领取池：{stateLabel(rewardQuery.status)} · 蟹礼：{redemption.data?.configured ? redemption.data.enabled ? "开放中" : "暂停" : stateLabel(redemption.status)}</p>
    </div>
  </section>;
}
