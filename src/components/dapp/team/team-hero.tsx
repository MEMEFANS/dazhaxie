"use client";
import Image from "next/image";
import { Check, Copy, Link2, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { useReferralData } from "@/lib/referral-data";
import type { PromotionStats } from "@/lib/subscribe-data";
import { TEAM_TIERS, fmt, teamTierIndex } from "@/lib/constants";
import { Card } from "@/components/dapp/ui";

export function TeamHero({ stats }: { stats?: PromotionStats }) {
  const { state, hydrated, showToast } = useStore();
  const referral = useReferralData(state.connected ? state.address : undefined);
  const [copied, setCopied] = useState(false);
  const canShare = hydrated && state.connected && referral.status === "ready" && Boolean(referral.data?.bound);
  const code = canShare ? referral.data!.code : "";
  const link = canShare && typeof window !== "undefined" ? window.location.origin + "/dapp/subscribe?ref=" + encodeURIComponent(code) : "";
  const teamShares = stats?.teamShares ?? 0;
  const tierIdx = teamTierIndex(teamShares);
  const nextTier = tierIdx < TEAM_TIERS.length - 1 ? TEAM_TIERS[tierIdx + 1] : null;
  const progress = nextTier ? Math.min(100, Math.round((teamShares / nextTier.threshold) * 100)) : 100;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyLink() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); showToast("邀请链接已复制"); }
    catch { showToast("复制失败，请长按手动复制"); }
  }

  return <div className="space-y-4">
    <section aria-labelledby="team-title" className="relative isolate overflow-hidden rounded-[26px] border border-[#422e52] bg-[#211528] text-white shadow-pop">
      <div className="absolute inset-y-0 right-0 w-full md:w-[56%]">
        <Image src="/images/xiebit-invite-v4.webp" alt="" fill sizes="(max-width: 720px) 100vw, 620px" className="object-cover object-center" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-r from-[#211528] via-[#211528]/95 to-[#211528]/25 md:to-transparent" />
      <div className="relative grid gap-7 p-5 sm:p-7 md:grid-cols-[1fr_250px] md:items-center md:p-8">
        <div className="max-w-xl">
          <p className="text-[10px] font-semibold tracking-[0.3em] text-[#f3c76d]">MY CRAB CREW · XIE BIT CLUB</p>
          <h1 id="team-title" className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">我的蟹友团</h1>
          <p className="mt-3 max-w-md text-xs leading-6 text-white/75 sm:text-sm">喊上蟹友一起加入，团队认购与奖励进度在这里一眼掌握。</p>
          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5"><UsersRound size={13} className="text-[#f3c76d]" />团队档位 <strong className="text-[#f3c76d]">{stats && tierIdx >= 0 ? TEAM_TIERS[tierIdx].label : stats ? "成长中" : "—"}</strong></span>
            <span className="text-white/65">{nextTier ? `再累计 ${fmt(Math.max(0, nextTier.threshold - teamShares))} 份，冲击 ${nextTier.label}` : stats ? "已达最高团队档位" : "登录后查看团队进度"}</span>
          </div>
          <div className="mt-3 h-1.5 max-w-sm overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-[#f3c76d] transition-all duration-500" style={{ width: stats ? progress + "%" : "0%" }} /></div>
        </div>
        <div className="rounded-2xl border border-white/15 bg-[#291b32]/80 p-4 backdrop-blur-sm md:justify-self-end md:w-full">
          <p className="text-[10px] tracking-[0.2em] text-white/60">TEAM PERFORMANCE</p>
          <p className="num mt-2 text-3xl font-bold">{stats ? fmt(teamShares) : "—"}<span className="ml-1.5 text-xs font-medium text-white/65">份</span></p>
          <p className="mt-1 text-[11px] text-white/65">团队累计认购</p>
          <p className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-[11px] text-white/70"><span>下一级门槛</span><strong className="num text-white">{nextTier ? `${fmt(nextTier.threshold)} 份` : stats ? "最高档" : "—"}</strong></p>
        </div>
      </div>
    </section>

    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-plum/10 text-plum"><Link2 size={18} /></span>
          <div className="min-w-0"><p className="text-sm font-semibold text-strong">专属邀请链接</p><p className="mt-1 text-[11px] text-faint">分享给好友，加入你的蟹友团</p></div>
        </div>
        <button type="button" onClick={() => void copyLink()} disabled={!link} className="btn btn-gold min-h-10 w-full px-4 text-xs sm:w-auto">{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "已复制" : "复制邀请链接"}</button>
      </div>
      <div className="mt-4 flex flex-col gap-2 rounded-xl border border-line bg-well p-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1"><p className="text-[10px] text-faint">我的邀请码 <span className="ml-2 font-mono font-semibold tracking-[0.2em] text-plum">{code || (referral.binding?.bound ? "签名登录后查看" : "登录并绑定后生成")}</span></p><p className="mt-1 truncate font-mono text-[11px] text-mute">{link || (referral.binding?.bound ? "邀请关系已绑定，签名登录后查看专属链接" : "连接钱包并完成邀请绑定后获取专属链接")}</p></div>
      </div>
    </Card>
  </div>;
}
