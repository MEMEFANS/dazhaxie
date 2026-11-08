"use client";

// 工单后台：状态筛选 / 地址搜索 / 展开详情 / 回复 / 标记已处理与完结

import { useCallback, useEffect, useState } from "react";
import { CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Headphones, Loader2, MessageSquare, Search } from "lucide-react";
import { communityRequest, TICKET_STATUS_LABEL, type TicketView } from "@/lib/community-client";
import { shortAddr, timeAgo } from "@/lib/constants";
import { EmptyRow, SectionTitle, StatusPill } from "@/components/dapp/ui";

const STATUS_OPTIONS = [
  { key: "all", label: "全部" }, { key: "pending", label: "待处理" }, { key: "processed", label: "已处理" }, { key: "closed", label: "已完结" },
] as const;
const PAGE_SIZE = 20;

export function TicketsAdmin() {
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [tickets, setTickets] = useState<TicketView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status, q: search, page: String(page), pageSize: String(PAGE_SIZE) });
      const result = await communityRequest<{ items: TicketView[]; total: number }>(`/api/admin/tickets?${params}`);
      setTickets(result.items);
      setTotal(result.total);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "工单加载失败"); }
    finally { setLoading(false); }
  }, [status, search, page]);
  useEffect(() => { const id = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(id); }, [load]);

  async function sendReply(ticket: TicketView) {
    if (busy || !reply.trim()) return;
    setBusy(true);
    try {
      await communityRequest("/api/admin/tickets", { method: "POST", body: JSON.stringify({ id: ticket.id, content: reply.trim() }) });
      setReply("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "回复失败"); }
    finally { setBusy(false); }
  }
  async function changeStatus(ticket: TicketView, next: "processed" | "closed") {
    if (busy) return;
    if (next === "closed" && !window.confirm("确认完结该工单？完结后不能再回复。")) return;
    setBusy(true);
    try {
      await communityRequest("/api/admin/tickets", { method: "PATCH", body: JSON.stringify({ id: ticket.id, status: next }) });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "状态更新失败"); }
    finally { setBusy(false); }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="card p-5 sm:p-6">
      <SectionTitle icon={Headphones} title="工单列表" extra={<span className="kicker">TOTAL {total}</span>} />
      {error ? <p role="alert" className="mb-3 rounded-lg border border-down/30 bg-down/[0.06] px-3 py-2 text-[11px] text-down">{error}</p> : null}
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="inline-flex flex-wrap rounded-full border border-line bg-well p-0.5">
          {STATUS_OPTIONS.map(option => (
            <button key={option.key} onClick={() => { setStatus(option.key); setPage(1); }} className={`h-7 rounded-full px-2.5 text-[10px] transition ${status === option.key ? "seg-active font-medium" : "text-mute hover:text-strong"}`}>{option.label}</button>
          ))}
        </div>
        <form onSubmit={e => { e.preventDefault(); setPage(1); setSearch(q.trim()); }} className="flex min-w-0 items-center gap-2">
          <label className="relative min-w-0 flex-1 lg:w-64">
            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索地址 / 标题 / 工单号 / 订单号" className="field h-9 w-full pl-8 pr-3 text-[12px]" />
          </label>
          <button type="submit" className="btn btn-outline h-9 px-3 text-[11px]">搜索</button>
        </form>
      </div>

      {loading ? <EmptyRow text="正在加载工单…" /> : tickets.length === 0 ? <EmptyRow text={search ? "没有匹配的工单" : "暂无工单"} /> : (
        <div className="divide-y divide-line border-t border-line">
          {tickets.map(ticket => {
            const open = expanded === ticket.id;
            return (
              <div key={ticket.id}>
                <button onClick={() => { setExpanded(open ? null : ticket.id); setReply(""); }} className="flex w-full items-start justify-between gap-3 py-3 text-left transition-colors hover:bg-plum/[0.03]">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={ticket.status === "pending" ? "soon" : ticket.status === "processed" ? "live" : "neutral"}>{TICKET_STATUS_LABEL[ticket.status]}</StatusPill>
                      <span className="rounded border border-line bg-plum/5 px-1.5 py-0.5 text-[10px] leading-4 text-mute">{ticket.category}</span>
                      <span className="min-w-0 truncate text-[13px] font-medium leading-5 text-strong">{ticket.title}</span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] leading-4 text-faint">
                      <span className="num">{ticket.id}</span><span aria-hidden>·</span>
                      <span className="num">{shortAddr(ticket.address)}</span><span aria-hidden>·</span>
                      <span className="num">{timeAgo(ticket.createdAt)}</span><span aria-hidden>·</span>
                      <span>{ticket.replies.length} 条回复</span>
                    </p>
                  </div>
                  <ChevronDown size={15} className={`mt-1 shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
                {open ? (
                  <div className="space-y-3 border-t border-line py-4">
                    <div className="well whitespace-pre-wrap break-words p-3.5 text-[12px] leading-6 text-strong">
                      <p className="kicker mb-1">用户描述</p>{ticket.content}
                    </div>
                    {ticket.replies.map(r => (
                      <div key={r.id} className="rounded-lg border border-line bg-raise px-3.5 py-2.5 text-[12px] leading-6 text-strong">
                        {r.content}
                        <p className="mt-1 text-[10px] text-faint">{r.role === "support" ? `客服 ${r.author}` : "用户"} · <span className="num">{timeAgo(r.at)}</span></p>
                      </div>
                    ))}
                    {ticket.status !== "closed" ? (
                      <>
                        <div className="flex items-end gap-2">
                          <textarea value={reply} onChange={e => setReply(e.target.value)} rows={2} maxLength={300} placeholder="输入回复内容（用户可在前台看到）" className="field min-w-0 flex-1 resize-none px-3 py-2.5 text-[12px] leading-5" />
                          <button onClick={() => void sendReply(ticket)} disabled={busy || !reply.trim()} className="btn btn-gold h-10 shrink-0 px-3 text-[11px]">{busy ? <Loader2 size={13} className="animate-spin" /> : <MessageSquare size={13} />} 回复</button>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          {ticket.status === "pending" ? <button onClick={() => void changeStatus(ticket, "processed")} disabled={busy} className="btn btn-outline h-8 px-3 text-[11px]"><CheckCheck size={12} /> 标记已处理</button> : null}
                          <button onClick={() => void changeStatus(ticket, "closed")} disabled={busy} className="btn btn-outline h-8 px-3 text-[11px]"><CheckCheck size={12} /> 标记完结</button>
                        </div>
                      </>
                    ) : <p className="text-[11px] text-faint">该工单已完结，仅保留只读记录。</p>}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-[11px] text-faint">
        <span>共 <span className="num">{total}</span> 条 · 第 <span className="num">{page}</span>/<span className="num">{totalPages}</span> 页</span>
        <div className="flex gap-1.5">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="btn btn-outline h-7 w-7 px-0" aria-label="上一页"><ChevronLeft size={13} /></button>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading} className="btn btn-outline h-7 w-7 px-0" aria-label="下一页"><ChevronRight size={13} /></button>
        </div>
      </div>
    </section>
  );
}
