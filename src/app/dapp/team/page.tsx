"use client";
import { useStore } from "@/lib/store";
import { usePromotionStats } from "@/lib/subscribe-data";
import { LoadingBlock, PageStack } from "@/components/dapp/ui";
import { TeamHero } from "@/components/dapp/team/team-hero";
import { TeamStats } from "@/components/dapp/team/team-stats";
import { TeamMembers } from "@/components/dapp/team/team-members";
import { TierTable } from "@/components/dapp/promotion/tier-table";
import { RewardRecords } from "@/components/dapp/promotion/reward-records";

export default function TeamPage() {
  const { hydrated, state } = useStore();
  const { stats, branches, error } = usePromotionStats(state.connected);
  if (!hydrated) return <LoadingBlock />;
  return <PageStack><TeamHero stats={stats} />{error && state.connected ? <p role="status" className="rounded-xl border border-line bg-card px-4 py-3 text-xs text-mute">{error}；已绑定的钱包可稍后刷新。</p> : null}<div className="grid items-start gap-5 xl:grid-cols-[0.88fr_1.12fr]"><TeamStats stats={stats} /><TeamMembers stats={stats} branches={branches} connected={state.connected} /></div><TierTable stats={stats} branches={branches} /><RewardRecords /></PageStack>;
}
