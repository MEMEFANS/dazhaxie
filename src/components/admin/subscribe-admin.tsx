"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, RefreshCw, Save } from "lucide-react";
import { formatAssetAmount } from "@/lib/amounts";
import { Card, DataRow, Progress, SectionHead } from "@/components/dapp/ui";

interface SubscriptionRow { id: string; address: string; shares: number; amount: string; txHash: string; status: string; createdAt: number }
interface ListResponse { items: SubscriptionRow[]; total: number; page: number; pageSize: number; globalSold: number; hardCap: number; subscribeLocked: boolean; subscribePayee: string; error?: string }
interface ClaimPoolResponse {
  mode: "signed" | "legacy" | "unconfigured" | "error";
  pool: string | null; error?: string;
  chain?: {
    owner: string; signer: string; usdt: string; lpReceiver: string; usdtDecimals: number;
    poolBalance: string; totalClaimed: string; totalLpTokens: string; totalUsdtCharged: string;
    allocatedUnclaimed: string; unusedBalance: string; lpReady: boolean;
  };
  signing?: { configured: boolean; signer: string | null; signerMatches?: boolean };
  entitlements: { total: string; outstanding: string; addresses: number; rows: Array<{ address: string; tokens: string; chainClaimed: string; outstanding: string; reason: string[] }> };
}
const emptyList: ListResponse = { items: [], total: 0, page: 1, pageSize: 10, globalSold: 0, hardCap: 20000, subscribeLocked: true, subscribePayee: "" };

function time(value: number) { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }

// 纯读取函数放在组件外，effect 里只在异步回调中写状态。
async function fetchSubscriptions(next: number, nextQ: string): Promise<ListResponse> {
  const response = await fetch(`/api/admin/subscriptions?q=${encodeURIComponent(nextQ)}&page=${next}&pageSize=10`, { cache: "no-store" });
  const body = await response.json().catch(() => ({ error: "认购单读取失败" })) as ListResponse;
  if (!response.ok) throw new Error(body.error || "认购单读取失败");
  return body;
}
async function fetchClaimPool(): Promise<ClaimPoolResponse> {
  const response = await fetch("/api/admin/claim-pool", { cache: "no-store" });
  const body = await response.json().catch(() => ({ error: "领取池读取失败" })) as ClaimPoolResponse;
  if (!response.ok) throw new Error(body.error || "领取池读取失败");
  return body;
}

export default function SubscribeAdmin() {
  const [list, setList] = useState<ListResponse>(emptyList);
  const [pool, setPool] = useState<ClaimPoolResponse | null>(null), [poolError, setPoolError] = useState("");
  const [q, setQ] = useState(""), [page, setPage] = useState(1);
  const [payee, setPayee] = useState("");
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState("");

  async function loadSubscriptions(next = page, nextQ = q) {
    const body = await fetchSubscriptions(next, nextQ);
    setList(body);
    setPayee(prev => prev || body.subscribePayee || "");
  }
  async function loadPool() {
    try { setPool(await fetchClaimPool()); setPoolError(""); }
    catch (cause) { setPoolError(cause instanceof Error ? cause.message : "领取池读取失败"); }
  }
  useEffect(() => {
    let cancelled = false;
    fetchSubscriptions(1, "")
      .then(body => {
        if (cancelled) return undefined;
        setList(body);
        setPayee(prev => prev || body.subscribePayee || "");
      })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "读取失败"); });
    fetchClaimPool()
      .then(body => { if (!cancelled) { setPool(body); setPoolError(""); } })
      .catch(cause => { if (!cancelled) setPoolError(cause instanceof Error ? cause.message : "领取池读取失败"); });
    return () => { cancelled = true; };
  }, []);

  async function saveSettings(patch: { subscribePayee?: string; subscribeLocked?: boolean }, key: string) {
    if (busy) return;
    setBusy(key); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/subscriptions", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const body = await response.json().catch(() => ({ error: "保存失败" })) as { error?: string; settings?: { subscribePayee: string; subscribeLocked: boolean } };
      if (!response.ok) throw new Error(body.error || "保存失败");
      const publicResponse = await fetch("/api/subscribe/config", { credentials: "same-origin", cache: "no-store" });
      const publicConfig = await publicResponse.json().catch(() => ({})) as { payee?: string; locked?: boolean };
      if (!publicResponse.ok || (patch.subscribePayee !== undefined && publicConfig.payee?.toLowerCase() !== body.settings?.subscribePayee?.toLowerCase())
        || (patch.subscribeLocked !== undefined && publicConfig.locked !== body.settings?.subscribeLocked)) {
        throw new Error("后台已收到保存请求，但公开认购配置未同步。请检查服务器是否使用同一个持久化目录 CABI_DATA_DIR，且只运行单实例。没有显示“已保存”，请先刷新核对当前地址。");
      }
      if (body.settings) { setPayee(body.settings.subscribePayee || ""); setList(prev => ({ ...prev, subscribePayee: body.settings!.subscribePayee || "", subscribeLocked: body.settings!.subscribeLocked })); }
      window.dispatchEvent(new Event("cabi-operational-settings-updated"));
      try { window.localStorage.setItem("cabi-subscribe-config-updated", String(Date.now())); } catch { /* Other tabs also poll. */ }
      setMessage("已保存。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败"); }
    finally { setBusy(""); }
  }
  const percent = list.hardCap > 0 ? Math.min(100, list.globalSold * 100 / list.hardCap) : 0;
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  return <div className="space-y-5">
    <Card>
      <SectionHead title="认购管理" desc="USDT 直接转账 + 服务器核验记账；页面不保存任何私钥" />
      <div className="mt-4 grid gap-x-6 sm:grid-cols-2">
        <DataRow label="已认购 / 硬顶" value={`${list.globalSold} / ${list.hardCap} 份`} />
        <DataRow label="剩余额度" value={`${Math.max(0, list.hardCap - list.globalSold)} 份`} />
        <DataRow label="运营开关" value={list.subscribeLocked ? "已暂停" : "开放中"} />
        <DataRow label="已登记认购单" value={`${list.total} 笔`} />
      </div>
      <Progress value={percent} />
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={() => void saveSettings({ subscribeLocked: !list.subscribeLocked }, "toggle")} disabled={Boolean(busy)} className="btn btn-outline min-h-11 px-4 text-xs">{list.subscribeLocked ? "开放认购" : "暂停认购"}</button>
        <button onClick={() => void loadSubscriptions(page, q)} disabled={Boolean(busy)} className="btn btn-outline min-h-11 px-4 text-xs"><RefreshCw size={13} />刷新</button>
      </div>
    </Card>

    <Card>
      <SectionHead title="认购 USDT 收款地址" desc="控制前端认购付款的接收钱包；修改并保存后前端自动同步。兑换 CaBi 收款地址在「兑换管理」单独设置。" />
      <DataRow label="当前地址" value={list.subscribePayee || "未设置"} />
      <div className="mt-3 flex flex-col gap-3 sm:flex-row"><input aria-label="认购收款地址" value={payee} onChange={event => setPayee(event.target.value)} placeholder="0x…（BSC 上的 USDT 收款地址）" className="field min-h-11 w-full min-w-0 px-3 font-mono text-xs" /><button onClick={() => void saveSettings({ subscribePayee: payee }, "payee")} disabled={busy === "payee"} className="btn btn-gold min-h-11 shrink-0 px-4 text-xs">{busy === "payee" ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}保存收款地址</button></div>
      {message ? <p role="status" className="mt-3 text-xs text-up">{message}</p> : null}
      {error ? <p role="alert" className="mt-3 text-xs leading-6 text-down">{error}</p> : null}
    </Card>

    <Card>
      <SectionHead title="认购单列表" desc="全部由服务器核验后落库；globalSold、直推与团队业绩均从这里聚合" />
      <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={event => { event.preventDefault(); setPage(1); void loadSubscriptions(1, q).catch(cause => setError(cause instanceof Error ? cause.message : "读取失败")); }}>
        <input aria-label="搜索认购单" value={q} onChange={event => setQ(event.target.value)} placeholder="按地址或交易哈希搜索" className="field min-h-11 w-full min-w-0 px-3 font-mono text-xs" />
        <button type="submit" className="btn btn-outline min-h-11 px-4 text-xs">搜索</button>
        <a href={`/api/admin/subscriptions/export?q=${encodeURIComponent(q)}`} className="btn btn-outline min-h-11 px-4 text-xs"><Download size={13} />导出 CSV</a>
      </form>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="border-b border-line text-mute"><tr><th className="py-2 pr-3">地址</th><th className="pr-3">份数</th><th className="pr-3">USDT 金额（最小单位）</th><th className="pr-3">交易哈希</th><th className="pr-3">状态</th><th>时间</th></tr></thead>
          <tbody className="divide-y divide-line">{list.items.length ? list.items.map(row => <tr key={row.id}><td className="py-2 pr-3 font-mono">{row.address}</td><td className="pr-3">{row.shares}</td><td className="pr-3 font-mono">{row.amount}</td><td className="pr-3 font-mono">{row.txHash.slice(0, 14)}…</td><td className="pr-3">{row.status === "confirmed" ? "已确认" : row.status}</td><td className="text-mute">{time(row.createdAt)}</td></tr>) : <tr><td colSpan={6} className="py-4 text-mute">暂无认购单</td></tr>}</tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-mute"><span>共 {list.total} 笔 · 第 {list.page} / {pages} 页</span><div className="flex gap-2"><button onClick={() => { const next = Math.max(1, page - 1); setPage(next); void loadSubscriptions(next, q).catch(cause => setError(cause instanceof Error ? cause.message : "读取失败")); }} disabled={page <= 1 || Boolean(busy)} className="btn btn-outline min-h-10 px-3 text-xs">上一页</button><button onClick={() => { const next = Math.min(pages, page + 1); setPage(next); void loadSubscriptions(next, q).catch(cause => setError(cause instanceof Error ? cause.message : "读取失败")); }} disabled={page >= pages || Boolean(busy)} className="btn btn-outline min-h-10 px-3 text-xs">下一页</button></div></div>
    </Card>

    {pool?.mode === "signed" && pool.chain ? <Card>
      <SectionHead title="领取池（用户自动组 LP）" desc="服务器只核验认购额度并签发一次性授权；用户钱包支付 30% USDT、自动加入 LP，领取开放后再领取 70% CaBi。" />
      {poolError ? <p role="alert" className="mt-2 text-xs leading-6 text-down">{poolError}</p> : null}
      {pool.error ? <p role="alert" className="mt-2 text-xs leading-6 text-down">{pool.error}</p> : null}
      <div className="mt-4 grid gap-x-6 sm:grid-cols-2">
        <DataRow label="池余额" value={formatAssetAmount(BigInt(pool.chain.poolBalance), 18) + " CaBi"} />
        <DataRow label="已组 LP 对应额度" value={formatAssetAmount(BigInt(pool.chain.allocatedUnclaimed), 18) + " CaBi"} />
        <DataRow label="已领取累计" value={formatAssetAmount(BigInt(pool.chain.totalClaimed), 18) + " CaBi"} />
        <DataRow label="已转入 LP 累计" value={formatAssetAmount(BigInt(pool.chain.totalLpTokens), 18) + " CaBi"} />
        <DataRow label="用户已支付 USDT 累计" value={formatAssetAmount(BigInt(pool.chain.totalUsdtCharged), pool.chain.usdtDecimals) + " USDT"} />
        <DataRow label="待领额度（服务器聚合）" value={formatAssetAmount(BigInt(pool.entitlements.outstanding), 18) + " CaBi / " + pool.entitlements.addresses + " 个地址"} />
        <DataRow label="领取规则" value="支付 30% USDT，30% CaBi 自动进 LP，领取开放后到账 70%" />
        <DataRow label="LP 接收地址" value={pool.chain.lpReady ? pool.chain.lpReceiver : "未配置（领取不可用）"} />
        <DataRow label="USDT" value={pool.chain.usdt || "—"} />
        <DataRow label="代币 owner" value={pool.chain.owner} />
        <DataRow label="链上 signer" value={pool.chain.signer} />
        <DataRow label="签名服务" value={pool.signing?.signerMatches ? "已匹配" : pool.signing?.configured ? "未匹配" : "未配置"} />
      </div>
      {!pool.chain.lpReady ? <p className="mt-2 text-xs leading-6 text-down">LP 接收地址或 USDT 未配置，用户暂不能组 LP。</p> : null}
      {!pool.signing?.configured ? <p className="mt-2 text-xs leading-6 text-down">服务器签名密钥未配置，用户暂不能申请组 LP 授权。</p> : null}
      <p className="mt-3 rounded-lg border border-dashed border-line bg-well p-3 text-xs leading-6 text-mute">组 LP 不由服务器代付，也不需要管理员逐批操作。服务器只签发额度授权；用户在自己的钱包确认 USDT 授权和组 LP 交易。领取开放后，用户再次确认 claim 交易即可到账。</p>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs">
        <thead className="border-b border-line text-mute"><tr><th className="py-2 pr-3">地址</th><th className="pr-3">累计应得</th><th className="pr-3">已组额度</th><th className="pr-3">待组/待领</th><th>来源</th></tr></thead>
        <tbody className="divide-y divide-line">{pool.entitlements.rows.length ? pool.entitlements.rows.slice(0, 50).map(row => <tr key={row.address}><td className="py-2 pr-3 font-mono">{row.address}</td><td className="pr-3">{formatAssetAmount(BigInt(row.tokens), 18)}</td><td className="pr-3">{formatAssetAmount(BigInt(row.chainClaimed), 18)}</td><td className="pr-3">{formatAssetAmount(BigInt(row.outstanding), 18)}</td><td className="text-mute">{row.reason.join(" + ")}</td></tr>) : <tr><td colSpan={5} className="py-4 text-mute">暂无待组 LP 额度</td></tr>}</tbody>
      </table></div>
      <button onClick={() => void loadPool()} disabled={Boolean(busy)} className="btn btn-outline mt-4 min-h-10 px-3 text-xs"><RefreshCw size={12} />刷新领取池</button>
    </Card> : null}
    {pool && pool.mode !== "signed" ? <Card>
      <SectionHead title="领取池" desc="当前领取池未按用户自动组 LP 流程就绪" />
      <p className="mt-3 text-xs leading-6 text-mute">{pool.mode === "unconfigured" ? "领取池尚未配置，请填写 NEXT_PUBLIC_CLAIM_POOL_ADDRESS 并重新构建。" : pool.error || "领取池暂时不可读。"}{poolError ? "（" + poolError + "）" : ""}</p>
    </Card> : null}    {message ? <p role="status" className="text-xs leading-6 text-up">{message}</p> : null}
    {error ? <p role="alert" className="text-xs leading-6 text-down">{error}</p> : null}
  </div>;
}

