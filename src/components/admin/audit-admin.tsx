"use client";

// 审计日志：分页 / 关键字 / 动作筛选；同时管理后台活跃会话（强制下线）

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, KeyRound, Loader2, LogOut, Search, ScrollText } from "lucide-react";
import { communityRequest } from "@/lib/community-client";
import { EmptyRow, SectionTitle } from "@/components/dapp/ui";

interface AuditEntry { id: string; actor: string; action: string; detail: string; at: number }
interface AuditPayload { items: AuditEntry[]; total: number; page: number; pageSize: number; actions: string[] }
interface SessionRow { id: string; account: string; createdAt: number; expiresAt: number }

const PAGE_SIZE = 20;

function detailText(detail: string) {
  try {
    const value = JSON.parse(detail) as Record<string, unknown>;
    const parts: string[] = [];
    for (const [key, raw] of Object.entries(value)) {
      if (raw === null || raw === undefined || raw === "") continue;
      if (typeof raw === "object") parts.push(`${key}: ${JSON.stringify(raw)}`);
      else parts.push(`${key}: ${String(raw)}`);
    }
    return parts.length ? parts.join(" · ") : detail;
  } catch { return detail; }
}

export function AuditAdmin() {
  const [data, setData] = useState<AuditPayload | null>(null);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: search, action, page: String(page), pageSize: String(PAGE_SIZE) });
      const payload = await communityRequest<AuditPayload>(`/api/admin/audit?${params}`);
      setData(payload);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "审计日志加载失败"); }
    finally { setLoading(false); }
  }, [search, action, page]);
  useEffect(() => { const id = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(id); }, [load]);

  const loadSessions = useCallback(async () => {
    try { const body = await communityRequest<{ sessions: SessionRow[] }>("/api/admin/sessions"); setSessions(body.sessions); }
    catch { /* 会话读取失败不阻断审计列表 */ }
  }, []);
  useEffect(() => {
    const id = window.setTimeout(() => void loadSessions(), 0);
    return () => window.clearTimeout(id);
  }, [loadSessions]);

  async function kickSession(session: SessionRow) {
    if (!window.confirm("确认强制该管理员会话下线？对方需要重新登录。")) return;
    setBusy(session.id);
    try { const body = await communityRequest<{ sessions: SessionRow[] }>("/api/admin/sessions", { method: "DELETE", body: JSON.stringify({ id: session.id }) }); setSessions(body.sessions); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "下线失败"); }
    finally { setBusy(null); }
  }

  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <section className="card p-5 sm:p-6">
        <SectionTitle icon={KeyRound} title="后台活跃会话" extra={<span className="kicker">SESSIONS · {sessions.length}</span>} />
        {sessions.length === 0 ? <EmptyRow text="暂无活跃会话" /> : (
          <div className="divide-y divide-line border-t border-line">
            {sessions.map(session => (
              <div key={session.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="text-[12px] font-medium text-strong">{session.account}<span className="num ml-2 text-[10px] font-normal text-faint">#{session.id}</span></p>
                  <p className="mt-0.5 text-[10px] text-faint">登录 {new Date(session.createdAt).toLocaleString("zh-CN", { hour12: false })} · 到期 {new Date(session.expiresAt).toLocaleString("zh-CN", { hour12: false })}</p>
                </div>
                <button onClick={() => void kickSession(session)} disabled={busy === session.id} className="btn btn-outline h-7 px-2 text-[10px] hover:border-down/40 hover:text-down">{busy === session.id ? <Loader2 size={11} className="animate-spin" /> : <LogOut size={11} />} 强制下线</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card p-5 sm:p-6">
        <SectionTitle icon={ScrollText} title="审计日志" extra={<span className="kicker">AUDIT · {data?.total ?? 0}</span>} />
        {error ? <p role="alert" className="mb-3 rounded-lg border border-down/30 bg-down/[0.06] px-3 py-2 text-[11px] text-down">{error}</p> : null}
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <select value={action} onChange={e => { setAction(e.target.value); setPage(1); }} className="field h-9 w-full px-2 text-[11px] sm:w-48">
            <option value="">全部动作</option>
            {(data?.actions || []).map(item => <option key={item} value={item}>{item}</option>)}
          </select>
          <form onSubmit={e => { e.preventDefault(); setPage(1); setSearch(q.trim()); }} className="flex min-w-0 items-center gap-2">
            <label className="relative min-w-0 flex-1 sm:w-64">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索操作者 / 动作 / 明细" className="field h-9 w-full pl-8 pr-3 text-[12px]" />
            </label>
            <button type="submit" className="btn btn-outline h-9 px-3 text-[11px]">搜索</button>
          </form>
        </div>
        {loading ? <EmptyRow text="正在读取审计日志…" /> : (data?.items || []).length === 0 ? <EmptyRow text="暂无审计记录" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[12px]">
              <thead><tr className="border-b border-line text-[10px] uppercase tracking-[0.06em] text-faint"><th className="py-2 pr-3 font-medium">时间</th><th className="py-2 pr-3 font-medium">动作</th><th className="py-2 pr-3 font-medium">操作者</th><th className="py-2 font-medium">明细</th></tr></thead>
              <tbody className="divide-y divide-line">
                {data!.items.map(entry => (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap py-2.5 pr-3 text-[10px] text-faint">{new Date(entry.at).toLocaleString("zh-CN", { hour12: false })}</td>
                    <td className="py-2.5 pr-3 text-[11px] text-strong">{entry.action}</td>
                    <td className="py-2.5 pr-3 text-[11px] text-mute">{entry.actor}</td>
                    <td className="max-w-[520px] break-words py-2.5 text-[11px] leading-5 text-mute">{detailText(entry.detail)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex items-center justify-between text-[11px] text-faint">
          <span>共 <span className="num">{data?.total ?? 0}</span> 条 · 第 <span className="num">{page}</span>/<span className="num">{totalPages}</span> 页</span>
          <div className="flex gap-1.5">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="btn btn-outline h-7 w-7 px-0" aria-label="上一页"><ChevronLeft size={13} /></button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading} className="btn btn-outline h-7 w-7 px-0" aria-label="下一页"><ChevronRight size={13} /></button>
          </div>
        </div>
      </section>
    </div>
  );
}
