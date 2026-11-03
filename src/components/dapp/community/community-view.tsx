"use client";

// 社群主视图：服务端成员 / 管理员 / 消息 / 禁言状态；免签名登录后参与发言与群管理

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Send, ShieldAlert, ShieldCheck, UserMinus, UserX, Users, Wallet, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { shortAddr, timeAgo } from "@/lib/constants";
import { communityRequest, signInCommunity, type CommunityMemberView, type CommunityMessageView } from "@/lib/community-client";
import { AdminBadge } from "@/components/dapp/community/admin-badge";
import { EmptyRow, Notice } from "@/components/dapp/ui";

interface CommunityPayload {
  members: CommunityMemberView[];
  membersTotal: number;
  admins: Array<{ address: string; name: string; at: number }>;
  messages: CommunityMessageView[];
  me: { address: string; isAdmin: boolean; isKicked: boolean; member: { name: string; joinedAt: number; official: boolean } | null } | null;
}

export function CommunityView() {
  const { state, connect, showToast } = useStore();
  const [data, setData] = useState<CommunityPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [membersOpen, setMembersOpen] = useState(false);
  const [kickTarget, setKickTarget] = useState<CommunityMemberView | null>(null);
  const [busy, setBusy] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const latestMessage = data?.messages.at(-1)?.id;

  useEffect(() => {
    if (followLatest.current && messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [latestMessage]);

  useEffect(() => {
    const element = messagesRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (followLatest.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const load = useCallback(async () => {
    try {
      const payload = await communityRequest<CommunityPayload>("/api/community");
      setData(payload);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "社群加载失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 30_000);
    window.addEventListener("cabi-community-updated", load);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); window.removeEventListener("cabi-community-updated", load); };
  }, [load]);

  useEffect(() => {
    if (!membersOpen) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setMembersOpen(false); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKeyDown); };
  }, [membersOpen]);

  const adminSet = useMemo(() => new Set((data?.admins || []).map(admin => admin.address.toLowerCase())), [data?.admins]);
  const canModerate = Boolean(data?.me?.isAdmin && !data.me.isKicked);
  const showMembers = useCallback(() => setMembersOpen(true), []);

  async function signIn() {
    if (!state.address || signing) return;
    setSigning(true);
    try { await signInCommunity(state.address); await load(); showToast("已加入社群"); }
    catch (e) { showToast(e instanceof Error ? e.message : "加入社群失败"); }
    finally { setSigning(false); }
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const { message } = await communityRequest<{ message: CommunityMessageView }>("/api/community/messages", { method: "POST", body: JSON.stringify({ text }) });
      followLatest.current = true;
      setInput("");
      setData(prev => prev ? { ...prev, messages: [...prev.messages, message].slice(-120) } : prev);
    } catch (e) { showToast(e instanceof Error ? e.message : "发送失败"); }
    finally { setSending(false); }
  }

  async function kick() {
    if (!kickTarget || busy) return;
    setBusy(true);
    try {
      await communityRequest("/api/community/kick", { method: "POST", body: JSON.stringify({ address: kickTarget.address }) });
      showToast(`已将「${kickTarget.name}」移出社群`);
      setKickTarget(null);
      await load();
    } catch (e) { showToast(e instanceof Error ? e.message : "移出失败"); }
    finally { setBusy(false); }
  }

  const members = data?.members || [];

  const memberList = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-end justify-between gap-2 border-b border-line pb-2.5">
        <div className="min-w-0">
          <p className="kicker">MEMBERS</p>
          <p className="mt-1 flex items-center gap-1.5 text-[13px] font-semibold leading-4 text-strong">
            <Users size={13} className="shrink-0 text-mute" /> 成员
            <span className="num text-[11px] font-normal text-faint">{loading ? "—" : members.length}</span>
          </p>
        </div>
        <span className="shrink-0 text-[10px] leading-4 text-faint">{canModerate ? "管理员可移出" : "只读"}</span>
      </div>
      {members.length === 0 ? (
        <EmptyRow text={loading ? "正在同步成员…" : "暂无成员 · 连接钱包加入社群"} />
      ) : (
        <div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto overscroll-contain">
          {members.map(member => {
            const isAdmin = adminSet.has(member.address.toLowerCase());
            const isSelf = Boolean(state.address) && member.address.toLowerCase() === state.address.toLowerCase();
            const kickable = canModerate && !member.official && !isAdmin && !isSelf;
            return (
              <div key={member.address} className="group flex items-center gap-2.5 px-1 py-2 transition-colors hover:bg-plum/5">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${isAdmin ? "bg-plum/[0.07] text-strong ring-1 ring-gold/25" : member.official ? "bg-up/10 text-up" : "bg-plum/[0.07] text-mute"}`}>
                  {member.name.slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[12px] font-medium leading-4 text-strong">{member.name}</span>
                    {isAdmin ? <AdminBadge /> : null}
                    {member.official ? <span className="shrink-0 rounded border border-up/20 bg-up/10 px-1 py-px text-[9px] font-medium leading-4 text-up">官方</span> : null}
                    {isSelf ? <span className="shrink-0 text-[10px] text-mute">我</span> : null}
                  </p>
                  <p className="num mt-0.5 truncate text-[10px] leading-4 text-faint">{shortAddr(member.address)} · {timeAgo(member.joinedAt)}</p>
                </div>
                {kickable ? (
                  <button onClick={() => setKickTarget(member)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-faint opacity-0 transition duration-200 group-hover:opacity-100 hover:bg-down/10 hover:text-down" aria-label={`移出成员 ${member.name}`}>
                    <UserMinus size={13} />
                  </button>
                ) : isAdmin ? <ShieldCheck size={12} className="shrink-0 text-faint" aria-label="群管理员" /> : null}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-auto flex shrink-0 items-start gap-1.5 border-t border-line pt-3 text-[11px] leading-5 text-faint">
        <ShieldCheck size={11} className="mt-0.5 shrink-0 text-up/70" />
        管理员不能移出自己、其他管理员与官方账号；被移出成员的历史消息保留。
      </p>
    </div>
  );

  return (
    <>
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-6">
        <section aria-label="社群聊天" className="card flex min-h-0 flex-col overflow-hidden p-0">
          <div className="shrink-0 border-b border-line bg-deep px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-plum/5 text-mute"><Users size={17} strokeWidth={1.6} /></span>
                <div className="min-w-0">
                  <h1 className="truncate text-[15px] font-semibold leading-5 text-strong">蟹比特社群</h1>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] leading-4 text-mute">
                    <Users size={11} className="shrink-0" />
                    <span><span className="num">{loading ? "—" : members.length}</span> 名成员</span>
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={showMembers} className="btn btn-outline h-8 px-3 text-[11px] lg:hidden" aria-label="查看成员列表"><Users size={12} /> 成员 <span className="num">{loading ? "—" : members.length}</span></button>
              </div>
            </div>
          </div>

          <div ref={messagesRef} role="log" aria-label="聊天消息" aria-live="polite" aria-relevant="additions" onScroll={event => {
            const element = event.currentTarget;
            followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
          }} className="chat-scroll min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain bg-well px-4 py-4 sm:px-5">
            <div className="mx-auto max-w-[520px] rounded-lg border border-line bg-plum/5 px-3 py-2 text-center text-[11px] leading-5 text-faint">友善交流，违规内容将被自动屏蔽</div>
            {error ? <p role="alert" className="text-center text-[11px] leading-5 text-down">{error}</p> : null}
            {(data?.messages || []).map(message => {
              const self = Boolean(state.address) && message.address.toLowerCase() === state.address.toLowerCase();
              const admin = adminSet.has(message.address.toLowerCase());
              return (
                <div key={message.id} className={self ? "flex flex-col items-end" : "flex items-start gap-2.5"}>
                  {!self ? <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${admin ? "bg-plum/[0.07] text-strong ring-1 ring-gold/25" : "bg-plum/[0.07] text-mute"}`}>{message.name.slice(0, 1)}</span> : null}
                  <div className={`min-w-0 ${self ? "items-end" : "flex-1"}`}>
                    <p className={`flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-mute ${self ? "justify-end" : ""}`}>
                      <span className="max-w-[160px] truncate font-medium sm:max-w-[220px]">{self ? "我" : message.name}</span>
                      {admin ? <AdminBadge /> : null}
                      <span className="num shrink-0 text-faint">{timeAgo(message.at)}</span>
                    </p>
                    <div className={`mt-1 max-w-full break-words rounded-xl border px-3.5 py-2.5 text-[13px] leading-6 sm:max-w-[78%] ${message.blocked ? "border-dashed border-down/30 bg-down/[0.06] text-down" : "border-line bg-raise text-strong"} ${self ? "rounded-br-md" : "rounded-tl-md"}`}>
                      {message.blocked ? <span className="flex items-center gap-1.5"><ShieldAlert size={12} className="shrink-0" /> 该内容包含违规词汇，已被系统自动屏蔽</span> : message.text}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div data-chat-composer className="shrink-0 border-t border-line bg-card px-3 py-3 sm:px-5">
            {!state.connected ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[12px] leading-5 text-mute">连接钱包后即可在社群发言</p>
                <button onClick={connect} className="btn btn-gold h-9 w-full px-4 text-[12px] sm:w-auto"><Wallet size={14} /> 连接钱包</button>
              </div>
            ) : data?.me?.isKicked ? (
              <Notice tone="red" icon={UserX}>
                <p className="text-[12px] font-medium leading-5 text-strong">你已被移出社群，暂时无法发言</p>
                <p className="mt-0.5 text-[11px] leading-5 text-mute">历史消息仍保留；如需恢复成员身份，请联系群管理员或客服。</p>
              </Notice>
            ) : !data?.me ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[12px] leading-5 text-mute">加入社群，和蟹友聊聊</p>
                <button onClick={() => void signIn()} disabled={signing} className="btn btn-gold h-9 w-full px-4 text-[12px] sm:w-auto">{signing ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} {signing ? "加入中…" : "加入社群"}</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input aria-label="消息" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} placeholder="和蟹友聊点什么…" maxLength={200} className="field h-11 min-w-0 flex-1 rounded-full px-4 text-base sm:text-[13px]" />
                <button onClick={() => void send()} disabled={sending || !input.trim()} className="btn btn-gold h-11 w-11 shrink-0" aria-label="发送消息">{sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}</button>
              </div>
            )}
          </div>
        </section>

        <section aria-label="社群成员" className="card hidden min-h-0 overflow-hidden p-4 lg:block">
          {memberList}
        </section>
      </div>

      <div onClick={() => setMembersOpen(false)} aria-hidden={!membersOpen} className={`fixed inset-0 z-50 bg-plum/45 backdrop-blur-[2px] transition-opacity duration-200 lg:hidden ${membersOpen ? "opacity-100" : "pointer-events-none opacity-0"}`} />
      <aside role="dialog" aria-modal="true" aria-label="社群成员" aria-hidden={!membersOpen} className={`fixed right-0 top-0 z-50 flex h-[100dvh] w-[85vw] max-w-[320px] flex-col border-l border-line bg-card shadow-pop transition-transform duration-[220ms] ease-[cubic-bezier(0.22,0.68,0.36,1)] lg:hidden ${membersOpen ? "translate-x-0" : "pointer-events-none translate-x-full"}`}>
        <div className="flex items-center justify-between border-b border-line px-5 pb-3.5 pt-[calc(env(safe-area-inset-top)+16px)]">
          <div className="min-w-0"><p className="kicker">MEMBERS</p><p className="mt-1 flex items-center gap-2 text-[13px] font-semibold leading-4 text-strong"><Users size={13} className="shrink-0 text-mute" /> 社群成员</p></div>
          <button onClick={() => setMembersOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-mute transition duration-200 hover:bg-plum/[0.07] hover:text-strong" aria-label="关闭成员列表"><X size={15} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{memberList}</div>
      </aside>

      {kickTarget ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-plum/45 p-4 backdrop-blur-sm" onClick={() => setKickTarget(null)}>
          <div role="dialog" aria-modal="true" className="card shadow-pop animate-pop-in w-full max-w-[400px] p-6" onClick={e => e.stopPropagation()}>
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-down/25 bg-down/10 text-down"><UserMinus size={22} strokeWidth={1.5} /></span>
            <h3 className="mt-3 text-center text-[18px] font-semibold leading-6 text-strong">移出该成员？</h3>
            <p className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 text-center text-[12px] leading-5 text-mute">{kickTarget.name}<span className="num text-[11px] text-faint">{shortAddr(kickTarget.address)}</span></p>
            <div className="well mt-5 space-y-2.5 p-4 text-[12px] leading-5 text-mute">
              <p>· 该成员将从社群成员列表中移除</p>
              <p>· 被移出后无法在群内发言，重新连接钱包也不会自动恢复</p>
              <p>· 其历史消息全部保留，可随时恢复成员身份</p>
            </div>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setKickTarget(null)} className="btn btn-outline h-11 flex-1 text-[13px]">取消</button>
              <button onClick={() => void kick()} disabled={busy} className="btn h-11 flex-1 border border-down/40 bg-down/[0.08] text-[13px] text-down transition duration-200 hover:bg-down/[0.14]"><ShieldAlert size={15} /> {busy ? "处理中…" : "确认移出"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
