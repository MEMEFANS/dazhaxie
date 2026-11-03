"use client";
import { UserPlus } from "lucide-react";
import type { PromotionBranch, PromotionStats } from "@/lib/subscribe-data";
import { fmt2, shortAddr } from "@/lib/constants";
import { Card, SectionHead, StatCard } from "@/components/dapp/ui";

export function TeamMembers({ stats, branches, connected }: { stats?: PromotionStats; branches: PromotionBranch[]; connected: boolean }) {
  return <Card className="p-5 sm:p-6">
    <SectionHead eyebrow="YOUR CRAB FRIENDS" title="团队成员" desc={stats ? `共 ${stats.directCount} 位直推成员` : connected ? "读取团队数据中" : "连接钱包后查看"} />
    {stats && branches.length > 0 ? <div className="mb-4 grid grid-cols-2 gap-3"><StatCard label="个人业绩" value={fmt2(stats.purchased)} unit="份"/><StatCard label="团队业绩" value={fmt2(stats.teamShares)} unit="份"/></div> : null}
    {!connected ? <p className="mt-4 rounded-lg border border-dashed border-line px-4 py-5 text-center text-xs text-faint">连接钱包并登录后查看团队成员</p>
      : !stats ? <p role="status" className="mt-4 rounded-lg border border-dashed border-line px-4 py-5 text-center text-xs text-faint">正在读取真实的团队与认购数据…</p>
      : branches.length === 0 ? <div className="mt-4 rounded-lg border border-dashed border-line px-4 py-8 text-center"><UserPlus size={20} className="mx-auto text-faint" /><p className="mt-2 text-xs text-faint">暂无团队成员，分享邀请链接组建你的团队</p></div>
      : <div className="mt-4 space-y-3">{branches.map((member,index) => <article key={member.address} className="rounded-2xl border border-line bg-well/45 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-sm font-semibold ${index===0?"bg-[#fff0cf] text-[#9e6713]":"bg-plum/10 text-plum"}`}>{String(index+1).padStart(2,"0")}</span>
              <div className="min-w-0"><p className="text-[10px] text-faint">直推蟹友</p><p className="mt-1 truncate font-mono text-xs font-semibold text-strong">{shortAddr(member.address)}</p></div>
            </div>
            <div className="shrink-0 text-right"><p className="text-[10px] text-faint">贡献奖励</p><p className={`num mt-1 text-xs font-semibold ${member.reward>0?"text-gold":"text-mute"}`}>+{fmt2(member.reward)} 份</p></div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3">
            <div><p className="text-[10px] text-faint">个人业绩</p><p className="num mt-1 text-sm font-semibold text-strong">{fmt2(member.selfShares)}<span className="ml-1 text-[10px] font-normal text-faint">份</span></p></div>
            <div className="border-l border-line pl-3"><p className="text-[10px] text-faint">下级团队业绩</p><p className="num mt-1 text-sm font-semibold text-strong">{fmt2(member.teamShares)}<span className="ml-1 text-[10px] font-normal text-faint">份</span></p></div>
          </div>
        </article>)}</div>}
  </Card>;
}
