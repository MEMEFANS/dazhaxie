"use client";
import type { PromotionStats } from "@/lib/subscribe-data";
import { fmt2 } from "@/lib/constants";
import { Card, Metric, SectionHead } from "@/components/dapp/ui";

export function TeamStats({ stats }: { stats?: PromotionStats }) {
  const items = [
    { label: "直推人数", value: stats ? String(stats.directCount) : "—", unit: "人" },
    { label: "团队人数", value: stats ? String(stats.teamCount) : "—", unit: "人" },
    { label: "个人认购", value: stats ? fmt2(stats.purchased) : "—", unit: "份" },
  ];
  return <Card className="p-4 sm:p-6">
    <SectionHead eyebrow="TEAM OVERVIEW" title="团队数据" desc="来自已确认的邀请关系与认购记录" />
    <div className="mt-5 grid grid-cols-3 divide-x divide-line rounded-2xl border border-line bg-well/70 py-4">{items.map(item=><div key={item.label} className="px-2 text-center sm:px-4"><p className="text-[10px] leading-4 text-mute sm:text-xs">{item.label}</p><p className="num mt-2 text-xl font-semibold text-strong sm:text-2xl">{item.value}<span className="ml-1 text-[10px] font-normal text-faint">{item.unit}</span></p></div>)}</div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl border border-line bg-card p-4"><Metric label="直推业绩" value={stats ? fmt2(stats.directShares) : "—"} unit="份" hint="直接邀请成员的认购份数" /></div>
      <div className="rounded-2xl border border-[#ead8ae] bg-[#fff9ed] p-4"><Metric label="团队业绩" value={stats ? fmt2(stats.teamShares) : "—"} unit="份" hint="所有下级累计认购份数" tone="gold" /></div>
    </div>
    <div className="mt-4 flex items-center justify-between rounded-xl bg-plum/[0.045] px-4 py-3"><span className="text-[11px] text-mute">累计奖励</span><span className="num text-sm font-semibold text-plum">{stats ? fmt2(stats.directRewardShares + stats.differentialShares) : "—"}<span className="ml-1 text-[10px] font-normal text-faint">份</span></span></div>
  </Card>;
}
