"use client";

// 工单提交表单：服务端落库；未连接钱包提示连接，未登录提示一键登录

import { useState } from "react";
import { Loader2, Plus, Send, ShieldCheck, Wallet } from "lucide-react";
import { useStore } from "@/lib/store";
import { communityRequest, signInCommunity } from "@/lib/community-client";
import { SectionTitle, TxStatus, type TxState } from "@/components/dapp/ui";
import { CATEGORIES, CategoryPicker } from "./category-picker";

export function TicketForm({ onSubmitted }: { onSubmitted: () => void }) {
  const { state, connect } = useStore();
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [txState, setTxState] = useState<TxState | null>(null);
  const [error, setError] = useState("");
  const [needSignIn, setNeedSignIn] = useState(false);
  const [signing, setSigning] = useState(false);

  async function submit() {
    if (!title.trim() || !content.trim() || txState === "pending") return;
    setTxState("pending");
    setError("");
    try {
      await communityRequest("/api/tickets", { method: "POST", body: JSON.stringify({ category, title: title.trim(), content: content.trim() }) });
      setTxState("success");
      setTitle("");
      setContent("");
      onSubmitted();
      window.dispatchEvent(new Event("cabi-ticket-updated"));
    } catch (e) {
      const message = e instanceof Error ? e.message : "提交失败，请稍后重试";
      setTxState("failed");
      setError(message);
      if (message.includes("登录")) setNeedSignIn(true);
    }
  }

  async function signIn() {
    if (!state.address || signing) return;
    setSigning(true);
    setError("");
    try {
      await signInCommunity(state.address);
      setNeedSignIn(false);
      await submit();
    } catch (e) { setError(e instanceof Error ? e.message : "登录失败"); setTxState("failed"); }
    finally { setSigning(false); }
  }

  return (
    <section className="card p-5 sm:p-6">
      <SectionTitle icon={Plus} title="提交工单" extra={<span className="kicker">NEW TICKET</span>} />
      {!state.connected ? (
        <div className="flex flex-col gap-4 rounded-lg border border-line bg-well p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-plum/5 text-mute"><Wallet size={16} strokeWidth={1.6} /></span>
            <p className="text-[12px] leading-5 text-mute">连接钱包后可提交问题工单</p>
          </div>
          <button onClick={connect} className="btn btn-gold h-10 w-full shrink-0 px-5 text-[12px] sm:w-auto"><Wallet size={14} /> 连接钱包</button>
        </div>
      ) : (
        <div className="space-y-3">
          {needSignIn ? (
            <div className="flex flex-col gap-3 rounded-lg border border-gold/25 bg-gold/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12px] leading-5 text-mute">提交工单需先一键登录（免签名，与社群共用身份）。</p>
              <button onClick={() => void signIn()} disabled={signing} className="btn btn-gold h-9 shrink-0 px-4 text-[12px]">{signing ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} {signing ? "登录中…" : "登录并提交"}</button>
            </div>
          ) : null}
          <div>
            <p className="kicker mb-2">问题分类</p>
            <CategoryPicker value={category} onChange={setCategory} />
          </div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="问题标题（简明描述您遇到的问题）" maxLength={40} className="field h-11 w-full px-3.5 text-[13px]" />
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="请描述问题详情，例如涉及的份数、时间、交易哈希等" rows={4} maxLength={300} className="field w-full resize-none px-3.5 py-3 text-[13px] leading-6" />
          <button onClick={() => void submit()} disabled={!title.trim() || !content.trim() || txState === "pending"} className="btn btn-gold h-11 w-full text-[13px]">
            {txState === "pending" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {txState === "pending" ? "提交中…" : "提交工单"}
          </button>
          {error ? <p role="alert" className="text-[11px] leading-5 text-down">{error}</p> : null}
          {txState ? (
            <div>
              <TxStatus state={txState} note="提交后请等待客服处理，回复会显示在下方工单列表" />
              {txState === "failed" ? <button onClick={() => { setTxState(null); setError(""); }} className="mt-2 h-9 w-full rounded-lg border border-line text-[11px] text-mute transition-colors hover:text-strong">关闭并重新填写</button> : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
