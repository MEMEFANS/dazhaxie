"use client";

// 社群后台：成员搜索分页、管理员任命/撤销、移出/恢复、操作日志，全部落 SQLite

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Search, ShieldCheck, ShieldOff, UserMinus, UserPlus, Users } from "lucide-react";
import { communityRequest, type CommunityLogView } from "@/lib/community-client";
import { shortAddr } from "@/lib/constants";
import { EmptyRow, SectionTitle, StatCard, StatusPill } from "@/components/dapp/ui";

interface MemberRow { address: string; name: string; joinedAt: number; status: "active" | "kicked"; official: boolean; isAdmin: boolean }
interface AdminRow { address: string; name: string; at: number; by: string }
interface KickedRow { id: string; address: string; name: string; at: number; operator: string; by: string; reason: string }
interface CommunityPayload {
  members: MemberRow[]; membersTotal: number; page: number; pageSize: number;
  admins: AdminRow[]; kicked: KickedRow[]; logs: CommunityLogView[]; logsTotal: number; logsPage: number;
  stats: { active: number; kicked: number; admins: number; pendingTickets: number };
}

const ACTION_LABEL: Record<CommunityLogView["action"], string> = { appoint: "设为管理员", revoke: "撤销管理员", kick: "移出社群", restore: "恢复成员" };
const PAGE_SIZE = 20;

export function CommunityAdmin() {
  const [data, setData] = useState<CommunityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"active" | "kicked">("active");
  const [logsPage, setLogsPage] = useState(1);
  const [logsAction, setLogsAction] = useState("");
  const [kickTarget, setKickTarget] = useState<MemberRow | null>(null);
  const [kickReason, setKickReason] = useState("");
  const [seedCopied, setSeedCopied] = useState(false);

  async function copySeedSample() {
    try {
      await navigator.clipboard.writeText('CABI_COMMUNITY_SEED=\'[{"address":"0x0000000000000000000000000000000000000001","name":"演示成员"}]\'');
      setSeedCopied(true);
      window.setTimeout(() => setSeedCopied(false), 2000);
    } catch {
      setError("复制失败，请手动选择下面示例文本。");
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status, q: search, page: String(page), pageSize: String(PAGE_SIZE), logsPage: String(logsPage), logsAction });
      const payload = await communityRequest<CommunityPayload>(`/api/admin/community?${params}`);
      setData(payload);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "社群数据加载失败"); }
    finally { setLoading(false); }
  }, [status, search, page, logsPage, logsAction]);
  useEffect(() => { const id = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(id); }, [load]);

  async function perform(action: "appoint" | "revoke" | "restore" | "kick", member: MemberRow, reason?: string) {
    if (busy) return;
    setBusy(true);
    try {
      await communityRequest("/api/admin/community", { method: "POST", body: JSON.stringify({ action, address: member.address, reason }) });
      setKickTarget(null);
      setKickReason("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(false); }
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(q.trim());
  }

  const members = data?.members || [];
  const totalPages = Math.max(1, Math.ceil((data?.membersTotal || 0) / PAGE_SIZE));
  const logPages = Math.max(1, Math.ceil((data?.logsTotal || 0) / PAGE_SIZE));

  return (
    <>
      {error ? <p role="alert" className="rounded-lg border border-down/30 bg-down/[0.06] px-4 py-2.5 text-[12px] leading-5 text-down">{error}</p> : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="社群成员" value={data ? data.stats.active.toString() : "—"} unit="人" hint={data?.stats.pendingTickets ? `待处理工单 ${data.stats.pendingTickets}` : "成员由签名登录自动登记"} />
        <StatCard label="群管理员" value={data ? data.stats.admins.toString() : "—"} unit="位" hint="可在群内移出成员" />
        <StatCard label="已移出" value={data ? data.stats.kicked.toString() : "—"} unit="人" hint="可随时恢复" />
        <StatCard label="操作记录" value={data ? data.logsTotal.toString() : "—"} unit="条" hint="落库并同步审计" />
      </div>
      <section className="card p-5 sm:p-6">
        <SectionTitle icon={Users} title="社群成员" extra={<span className="kicker">{status === "active" ? "ACTIVE MEMBERS" : "REMOVED MEMBERS"}</span>} />
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-full border border-line bg-well p-0.5">
            {(["active", "kicked"] as const).map(key => (
              <button key={key} onClick={() => { setStatus(key); setPage(1); }} className={`h-7 rounded-full px-3 text-[11px] transition ${status === key ? "seg-active font-medium" : "text-mute hover:text-strong"}`}>
                {key === "active" ? `当前成员 ${data?.stats.active ?? "—"}` : `已移出 ${data?.stats.kicked ?? "—"}`}
              </button>
            ))}
          </div>
          <form onSubmit={submitSearch} className="flex min-w-0 items-center gap-2">
            <label className="relative min-w-0 flex-1 sm:w-64">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索地址或昵称" className="field h-9 w-full pl-8 pr-3 text-[12px]" />
            </label>
            <button type="submit" className="btn btn-outline h-9 px-3 text-[11px]">搜索</button>
            <button type="button" onClick={() => void load()} className="btn btn-outline h-9 w-9 px-0" aria-label="刷新"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /></button>
          </form>
        </div>

        {loading ? <EmptyRow text="正在加载成员…" /> : members.length === 0 ? (search ? <EmptyRow text="没有匹配的成员" /> : status === "kicked" ? <EmptyRow text="暂无被移出的成员" /> : (
          <div className="rounded-lg border border-line bg-well p-4">
            <p className="text-sm leading-6 text-mute">当前无成员。配置 <code className="text-strong">CABI_COMMUNITY_SEED</code>，或等待用户连接钱包一键登录后自动入群。</p>
            <p className="mt-2 text-xs leading-5 text-faint">种子仅演示用，生产环境不要写入真实用户地址；库非空时不会重复导入。</p>
            <pre className="mt-3 overflow-x-auto rounded border border-line bg-card p-3 text-[11px] leading-5 text-strong select-all">{'CABI_COMMUNITY_SEED=\'[{"address":"0x0000000000000000000000000000000000000001","name":"演示成员"}]\''}</pre>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button onClick={() => void copySeedSample()} className="btn btn-outline min-h-10 px-3 text-xs">{seedCopied ? "已复制" : "复制示例配置"}</button>
              <span className="text-xs leading-5 text-faint">对象格式（含 admins / official）见 deploy/seed-community.example.json。</span>
            </div>
          </div>
        )) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[12px]">
              <thead><tr className="border-b border-line text-[10px] uppercase tracking-[0.08em] text-faint"><th className="py-2 pr-3 font-medium">成员</th><th className="py-2 pr-3 font-medium">地址</th><th className="py-2 pr-3 font-medium">身份</th><th className="py-2 pr-3 font-medium">入群时间</th><th className="py-2 text-right font-medium">操作</th></tr></thead>
              <tbody className="divide-y divide-line">
                {members.map(member => (
                  <tr key={member.address} className="align-middle">
                    <td className="py-2.5 pr-3"><span className="block max-w-[160px] truncate font-medium text-strong">{member.name}</span></td>
                    <td className="num py-2.5 pr-3 text-[11px] text-mute">{shortAddr(member.address)}</td>
                    <td className="py-2.5 pr-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {member.official ? <StatusPill tone="live">官方</StatusPill> : null}
                        {member.isAdmin ? <StatusPill tone="soon">群管理员</StatusPill> : null}
                        {!member.official && !member.isAdmin ? <span className="text-[11px] text-faint">普通成员</span> : null}
                        <span className="num text-[10px] text-faint">{new Date(member.joinedAt).toLocaleDateString("zh-CN")}</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-[10px] text-faint">{status === "kicked" ? "已禁言" : "正常"}</td>
                    <td className="py-2.5 text-right">
                      {status === "active" ? (
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {member.isAdmin ? (
                            <button onClick={() => void perform("revoke", member)} disabled={busy} className="btn btn-outline h-7 px-2 text-[10px]"><ShieldOff size={11} /> 撤销管理</button>
                          ) : member.official ? null : (
                            <button onClick={() => void perform("appoint", member)} disabled={busy} className="btn btn-outline h-7 px-2 text-[10px]"><ShieldCheck size={11} /> 设为管理</button>
                          )}
                          {member.official ? <span className="text-[10px] text-faint">受保护</span> : <button onClick={() => { setKickTarget(member); setKickReason(""); }} disabled={busy} className="btn h-7 border border-down/30 bg-down/[0.06] px-2 text-[10px] text-down hover:bg-down/[0.12]"><UserMinus size={11} /> 移出</button>}
                        </div>
                      ) : (
                        <button onClick={() => void perform("restore", member)} disabled={busy} className="btn btn-outline h-7 px-2 text-[10px]"><UserPlus size={11} /> 恢复成员</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex items-center justify-between text-[11px] text-faint">
          <span>共 <span className="num">{data?.membersTotal ?? 0}</span> 条 · 第 <span className="num">{page}</span>/<span className="num">{totalPages}</span> 页</span>
          <div className="flex gap-1.5">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="btn btn-outline h-7 w-7 px-0" aria-label="上一页"><ChevronLeft size={13} /></button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading} className="btn btn-outline h-7 w-7 px-0" aria-label="下一页"><ChevronRight size={13} /></button>
          </div>
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <SectionTitle icon={ShieldCheck} title="群管理员" extra={<span className="kicker">ADMINS · {data?.admins.length ?? 0}</span>} />
        {(data?.admins || []).length === 0 ? <EmptyRow text="暂无群管理员 · 在成员列表点击「设为管理」任命" /> : (
          <div className="divide-y divide-line border-t border-line">
            {data!.admins.map(admin => (
              <div key={admin.address} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium text-strong">{admin.name}</p>
                  <p className="num mt-0.5 text-[10px] text-faint">{shortAddr(admin.address)} · {new Date(admin.at).toLocaleString("zh-CN", { hour12: false })} · 由 {admin.by}</p>
                </div>
                <button onClick={() => void perform("revoke", { address: admin.address, name: admin.name, joinedAt: admin.at, status: "active", official: false, isAdmin: true })} disabled={busy} className="btn btn-outline h-7 px-2 text-[10px]"><ShieldOff size={11} /> 撤销</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {(data?.kicked || []).length > 0 ? (
        <section className="card p-5 sm:p-6">
          <SectionTitle icon={UserMinus} title="移出记录" extra={<span className="kicker">RECENT REMOVALS</span>} />
          <div className="divide-y divide-line border-t border-line">
            {data!.kicked.map(record => (
              <div key={record.id} className="py-2.5">
                <p className="flex flex-wrap items-center gap-2 text-[12px] font-medium text-strong">{record.name}<span className="num text-[10px] font-normal text-faint">{shortAddr(record.address)}</span><span className="rounded border border-line bg-plum/5 px-1.5 py-0.5 text-[10px] font-normal text-mute">{record.by === "admin-panel" ? "后台移出" : "群内移出"}</span></p>
                <p className="mt-0.5 text-[10px] text-faint">{new Date(record.at).toLocaleString("zh-CN", { hour12: false })} · 操作者 {record.operator}{record.reason ? ` · 原因：${record.reason}` : ""}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card p-5 sm:p-6">
        <SectionTitle icon={RefreshCw} title="操作日志" extra={
          <select value={logsAction} onChange={e => { setLogsAction(e.target.value); setLogsPage(1); }} className="field h-8 w-28 px-2 text-[11px]">
            <option value="">全部动作</option>
            <option value="appoint">设为管理员</option><option value="revoke">撤销管理员</option><option value="kick">移出社群</option><option value="restore">恢复成员</option>
          </select>
        } />
        {(data?.logs || []).length === 0 ? <EmptyRow text="暂无操作记录" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[12px]">
              <thead><tr className="border-b border-line text-[10px] uppercase tracking-[0.08em] text-faint"><th className="py-2 pr-3 font-medium">动作</th><th className="py-2 pr-3 font-medium">对象</th><th className="py-2 pr-3 font-medium">操作者</th><th className="py-2 font-medium">时间</th></tr></thead>
              <tbody className="divide-y divide-line">
                {data!.logs.map(log => (
                  <tr key={log.id}>
                    <td className="py-2.5 pr-3">{ACTION_LABEL[log.action]}</td>
                    <td className="py-2.5 pr-3"><span className="block max-w-[180px] truncate">{log.targetName}</span><span className="num text-[10px] text-faint">{shortAddr(log.target)}</span></td>
                    <td className="py-2.5 pr-3 text-[11px] text-mute">{log.operator}</td>
                    <td className="py-2.5 text-[10px] text-faint">{new Date(log.at).toLocaleString("zh-CN", { hour12: false })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex items-center justify-between text-[11px] text-faint">
          <span>共 <span className="num">{data?.logsTotal ?? 0}</span> 条 · 第 <span className="num">{logsPage}</span>/<span className="num">{logPages}</span> 页</span>
          <div className="flex gap-1.5">
            <button onClick={() => setLogsPage(p => Math.max(1, p - 1))} disabled={logsPage <= 1} className="btn btn-outline h-7 w-7 px-0" aria-label="上一页"><ChevronLeft size={13} /></button>
            <button onClick={() => setLogsPage(p => Math.min(logPages, p + 1))} disabled={logsPage >= logPages} className="btn btn-outline h-7 w-7 px-0" aria-label="下一页"><ChevronRight size={13} /></button>
          </div>
        </div>
      </section>

      {kickTarget ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-plum/45 p-4 backdrop-blur-sm" onClick={() => setKickTarget(null)}>
          <div role="dialog" aria-modal="true" className="card shadow-pop animate-pop-in w-full max-w-[420px] p-6" onClick={e => e.stopPropagation()}>
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-down/25 bg-down/10 text-down"><UserMinus size={22} strokeWidth={1.5} /></span>
            <h3 className="mt-3 text-center text-[18px] font-semibold text-strong">移出社群成员</h3>
            <p className="mt-1.5 text-center text-[12px] leading-5 text-mute">{kickTarget.name} · <span className="num">{shortAddr(kickTarget.address)}</span></p>
            <textarea value={kickReason} onChange={e => setKickReason(e.target.value)} rows={3} maxLength={200} placeholder="移出原因（选填，写入移出记录与审计日志）" className="field mt-4 w-full resize-none px-3 py-2.5 text-[12px] leading-5" />
            <p className="mt-2 text-[11px] leading-5 text-faint">移出后该地址无法在群内发言，重新连接钱包不会自动恢复；成员与历史消息保留，可随时恢复。</p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setKickTarget(null)} className="btn btn-outline h-10 flex-1 text-[12px]">取消</button>
              <button onClick={() => void perform("kick", kickTarget, kickReason)} disabled={busy} className="btn h-10 flex-1 border border-down/40 bg-down/[0.08] text-[12px] text-down hover:bg-down/[0.14]">{busy ? <Loader2 size={13} className="animate-spin" /> : <UserMinus size={13} />} 确认移出</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
