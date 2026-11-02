"use client";

// 我的工单列表：服务端记录 + 状态筛选 + 展开详情 + 客服回复

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, FileText, Headphones, Loader2, LogIn, ShieldCheck } from "lucide-react";
import { useStore } from "@/lib/store";
import { timeAgo } from "@/lib/constants";
import { communityRequest, signInCommunity, TICKET_STATUS_LABEL, type TicketView } from "@/lib/community-client";
import { EmptyRow, SectionTitle, StatusPill } from "@/components/dapp/ui";
import { StatusFilter, type FilterKey } from "./category-picker";

export function TicketList({ filter, onFilterChange }: { filter: FilterKey; onFilterChange: (filter: FilterKey) => void }) {
  const { state, showToast } = useStore();
  const [tickets, setTickets] = useState<TicketView[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [needSignIn, setNeedSignIn] = useState(false);
  const [signing, setSigning] = useState(false);

  const load = useCallback(async () => {
    if (!state.connected) { setTickets([]); setLoading(false); setNeedSignIn(false); return; }
    try {
      const body = await communityRequest<{ tickets: TicketView[] }>("/api/tickets");
      setTickets(body.tickets);
      setNeedSignIn(false);
    } catch (e) {
      if (e instanceof Error && e.message.includes("登录")) setNeedSignIn(true);
      else showToast(e instanceof Error ? e.message : "工单加载失败");
    } finally { setLoading(false); }
  }, [state.connected, showToast]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    window.addEventListener("cabi-ticket-updated", load);
    return () => { window.clearTimeout(initial); window.removeEventListener("cabi-ticket-updated", load); };
  }, [load]);

  async function signIn() {
    if (!state.address || signing) return;
    setSigning(true);
    try { await signInCommunity(state.address); await load(); }
    catch (e) { showToast(e instanceof Error ? e.message : "登录失败"); }
    finally { setSigning(false); }
  }

  const visible = tickets.filter(t => (filter === "all" ? true : t.status === filter));
  const emptyText = !state.connected ? "连接钱包后查看自己的工单"
    : needSignIn ? "登录后查看自己的工单"
      : tickets.length === 0 ? "暂无工单 · 提交问题后将在此显示处理进度" : "当前筛选条件下暂无工单";

  return (
    <section className="card p-5 sm:p-6">
      <SectionTitle icon={FileText} title="我的工单" extra={<StatusFilter value={filter} onChange={onFilterChange} />} />

      {needSignIn ? (
        <div className="mb-3 flex flex-col gap-3 rounded-lg border border-gold/25 bg-gold/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-[12px] leading-5 text-mute"><ShieldCheck size={13} className="shrink-0 text-gold" /> 一键登录即可，无需钱包签名</p>
          <button onClick={() => void signIn()} disabled={signing} className="btn btn-gold h-9 shrink-0 px-4 text-[12px]">{signing ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />} {signing ? "登录中…" : "登录"}</button>
        </div>
      ) : null}

      {loading ? <EmptyRow text="正在同步工单…" /> : visible.length === 0 ? <EmptyRow text={emptyText} /> : (
        <div className="divide-y divide-line border-t border-line">
          {visible.map(t => {
            const open = expanded === t.id;
            return (
              <div key={t.id}>
                <button onClick={() => setExpanded(open ? null : t.id)} className="flex w-full items-start justify-between gap-3 py-3 text-left transition-colors duration-200 hover:bg-plum/[0.03]">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={t.status === "pending" ? "soon" : "live"}>{TICKET_STATUS_LABEL[t.status]}</StatusPill>
                      <span className="rounded border border-line bg-plum/5 px-1.5 py-0.5 text-[10px] leading-4 text-mute">{t.category}</span>
                      <span className="min-w-0 truncate text-[13px] font-medium leading-5 text-strong">{t.title}</span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] leading-4 text-faint">
                      <span className="num">{t.id}</span><span aria-hidden>·</span><span className="num">{timeAgo(t.createdAt)}</span><span aria-hidden>·</span><span>{t.replies.length} 条回复</span>
                    </p>
                  </div>
                  <ChevronDown size={15} className={`mt-1 shrink-0 text-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
                </button>
                {open ? (
                  <div className="space-y-3 border-t border-line py-4">
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-xl rounded-br-md border border-line bg-raise px-3.5 py-2.5 text-[13px] leading-6 text-strong">{t.content}</div>
                    </div>
                    {t.replies.map(r => (
                      <div key={r.id} className="flex items-start gap-2.5">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line bg-plum/5 text-mute"><Headphones size={12} /></span>
                        <div className="max-w-[85%] rounded-xl rounded-tl-md border border-line bg-well px-3.5 py-2.5 text-[13px] leading-6 text-strong">
                          {r.content}
                          <p className="mt-1 text-[10px] leading-4 text-faint">{r.role === "support" ? "客服" : "我"} · <span className="num">{timeAgo(r.at)}</span></p>
                        </div>
                      </div>
                    ))}
                    {t.status === "pending" && t.replies.length === 0 ? <p className="text-center text-[11px] leading-4 text-faint">等待客服处理…</p> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
