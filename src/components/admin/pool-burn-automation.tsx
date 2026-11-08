"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowUpRight, Copy, Flame, Pause, Play, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { formatEther, formatUnits } from "viem";
import type { BurnStatus } from "@/lib/server/pool-burn-automation.cjs";

const card = "rounded-2xl border border-line bg-deep p-5 sm:p-6";
const input = "mt-2 min-h-12 w-full min-w-0 rounded-xl border border-line bg-abyss px-3 text-sm outline-none focus:border-purple focus:ring-2 focus:ring-purple/10";
function beijing(ms: number) { return ms ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(ms) : "—"; }
function amount(value: string | null | undefined, decimals = 18) {
  if (value == null) return "—";
  return Number(formatUnits(BigInt(value), decimals)).toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}
function explorer(chainId: number) { return chainId === 97 ? "https://testnet.bscscan.com" : "https://bscscan.com"; }

export default function PoolBurnAutomation() {
  const [data, setData] = useState<BurnStatus | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [key, setKey] = useState(""), [gas, setGas] = useState("1"), [busy, setBusy] = useState(false), [refreshing, setRefreshing] = useState(false);
  const active = useRef(false), loading = useRef(false), mutation = useRef(false), initialized = useRef(false), editedGas = useRef(false), sequence = useRef(0);
  const refresh = useCallback(async () => {
    if (loading.current || mutation.current) return;
    loading.current = true; const request = ++sequence.current; setRefreshing(true);
    try {
      const response = await fetch("/api/admin/pool-burn", { cache: "no-store" });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "状态读取失败");
      if (!active.current || sequence.current !== request) return;
      setData(value); setError("");
      if (!initialized.current) { if (!editedGas.current) setGas(value.config?.maxGasGwei || "1"); initialized.current = true; }
    } catch (cause) { if (active.current && sequence.current === request) setError(cause instanceof Error ? cause.message : "状态读取失败，请重试"); }
    finally { loading.current = false; if (active.current) setRefreshing(false); }
  }, []);
  useEffect(() => {
    active.current = true;
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30_000);
    return () => { active.current = false; clearTimeout(first); clearInterval(timer); };
  }, [refresh]);
  async function submit(action: "save" | "enable" | "pause") {
    if (!data || mutation.current) return;
    mutation.current = true; ++sequence.current; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/pool-burn", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, revision: data.config?.revision || 0, ...(action === "save" ? { privateKey: key, maxGasGwei: gas } : {}) }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "操作未完成");
      if (!active.current) return;
      setData(value); setKey(""); setGas(value.config.maxGasGwei); editedGas.current = false;
      setNotice(action === "save" ? "已加密保存，自动执行保持暂停。请向下方执行钱包充值 BNB，再启用任务。" : action === "enable" ? "自动执行已启用，到期后由服务器发送交易。" : "已暂停创建新交易，已签名或提交的交易会继续核对。 ");
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "操作未完成，请重试"); }
    finally { mutation.current = false; if (active.current) setBusy(false); }
  }
  async function copyWallet() {
    try { await navigator.clipboard.writeText(data!.config!.address); setNotice("执行钱包地址已复制"); }
    catch { setError("复制失败，请长按地址手动复制"); }
  }
  const config = data?.config, worker = data?.worker, chain = worker?.chain;
  const running = Boolean(config?.enabled), changed = Boolean(key.trim() || (config && gas !== config.maxGasGwei));
  const lowBalance = worker?.balance != null && BigInt(worker.balance) < 100_000_000_000_000n;
  const statusText = !data ? "读取中" : !config ? "未配置" : !config.matches ? "需重新配置" : !running ? "已暂停" : !worker?.fresh ? "服务离线" : data.pending ? "等待确认" : "已启用";
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-[10px] tracking-[0.2em] text-faint">POOL BURN</p><h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold"><Flame size={23} className="text-gold" />底池燃烧</h1><p className="mt-2 text-sm leading-6 text-mute">配置一次，服务器自动执行到期燃烧。</p></div>
      <button onClick={() => void refresh()} disabled={refreshing || busy} className="btn btn-outline min-h-11 px-4 text-xs"><RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />刷新状态</button>
    </div>
    <div className="rounded-2xl border border-gold/20 bg-gold/[0.06] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-semibold">每 8 小时 · 底池 CaBi 的 1%</p><span className={`rounded-full px-3 py-1.5 text-xs ${running && worker?.fresh ? "bg-up/10 text-up" : "bg-plum/5 text-mute"}`}>{statusText}</span></div>
      <p className="mt-2 text-xs leading-6 text-mute">按执行时的底池余额计算。USDT 和 LP 凭证留在池中；错过的时段不补烧，下一次从实际执行时间起算。</p>
    </div>
    {error ? <p role="alert" className="rounded-xl border border-down/20 bg-down/5 p-4 text-sm leading-6 text-down">{error}</p> : null}
    {notice ? <p role="status" className="rounded-xl border border-up/20 bg-up/5 p-4 text-sm leading-6 text-up">{notice}</p> : null}
    <div className="grid gap-5 xl:grid-cols-2">
      <section className={card}>
        <h2 className="flex items-center gap-2 font-semibold"><Wallet size={18} className="text-purple-deep" />执行钱包</h2>
        <p className="mt-2 text-xs leading-6 text-mute">新建一个专用 BSC 钱包，只存少量 BNB 支付 GAS，无需使用管理员或收款钱包。</p>
        <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); void submit("save"); }}>
          <label className="block text-xs font-medium">{config ? "更换执行钱包私钥（留空保留）" : "执行钱包私钥"}<input aria-label="执行钱包私钥" type="password" value={key} onChange={event => setKey(event.target.value)} autoComplete="new-password" spellCheck={false} placeholder="0x 开头的 64 位私钥" className={input} disabled={busy || data?.pending} /></label>
          <label className="block text-xs font-medium">GAS 单价上限（Gwei）<input aria-label="GAS 单价上限" type="text" inputMode="decimal" value={gas} onChange={event => { editedGas.current = true; setGas(event.target.value); }} className={input} disabled={busy || data?.pending} /></label>
          <p className="text-xs leading-5 text-mute">默认 1 Gwei，最高 5 Gwei。超过上限会等待费用下降。</p>
          <button type="submit" disabled={busy || !data || data.pending || (!config && !key.trim())} className="btn btn-outline min-h-12 w-full text-sm">{busy ? "正在处理…" : "保存配置并暂停"}</button>
        </form>
        <p className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-faint"><ShieldCheck size={14} className="mt-0.5 shrink-0" />私钥在服务器加密保存，保存后不回显。页面刷新不会清空正在填写的内容。</p>
        {config ? <div className="mt-5 rounded-xl border border-line bg-abyss p-4">
          <p className="text-xs text-mute">向此地址充值 BNB（BSC 网络）</p><p className="mt-2 break-all font-mono text-xs leading-6" data-testid="keeper-address">{config.address}</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><p className={`text-sm font-medium ${lowBalance ? "text-down" : "text-strong"}`}>{worker?.balance != null ? Number(formatEther(BigInt(worker.balance))).toLocaleString("zh-CN", { maximumFractionDigits: 7 }) : "—"} BNB</p><button onClick={() => void copyWallet()} className="btn btn-outline min-h-11 px-3 text-xs"><Copy size={13} />复制地址</button></div>
          <p className="mt-2 text-[11px] leading-5 text-faint">可先转入 0.003 BNB，实际消耗以链上 GAS 为准。余额每分钟更新。</p>
        </div> : null}
      </section>
      <section className={card}>
        <h2 className="flex items-center gap-2 font-semibold"><Activity size={18} className="text-purple-deep" />任务状态</h2>
        <dl className="mt-4 divide-y divide-line text-xs">
          {[["定时服务", worker?.fresh ? "在线 · 每分钟检查" : "等待服务心跳"], ["最近检查（北京时间）", beijing(worker?.heartbeat || 0)], ["下次最早执行（北京时间）", chain?.nextBurnAt && chain.nextBurnAt !== "0" ? beijing(Number(chain.nextBurnAt) * 1000) : "等待合约计时"], ["本次预计燃烧", amount(chain?.amount) + " CaBi"], ["累计燃烧", amount(chain?.totalBurned) + " CaBi"]].map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-2 py-3.5"><dt className="text-mute">{label}</dt><dd className="font-medium">{value}</dd></div>)}
        </dl>
        <p className="mt-3 rounded-xl bg-abyss p-3 text-xs leading-6 text-mute">{!config ? "保存执行钱包并充值 BNB 后，即可启用自动燃烧。" : !worker?.fresh ? "定时服务尚未就绪或心跳过期，自动执行无法保证，请检查服务。" : worker.status === "error" || worker.status === "needs-review" || data?.pending ? worker.message : !running ? "自动执行已暂停。" : worker.status === "paused" || worker.status === "unconfigured" ? "已启用，等待下一分钟检查。" : worker.message}</p>
        {config && !config.matches ? <p className="mt-3 text-xs leading-6 text-down">网站代币已变更，请重新保存执行钱包后启用。</p> : null}
        {data?.pending ? <p className="mt-3 text-xs leading-6 text-mute">有一笔交易等待核对。暂停不会撤回已签名或提交的交易，核对完成前不能更换配置。</p> : null}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button onClick={() => void submit("enable")} disabled={busy || !config || running || !config.matches || !worker?.fresh || data?.pending || changed} className="btn btn-gold min-h-12 px-3 text-sm"><Play size={15} />启用自动执行</button>
          <button onClick={() => void submit("pause")} disabled={busy || !running} className="btn btn-outline min-h-12 px-3 text-sm"><Pause size={15} />暂停任务</button>
        </div>
        {changed ? <p className="mt-3 text-xs text-mute">配置有改动，请先保存，再启用。</p> : null}
        <p className="mt-4 text-[11px] leading-6 text-faint">启用即授权服务器用该钱包发送到期燃烧交易并支付 GAS。若已到期，下次检查即可执行，无需再次确认。</p>
        {data ? <a href={`${explorer(data.context.chainId)}/address/${data.context.token}`} target="_blank" rel="noopener noreferrer" className="mt-4 flex items-center gap-1 text-xs text-purple-deep">查看当前代币合约<ArrowUpRight size={13} /></a> : null}
      </section>
    </div>
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">最近执行记录</h2><Link href="/admin/contracts" className="flex min-h-11 items-center gap-1 text-xs text-purple-deep">手动执行入口<ArrowUpRight size={13} /></Link></div>
      {!data?.history.length ? <p className="py-7 text-center text-xs text-mute">暂无自动执行记录</p> : <ul className="mt-2 divide-y divide-line">{data.history.map(tx => <li key={tx.hash} className="flex flex-wrap items-center justify-between gap-3 py-4 text-xs"><div className="min-w-0"><p className="font-medium">{{ confirmed: "燃烧成功", pending: "等待确认", reverted: "执行失败 · 已暂停", invalid: "需要核对 · 已暂停" }[tx.status] || "需要核对"}{tx.amount ? ` · ${amount(tx.amount)} CaBi` : ""}</p><p className="mt-1.5 text-faint">{beijing(tx.confirmedAt || tx.createdAt)} · 北京时间</p></div><a href={`${explorer(tx.chainId)}/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" className="flex min-h-11 shrink-0 items-center gap-1 text-purple-deep">{tx.hash.slice(0, 8)}…{tx.hash.slice(-6)}<ArrowUpRight size={13} /></a></li>)}</ul>}
    </section>
  </div>;
}
