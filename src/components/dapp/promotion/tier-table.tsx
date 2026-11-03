"use client";

// 团队业绩梯度奖励（层级差额 differential）：全部由服务器认购单与邀请关系树派生。
import type { PromotionBranch, PromotionStats } from "@/lib/subscribe-data";
import { TEAM_TIERS, fmt, fmt2, teamTierIndex, teamTierLabel } from "@/lib/constants";
import { Card, Metric, SectionHead, StatusPill } from "@/components/dapp/ui";

export function TierTable({ stats, branches }: { stats?: PromotionStats; branches: PromotionBranch[] }) {
  const teamShares = stats?.teamShares ?? 0;
  const tierIdx = stats ? teamTierIndex(teamShares) : -1;
  const nextTier = tierIdx >= 0 && tierIdx < TEAM_TIERS.length - 1 ? TEAM_TIERS[tierIdx + 1] : null;

  function tierState(i: number) {
    if (!stats) return <span className="text-[11px] text-faint">待登录</span>;
    if (i === tierIdx) return <span className="text-[11px] font-medium text-gold">当前档位</span>;
    if (teamShares >= TEAM_TIERS[i].threshold) return <span className="text-[11px] text-mute">已达成</span>;
    return <span className="text-[11px] text-faint">未达成</span>;
  }

  return <Card className="p-5 sm:p-6">
    <SectionHead eyebrow="TEAM TIERS" title="团队业绩梯度奖励" desc="团队业绩包含所有下级认购；直接下级本人按本档计奖，其团队按档位正差额计奖" right={<StatusPill tone={stats ? "live" : "soon"}>{stats ? "自动记账" : "等待登录"}</StatusPill>} />
    <div className="mt-5 hidden overflow-x-auto sm:block"><table className="w-full text-[12px]"><thead><tr className="border-b border-line"><th className="kicker py-2 pl-3 pr-4 text-left">团队累计</th><th className="kicker py-2 px-4 text-right">梯度比例</th><th className="kicker py-2 pl-4 text-right">状态</th></tr></thead><tbody className="divide-y divide-line">{TEAM_TIERS.map((tier, i) => <tr key={tier.threshold} className={i === tierIdx ? "bg-gold/[0.06]" : ""}><td className={`num border-l-2 py-2.5 pl-3 pr-4 text-[12px] text-strong ${i === tierIdx ? "border-l-gold" : "border-l-transparent"}`}>{fmt(tier.threshold)} 份</td><td className={`num py-2.5 px-4 text-right text-[12px] ${i === tierIdx ? "text-gold" : "text-mute"}`}>{tier.label}</td><td className="py-2.5 pl-4 text-right">{tierState(i)}</td></tr>)}</tbody></table></div>
    <div className="mt-5 divide-y divide-line rounded-lg border border-line bg-well/50 px-3 sm:hidden"><div className="flex items-center justify-between py-2"><span className="kicker">团队累计</span><span className="kicker">比例 / 状态</span></div>{TEAM_TIERS.map((tier, i) => <div key={tier.threshold} className={`flex items-center justify-between gap-3 py-2.5 ${i === tierIdx ? "bg-gold/[0.06]" : ""}`}><span className={`num text-[12px] ${i === tierIdx ? "text-gold" : "text-strong"}`}>{fmt(tier.threshold)} 份</span><span className="flex items-center gap-3"><span className={`num text-[12px] ${i === tierIdx ? "text-gold" : "text-mute"}`}>{tier.label}</span>{tierState(i)}</span></div>)}</div>
    <div className="mt-5 border-t border-line pt-4"><div className="flex items-center justify-between gap-3"><p className="kicker">分支奖励明细</p><span className="text-[10px] leading-4 text-faint">我的档位 {stats ? teamTierLabel(teamShares) : "—"} · 同档仅团队差额为 0</span></div>
      {!stats ? <p className="mt-3 rounded-lg border border-dashed border-line px-4 py-5 text-center text-[11px] text-faint">登录后可查看直推分支与极差奖励</p> : branches.length === 0 ? <p className="mt-3 rounded-lg border border-dashed border-line px-4 py-5 text-center text-[11px] text-faint">暂无直接下级</p> : <div className="mt-3 divide-y divide-line rounded-lg border border-line bg-well px-4">{branches.map(branch => <div key={branch.address} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><p className="truncate text-[12px] font-medium leading-5 text-strong">{branch.name}</p><p className="num text-[10px] leading-4 text-faint">本人认购 {fmt2(branch.selfShares)} 份 · 下级团队 {fmt2(branch.teamShares)} 份 · {branch.tierLabel}</p></div><div className="shrink-0 text-right"><p className={`num text-[12px] font-medium leading-5 ${branch.reward > 0 ? "text-gold" : "text-faint"}`}>+{fmt2(branch.reward)} 份</p><p className="num text-[10px] leading-4 text-faint">本人奖励 {fmt2(branch.selfReward)} 份 · 团队差额 {(branch.diffRate * 100).toFixed(0)}%</p></div></div>)}</div>}
    </div>
    <div className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-3"><Metric label="当前梯度" value={stats && tierIdx >= 0 ? TEAM_TIERS[tierIdx].label : "—"} /><div className="sm:border-l sm:border-line sm:pl-4"><Metric label="直推奖励份数" value={stats ? fmt2(stats.directRewardShares) : "—"} unit="份" /></div><div className="sm:border-l sm:border-line sm:pl-4"><Metric label="团队极差份数" value={stats ? fmt2(stats.differentialShares) : "—"} unit="份" tone="gold" hint="逐人汇总后向下取整" /></div></div>
    <p className="mt-3 text-[10px] leading-4 text-faint">「份」为离散单位，每人先汇总全部分支后再向下取整。直推每满 3 份的奖励另计；团队极差与直推奖励均随认购单自动聚合，生成批次后写入独立领取池。</p>
    {stats && nextTier ? <p className="mt-3 text-[10px] leading-4 text-faint">距下一档位 {fmt(nextTier.threshold)} 份（{nextTier.label}）还需 {fmt(Math.max(0, nextTier.threshold - teamShares))} 份</p> : stats && tierIdx >= 0 ? <p className="mt-3 text-[10px] leading-4 text-faint">已达最高档位 5%，直接下级本人按 5% 计奖，其团队继续按正档位差结算</p> : null}
  </Card>;
}
