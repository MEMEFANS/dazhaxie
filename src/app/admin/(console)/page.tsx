"use client";

// 后台仪表盘：核心数据概览与本地存档管理。

import { useEffect, useState } from "react";
import { formatEther, isAddress, parseEther } from "viem";
import { useStore } from "@/lib/store";
import { fmt, SOFT_CAP } from "@/lib/constants";
import { serviceClient, useClaimPoolData } from "@/lib/claim-pool-data";
import { useSubscribeConfig } from "@/lib/subscribe-data";
import { useRedemptionConfig } from "@/lib/redemption-client";
import { formatAssetAmount } from "@/lib/amounts";
import { Card, LoadingBlock, PageHeader, PageStack, StatCard } from "@/components/dapp/ui";
import NoticeCard from "@/components/admin/notice-card";
import ResetCard from "@/components/admin/reset-card";

const keeperAddress = process.env.NEXT_PUBLIC_KEEPER_ADDRESS?.trim() || "";
const keeperThreshold = (() => { const value = Number(process.env.NEXT_PUBLIC_KEEPER_MIN_BNB || "0.01"); return Number.isFinite(value) && value > 0 ? value : 0.01; })();

interface KeeperState { status: "unconfigured" | "loading" | "ready" | "error"; balance?: bigint }

export default function AdminDashboardPage() {
  const { hydrated } = useStore();
  const subscribe = useSubscribeConfig();
  const reward = useClaimPoolData();
  const redemption = useRedemptionConfig();
  const [pendingTickets, setPendingTickets] = useState<number | null>(null);
  const [keeper, setKeeper] = useState<KeeperState>(() => isAddress(keeperAddress, { strict: false }) ? { status: "loading" } : { status: "unconfigured" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/tickets?status=pending&pageSize=1", { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(body => { if (!cancelled && body && typeof body.total === "number") setPendingTickets(body.total); })
      .catch(() => { /* 仪表盘统计失败时保持占位，不阻塞其他数据 */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isAddress(keeperAddress, { strict: false })) return;
    let cancelled = false;
    serviceClient.getBalance({ address: keeperAddress as `0x${string}` })
      .then(balance => { if (!cancelled) setKeeper({ status: "ready", balance }); })
      .catch(() => { if (!cancelled) setKeeper({ status: "error" }); });
    return () => { cancelled = true; };
  }, []);

  if (!hydrated) return <LoadingBlock />;

  const sold = subscribe.data?.globalSold ?? 0;
  const hardCap = subscribe.data?.hardCap ?? 0;
  const hardPercent = hardCap > 0 ? sold * 100 / hardCap : 0;
  const remaining = Math.max(0, hardCap - sold);
  const softReached = sold >= SOFT_CAP;
  const softRemaining = Math.max(SOFT_CAP - sold, 0);
  const outstanding = reward.data?.allocatedUnclaimed ?? 0n;
  const poolShort = Boolean(reward.data && reward.data.poolBalance < outstanding);
  const keeperLow = keeper.status === "ready" && keeper.balance !== undefined && keeper.balance < parseEther(String(keeperThreshold));

  return (
    <PageStack>
      <PageHeader eyebrow="DASHBOARD" title="仪表盘" desc="核心运营数据一览" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="全局已认购" value={subscribe.data ? subscribe.data.globalSold.toLocaleString("en-US") : "—"} unit="份" hint={subscribe.data ? `硬顶 ${subscribe.data.hardCap.toLocaleString("en-US")} 份 · 服务器记账` : subscribe.error || "等待认购配置"} />
        <StatCard label="实物兑换" value={redemption.data?.configured ? (redemption.data.enabled ? "开放" : "停用") : "—"} hint={redemption.error || "订单与发货在「兑换管理」查看"} />
        <StatCard label="领取池余额" value={reward.data ? formatAssetAmount(reward.data.poolBalance,reward.data.tokenDecimals) : "—"} unit="CaBi" hint={reward.error || "服务器签名授权 · 强制 30% USDT 组 LP / 70% 到账"} />
        <StatCard label="待处理工单" value={pendingTickets === null ? "—" : fmt(pendingTickets)} unit="条" hint={pendingTickets === null ? "正在读取工单统计" : "在「工单处理」回复或完结"} />
      </div>

      <Card>
        <h2 className="text-base font-semibold">运营预警</h2>
        <p className="mt-1 text-xs leading-5 text-faint">只显示链上或服务端真实读到的数据；读不到时明确标注未配置，不做推测。</p>
        <div className="mt-4 space-y-3 text-[12px] leading-5">
          <div>
            {!subscribe.data ? <p className="text-faint">硬顶进度：{subscribe.status === "error" ? subscribe.error || "服务端读取失败" : "等待认购配置"}</p>
              : <p className={hardPercent >= 95 ? "text-down" : hardPercent >= 80 ? "text-warn" : "text-mute"}>硬顶进度：{hardPercent.toFixed(1)}% · 已认购 {fmt(sold)} / {fmt(hardCap)} 份 · 剩余 {fmt(remaining)} 份{hardPercent >= 95 ? " · 已接近硬顶" : hardPercent >= 80 ? " · 接近硬顶" : ""}</p>}
            {subscribe.data ? <p className={softReached ? "text-warn" : "text-mute"}>软顶（项目常量）：{fmt(SOFT_CAP)} 份 · {softReached ? `已越过软顶 ${fmt(sold - SOFT_CAP)} 份` : `还差 ${fmt(softRemaining)} 份`}</p> : <p className="text-faint">软顶：等待认购配置（常量 SOFT_CAP，见 src/lib/constants.ts）</p>}
          </div>
          <div>
            {!reward.data ? <p className="text-faint">领取池：{reward.status === "unconfigured" ? "未配置领取池" : reward.error || "链上读取失败"}</p>
              : <p className={poolShort ? "text-down" : "text-mute"}>领取池余额 {formatAssetAmount(reward.data.poolBalance, reward.data.tokenDecimals)} CaBi · 已分配未领取 {formatAssetAmount(outstanding, reward.data.tokenDecimals)} CaBi{poolShort ? " · 池内余额不足以覆盖待领，请尽快注资" : " · 覆盖充足"}</p>}
          </div>
          <div>
            {keeper.status === "unconfigured" ? <p className="text-faint">keeper 钱包：未配置（设置 NEXT_PUBLIC_KEEPER_ADDRESS 后才会显示 BNB 余额）</p>
              : keeper.status === "loading" ? <p className="text-faint">keeper 钱包：正在读取 BNB 余额…</p>
              : keeper.status === "error" ? <p className="text-faint">keeper 钱包：已配置地址，但 BNB 余额读取失败</p>
              : <p className={keeperLow ? "text-down" : "text-mute"}>keeper 钱包 BNB 余额 {Number(formatEther(keeper.balance ?? 0n)).toFixed(4)} BNB{keeperLow ? ` · 低于阈值 ${keeperThreshold} BNB，定时销毁可能因手续费不足失败` : ` · 阈值 ${keeperThreshold} BNB`}</p>}
          </div>
        </div>
      </Card>

      <NoticeCard />

      <ResetCard />
    </PageStack>
  );
}
