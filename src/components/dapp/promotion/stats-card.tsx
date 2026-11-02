"use client";
import { useStore } from "@/lib/store";
import { usePromotionStats } from "@/lib/subscribe-data";
import { Card, Metric, SectionHead } from "@/components/dapp/ui";
export function StatsCard() {
  const { state } = useStore();
  const { stats } = usePromotionStats(state.connected);
  const items = [
    { label: "个人认购份数", value: stats ? String(stats.purchased) : "—", unit: "份" },
    { label: "直推奖励份数", value: stats ? String(stats.directRewardShares) : "—", unit: "份" },
    { label: "直推认购份数", value: stats ? String(stats.directShares) : "—", unit: "份" },
    { label: "直推人数", value: stats ? String(stats.directCount) : "—", unit: "人" },
    { label: "团队人数 / 业绩", value: stats ? stats.teamCount + " 人 / " + stats.teamShares + " 份" : "—", unit: "" },
  ];
  return <Card className="p-5 sm:p-6"><SectionHead eyebrow="PROMOTION DATA" title="服务器推广数据" /><div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5">{items.map(item => <Metric key={item.label} {...item} />)}</div><p className="mt-4 text-xs leading-6 text-faint">以上数据由认购单与邀请关系树实时聚合：直推每满 3 份计 1 份奖励，团队极差逐人向下取整。未登录时显示 —，不显示为 0。</p></Card>;
}
