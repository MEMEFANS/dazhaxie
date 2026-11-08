"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Droplets, Pause, Play, RefreshCw } from "lucide-react";
import type { LiquidityAccessStatus } from "@/lib/liquidity-access";

function time(seconds: number | undefined) {
  return seconds ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(seconds * 1000) : "尚未设置";
}
export default function LiquiditySettings() {
  const [data, setData] = useState<LiquidityAccessStatus | null>(null), [busy, setBusy] = useState(false), [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const mounted = useRef(false), requestId = useRef(0), changing = useRef(false), fetching = useRef(false);
  const refresh = useCallback(async () => {
    if (changing.current || fetching.current) return;
    fetching.current = true; const id = ++requestId.current; setRefreshing(true);
    try {
      const response = await fetch("/api/admin/liquidity", { cache: "no-store" }), body = await response.json();
      if (!response.ok) throw new Error(body.error || "组 LP 状态读取失败");
      if (mounted.current && id === requestId.current) { setData(body); setError(""); }
    } catch (cause) { if (mounted.current && id === requestId.current) setError(cause instanceof Error ? cause.message : "读取失败，请重试"); }
    finally { fetching.current = false; if (mounted.current) setRefreshing(false); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const first = setTimeout(() => void refresh(), 0), timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    return () => { mounted.current = false; clearTimeout(first); clearInterval(timer); };
  }, [refresh]);
  async function change(enabled: boolean) {
    if (!data || changing.current) return;
    changing.current = true; ++requestId.current; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/liquidity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, revision: data.settings.revision, scope: data.settings.scope }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "保存失败");
      if (mounted.current) {
        setData(previous => previous ? { ...previous, settings: body.settings, available: enabled && Boolean(previous.chain?.canPrepare), reason: enabled ? "组 LP 申请开放中" : "网站组 LP 申请已暂停" } : previous);
        setNotice(enabled ? "已开放新的组 LP 申请。用户页面刷新后同步，点击操作时会再次校验。" : "已暂停新的组 LP 授权申请，已组 LP 用户仍可按原定时间领取。");
      }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "保存失败，请重试"); }
    finally { changing.current = false; if (mounted.current) setBusy(false); }
  }
  const chain = data?.chain, allowed = Boolean(chain?.canPrepare), enabled = Boolean(data?.settings.enabled);
  const ended = Boolean(chain?.tradingOpen);
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] tracking-[0.2em] text-faint">LIQUIDITY</p><h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold"><Droplets size={23} className="text-purple-deep" />组 LP 管理</h1><p className="mt-2 text-sm text-mute">控制网站新申请，查看链上开放状态。</p></div><button onClick={() => void refresh()} disabled={busy || refreshing} className="btn btn-outline min-h-11 px-4 text-xs"><RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />刷新状态</button></div>
    {error ? <p role="alert" className="rounded-xl border border-down/20 bg-down/5 p-4 text-sm leading-6 text-down">{error}</p> : null}
    {notice ? <p role="status" className="rounded-xl border border-up/20 bg-up/5 p-4 text-sm leading-6 text-up">{notice}</p> : null}
    <section className="rounded-2xl border border-line bg-deep p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">网站组 LP 开关</h2><span className={`rounded-full px-3 py-1.5 text-xs ${data?.available ? "bg-up/10 text-up" : "bg-plum/5 text-mute"}`}>{!data ? "读取中" : !enabled ? "已暂停" : ended ? "链上阶段已结束" : data.available ? "开放中" : "等待链上开放"}</span></div>
      <p className="mt-3 text-sm leading-7 text-mute">{data?.reason || "正在核对组 LP 状态…"}</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2"><button onClick={() => void change(true)} disabled={busy || !data || enabled || !allowed} className="btn btn-gold min-h-12 px-4 text-sm"><Play size={15} />开放组 LP 申请</button><button onClick={() => void change(false)} disabled={busy || !data || !enabled} className="btn btn-outline min-h-12 px-4 text-sm"><Pause size={15} />暂停组 LP 申请</button></div>
      <p className="mt-4 text-xs leading-6 text-mute">保存立即生效，无需钱包签名和 GAS。开关只控制新的组 LP 申请，不影响认购、已组 LP 的资产和后续领取。</p>
      <p className="mt-2 text-xs leading-6 text-faint">暂停前签发的授权在到期前仍可能通过合约执行，当前最长 {Math.ceil((data?.maxAuthorizationSeconds || 600) / 60)} 分钟；已发送的交易无法撤回。</p>
    </section>
    <section className="rounded-2xl border border-line bg-deep p-5 sm:p-6">
      <h2 className="font-semibold">链上阶段与时间</h2>
      <dl className="mt-3 divide-y divide-line text-xs">{[["当前阶段", !chain ? "暂未读取" : ended ? "交易已开放" : chain.claimOpen ? "领取已开放 · 仍可组 LP" : chain.liquidityEnabled ? "组 LP 阶段" : "筹备阶段"], ["领取开放（北京时间）", time(chain?.claimStartsAt)], ["交易开放（北京时间）", time(chain?.tradingStartsAt)], ["网站申请设置", !data ? "—" : enabled ? "允许申请" : "已暂停"]].map(([label, value]) => <div className="flex flex-wrap justify-between gap-2 py-3.5" key={label}><dt className="text-mute">{label}</dt><dd className="font-medium">{value}</dd></div>)}</dl>
      <div className="mt-4 rounded-xl border border-gold/20 bg-gold/5 p-4 text-xs leading-6 text-mute">{ended ? "当前合约已开盘，固定比例组 LP 阶段不能重新开启。网站开关无法绕过这个限制；若需要开盘后继续组 LP，需要另行调整合约方案。" : "链上首次开启组 LP 需要管理员钱包操作，开启后领取与交易时间会锁定。这里的网站开关不能修改链上时间，也不能替代首次开启。"}</div>
      {data?.pool ? <a className="mt-4 flex min-h-11 items-center gap-1 break-all text-xs text-purple-deep" href={`${data.chainId === 97 ? "https://testnet.bscscan.com" : "https://bscscan.com"}/address/${data.pool}`} target="_blank" rel="noopener noreferrer">查看组 LP 合约<ArrowUpRight size={13} /></a> : null}
    </section>
    <Link href="/admin/subscribe" className="flex min-h-11 items-center gap-1 text-xs text-purple-deep">查看认购订单与用户额度<ArrowUpRight size={13} /></Link>
  </div>;
}
