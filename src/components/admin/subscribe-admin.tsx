"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink, Loader2, Play, RefreshCw, Save } from "lucide-react";
import { formatAssetAmount } from "@/lib/amounts";
import { Badge, Card, DataRow, Progress, SectionHead } from "@/components/dapp/ui";

interface SubscriptionRow { id: string; address: string; shares: number; amount: string; txHash: string; status: string; createdAt: number }
interface ListResponse { items: SubscriptionRow[]; total: number; page: number; pageSize: number; globalSold: number; hardCap: number; subscribeLocked: boolean; subscribePayee: string; error?: string }
interface MerkleBatch {
  id: string; epoch: number; root: string; status: string; addresses: number; total: string;
  txHash: string | null; note: string | null; createdAt: number; appliedAt: number | null;
}
interface BatchResponse { items: MerkleBatch[]; total: number; page: number; pageSize: number; error?: string }
interface ClaimPoolResponse {
  mode: "merkle" | "unconfigured" | "error";
  pool: string | null; error?: string;
  chain?: {
    owner: string; pendingOwner: string; usdt: string; lpReceiver: string; usdtDecimals: number;
    merkleRoot: string; epoch: number; lpReady: boolean;
    poolBalance: string; totalClaimed: string; totalLpTokens: string; totalUsdtCharged: string;
  };
  batch: MerkleBatch | null;
  entitlements: { total: string; outstanding: string; addresses: number; rows: Array<{ address: string; tokens: string; chainClaimed: string; outstanding: string; reason: string[] }> };
}
interface GeneratedResponse {
  error?: string; batch?: MerkleBatch; epoch?: number; root?: string; calldata?: string; instruction?: string;
  exportUrl?: string; items?: Array<{ address: string; amount: string; proof: string[] }>;
}
interface PublishResponse { error?: string; claimPool?: string | null; calldata?: string; instruction?: string }
const emptyList: ListResponse = { items: [], total: 0, page: 1, pageSize: 10, globalSold: 0, hardCap: 20000, subscribeLocked: true, subscribePayee: "" };
const emptyBatches: BatchResponse = { items: [], total: 0, page: 1, pageSize: 10 };

function time(value: number) { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }
function statusLabel(status: string) { return status === "applied" ? "已上链" : status === "failed" ? "发布失败" : "待发布"; }

// 纯读取函数放在组件外，effect 里只在异步回调中写状态。
async function fetchSubscriptions(next: number, nextQ: string): Promise<ListResponse> {
  const response = await fetch(`/api/admin/subscriptions?q=${encodeURIComponent(nextQ)}&page=${next}&pageSize=10`, { cache: "no-store" });
  const body = await response.json().catch(() => ({ error: "认购单读取失败" })) as ListResponse;
  if (!response.ok) throw new Error(body.error || "认购单读取失败");
  return body;
}
async function fetchBatches(next = 1): Promise<BatchResponse> {
  const response = await fetch(`/api/admin/claim-batches?page=${next}`, { cache: "no-store" });
  const body = await response.json().catch(() => ({ error: "批次读取失败" })) as BatchResponse;
  if (!response.ok) throw new Error(body.error || "批次读取失败");
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
  const [batches, setBatches] = useState<BatchResponse>(emptyBatches);
  const [pool, setPool] = useState<ClaimPoolResponse | null>(null), [poolError, setPoolError] = useState("");
  const [generated, setGenerated] = useState<GeneratedResponse | null>(null);
  const [q, setQ] = useState(""), [page, setPage] = useState(1);
  const [payee, setPayee] = useState("");
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [hashDraft, setHashDraft] = useState<Record<string, string>>({});

  async function loadSubscriptions(next = page, nextQ = q) {
    const body = await fetchSubscriptions(next, nextQ);
    setList(body);
    setPayee(prev => prev || body.subscribePayee || "");
  }
  async function loadBatches(next = 1) { setBatches(await fetchBatches(next)); }
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
        return fetchBatches(1);
      })
      .then(body => { if (!cancelled && body) setBatches(body); })
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
      setMessage("已保存。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败"); }
    finally { setBusy(""); }
  }
  async function generateRoot() {
    if (busy) return;
    setBusy("generate"); setError(""); setMessage(""); setGenerated(null);
    try {
      const response = await fetch("/api/admin/claim-batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generate" }) });
      const body = await response.json().catch(() => ({ error: "生成失败" })) as GeneratedResponse;
      if (!response.ok || !body.batch) throw new Error(body.error || "生成失败");
      setGenerated(body);
      setMessage(`已生成批次 #${body.epoch}：${body.batch.addresses} 个地址，累计应得 ${formatAssetAmount(BigInt(body.batch.total), 18)} CaBi。请由 owner 钱包发布 root，再回到本页登记交易哈希。`);
      await loadBatches(1); await loadPool();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "生成失败"); }
    finally { setBusy(""); }
  }
  async function publishCalldata(batch: MerkleBatch) {
    if (busy) return;
    setBusy(batch.id); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/claim-pool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "publish", batchId: batch.id }) });
      const body = await response.json().catch(() => ({ error: "生成发布数据失败" })) as PublishResponse;
      if (!response.ok || !body.calldata) throw new Error(body.error || "生成发布数据失败");
      setGenerated(prev => ({ ...(prev || {}), batch, epoch: batch.epoch, root: batch.root, calldata: body.calldata, instruction: body.instruction }));
      setMessage("已生成 setMerkleRoot 的 calldata 并记录审计；请在 owner 钱包中执行。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "生成发布数据失败"); }
    finally { setBusy(""); }
  }
  async function mark(batch: MerkleBatch, status: "applied" | "failed") {
    if (busy) return;
    const txHash = (hashDraft[batch.id] || "").trim();
    if (status === "applied" && !/^0x[0-9a-fA-F]{64}$/.test(txHash)) { setError("请先填写有效的上链交易哈希。"); return; }
    setBusy(batch.id); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/admin/claim-batches/${encodeURIComponent(batch.id)}/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(status === "applied" ? { txHash } : { status }) });
      const body = await response.json().catch(() => ({ error: "登记失败" })) as { error?: string; idempotent?: boolean };
      if (!response.ok) throw new Error(body.error || "登记失败");
      setMessage(body.idempotent ? "该批次已登记，本次操作未重复发布。" : status === "applied" ? "已登记交易哈希，批次标记为已上链。" : "已标记发布失败，可重新生成批次。");
      await loadBatches(batches.page); await loadPool();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "登记失败"); }
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
      <SectionHead title="认购收款地址" desc="用户把 USDT 直接转到该地址；服务器核验交易成功、2 次确认、from/to/金额一致后才记账" />
      <DataRow label="当前地址" value={list.subscribePayee || "未设置"} />
      <div className="mt-3 flex flex-col gap-3 sm:flex-row"><input aria-label="认购收款地址" value={payee} onChange={event => setPayee(event.target.value)} placeholder="0x…（BSC 上的 USDT 收款地址）" className="field min-h-11 w-full min-w-0 px-3 font-mono text-xs" /><button onClick={() => void saveSettings({ subscribePayee: payee }, "payee")} disabled={busy === "payee"} className="btn btn-gold min-h-11 shrink-0 px-4 text-xs">{busy === "payee" ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}保存收款地址</button></div>
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

    {pool?.mode === "merkle" && pool.chain ? <Card>
      <SectionHead title="领取池（Merkle 自领）" desc="额度按认购单 + 直推奖励 + 团队极差自动聚合；领取只有一条路径：支付 30% USDT 组 LP、30% 代币进 LP、70% 到账用户。服务器不持有私钥，只返回 proof" />
      {poolError ? <p role="alert" className="mt-2 text-xs leading-6 text-down">{poolError}</p> : null}
      {pool.error ? <p className="mt-2 text-xs leading-6 text-down">{pool.error}</p> : null}
      <div className="mt-4 grid gap-x-6 sm:grid-cols-2">
        <DataRow label="池余额" value={formatAssetAmount(BigInt(pool.chain.poolBalance), 18) + " CaBi"} />
        <DataRow label="已领取累计" value={formatAssetAmount(BigInt(pool.chain.totalClaimed), 18) + " CaBi"} />
        <DataRow label="已转入 LP 累计" value={formatAssetAmount(BigInt(pool.chain.totalLpTokens), 18) + " CaBi"} />
        <DataRow label="用户已支付 USDT 累计" value={formatAssetAmount(BigInt(pool.chain.totalUsdtCharged), pool.chain.usdtDecimals) + " USDT"} />
        <DataRow label="链上批次 / epoch" value={pool.chain.merkleRoot === `0x${"0".repeat(64)}` ? "尚未发布" : `#${pool.chain.epoch}`} />
        <DataRow label="当前 root" value={pool.chain.merkleRoot === `0x${"0".repeat(64)}` ? "—" : pool.chain.merkleRoot.slice(0, 18) + "…"} />
        <DataRow label="待领额度（服务器聚合）" value={formatAssetAmount(BigInt(pool.entitlements.outstanding), 18) + " CaBi / " + pool.entitlements.addresses + " 个地址"} />
        <DataRow label="领取规则" value="强制组 LP：支付 30% USDT，30% 代币进 LP，70% 到账" />
        <DataRow label="LP 接收地址" value={pool.chain.lpReady ? pool.chain.lpReceiver : "未配置（用户无法领取）"} />
        <DataRow label="USDT" value={pool.chain.usdt || "—"} />
        <DataRow label="owner" value={pool.chain.owner} />
        <DataRow label="待交接 owner" value={pool.chain.pendingOwner === `0x${"0".repeat(40)}` ? "—" : pool.chain.pendingOwner} />
      </div>
      {!pool.chain.lpReady ? <p className="mt-2 text-xs leading-6 text-down">LP 接收地址或 USDT 未配置：用户领取会直接失败，请先由 owner 调用 setLpReceiver / setUsdt。</p> : null}
      {pool.batch && !pool.batch.txHash ? <p className="mt-2 text-xs leading-6 text-mute">检测到待发布批次 #{pool.batch.epoch}，root 已生成但尚未登记上链哈希。</p> : null}
      <p className="mt-3 rounded-lg border border-dashed border-line bg-well p-3 text-xs leading-6 text-mute">额度按「已核验认购单 + 直推 + 极差」实时聚合。生成批次后，owner 用<strong>自己的钱包</strong>调用 <code>setMerkleRoot(root, epoch)</code>；所有领取由用户钱包带 proof 调用 <code>claim</code>，重复领取与旧批次 proof 都会被合约拒绝。每次重新生成批次都会推进 epoch，旧 proof 立即失效。</p>
      <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => void generateRoot()} disabled={Boolean(busy)} className="btn btn-gold min-h-11 px-4 text-xs">{busy === "generate" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}生成 root 与 proof</button><button onClick={() => void loadPool().then(() => loadBatches(batches.page))} disabled={Boolean(busy)} className="btn btn-outline min-h-11 px-4 text-xs"><RefreshCw size={13} />刷新领取池</button></div>
      {generated?.root ? <div className="mt-3 rounded-lg border border-line bg-well p-3 text-xs leading-6">
        <p className="break-all"><strong>root：</strong><span className="font-mono">{generated.root}</span></p>
        <p><strong>epoch：</strong>{generated.epoch}</p>
        {generated.calldata ? <p className="break-all font-mono"><strong>calldata：</strong>{generated.calldata}</p> : null}
        {generated.instruction ? <p className="mt-1 text-mute">{generated.instruction}</p> : null}
        {generated.batch ? <a href={`/api/admin/claim-batches/${encodeURIComponent(generated.batch.id)}/export`} className="btn btn-outline mt-2 min-h-10 px-3 text-xs"><Download size={12} />下载 address / tokens / proof CSV</a> : null}
      </div> : null}
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs">
        <thead className="border-b border-line text-mute"><tr><th className="py-2 pr-3">地址</th><th className="pr-3">累计应得</th><th className="pr-3">链上已领</th><th className="pr-3">待领</th><th>来源</th></tr></thead>
        <tbody className="divide-y divide-line">{pool.entitlements.rows.length ? pool.entitlements.rows.slice(0, 50).map(row => <tr key={row.address}><td className="py-2 pr-3 font-mono">{row.address}</td><td className="pr-3">{formatAssetAmount(BigInt(row.tokens), 18)}</td><td className="pr-3">{formatAssetAmount(BigInt(row.chainClaimed), 18)}</td><td className="pr-3">{formatAssetAmount(BigInt(row.outstanding), 18)}</td><td className="text-mute">{row.reason.join(" + ")}</td></tr>) : <tr><td colSpan={5} className="py-4 text-mute">暂无待领额度（还没有已确认的认购单或奖励）</td></tr>}</tbody>
      </table></div>
      <p className="mt-2 text-[11px] text-mute">仅显示前 50 行，共 {pool.entitlements.addresses} 个地址；如需修正额度，应修正认购单或奖励结算数据后重新生成批次，而不是直接改链上余额。</p>
      <div className="mt-5 border-t border-line pt-4">
        <SectionHead title="批次记录" desc="owner 发布 root 后登记交易哈希；重复登记不会重复发布" />
        <div className="mt-3 space-y-3">{batches.items.length ? batches.items.map(batch => <div key={batch.id} className="rounded-lg border border-line bg-well p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="break-all font-mono">#{batch.epoch} · {batch.id}</p><Badge tone={batch.status === "applied" ? "green" : batch.status === "failed" ? "red" : "gray"}>{statusLabel(batch.status)}</Badge></div>
          <div className="mt-2 grid gap-x-4 sm:grid-cols-2"><DataRow label="地址数" value={String(batch.addresses)} /><DataRow label="累计应得合计" value={formatAssetAmount(BigInt(batch.total), 18) + " CaBi"} /><DataRow label="root" value={batch.root.slice(0, 22) + "…"} /><DataRow label="生成时间" value={time(batch.createdAt)} /></div>
          <div className="mt-2 flex flex-wrap gap-2"><a href={`/api/admin/claim-batches/${encodeURIComponent(batch.id)}/export`} className="btn btn-outline min-h-10 px-3 text-xs"><Download size={12} />下载名单</a><button onClick={() => void publishCalldata(batch)} disabled={Boolean(busy)} className="btn btn-outline min-h-10 px-3 text-xs">生成发布 calldata</button>{batch.txHash ? <a href={`https://bscscan.com/tx/${batch.txHash}`} target="_blank" rel="noreferrer" className="btn btn-outline min-h-10 px-3 text-xs"><ExternalLink size={12} />查看交易</a> : null}{batch.status !== "applied" ? <><input aria-label={`批次 ${batch.id} 交易哈希`} value={hashDraft[batch.id] || ""} onChange={event => setHashDraft(prev => ({ ...prev, [batch.id]: event.target.value }))} placeholder="上链交易哈希 0x…" className="field min-h-10 min-w-[220px] flex-1 px-2 font-mono text-[11px]" /><button onClick={() => void mark(batch, "applied")} disabled={busy === batch.id} className="btn btn-gold min-h-10 px-3 text-xs">登记哈希</button><button onClick={() => void mark(batch, "failed")} disabled={busy === batch.id} className="btn btn-outline min-h-10 px-3 text-xs">标记失败</button></> : null}</div>
        </div>) : <p className="text-xs text-mute">暂无批次。确认认购单与领取池地址后，先生成 root。</p>}</div>
      </div>
    </Card> : null}
    {pool && pool.mode !== "merkle" ? <Card>
      <SectionHead title="领取池" desc="Merkle 自领：owner 发布 root，用户带 proof 自领" />
      <p className="mt-3 text-xs leading-6 text-mute">{pool.mode === "unconfigured" ? "领取池尚未配置：部署 CaBiMerkleClaimPool 后填写 NEXT_PUBLIC_CLAIM_POOL_ADDRESS，并重新构建前端。" : pool.error || "领取池暂时不可读。"}{poolError ? "（" + poolError + "）" : ""}</p>
    </Card> : null}
    {message ? <p role="status" className="text-xs leading-6 text-up">{message}</p> : null}
    {error ? <p role="alert" className="text-xs leading-6 text-down">{error}</p> : null}
  </div>;
}
