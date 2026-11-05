"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink, Loader2, Play, RefreshCw, Save } from "lucide-react";
import { formatAssetAmount } from "@/lib/amounts";
import { Badge, Card, DataRow, Progress, SectionHead } from "@/components/dapp/ui";

interface SubscriptionRow { id: string; address: string; shares: number; amount: string; txHash: string; status: string; createdAt: number }
interface ListResponse { items: SubscriptionRow[]; total: number; page: number; pageSize: number; globalSold: number; hardCap: number; subscribeLocked: boolean; subscribePayee: string; error?: string }
interface ClaimBatch { id: string; status: string; addresses: number; total: string; txHash: string | null; note: string | null; createdAt: number; appliedAt: number | null }
interface BatchResponse { items: ClaimBatch[]; total: number; page: number; pageSize: number; error?: string }
interface ClaimPoolResponse {
  mode: "signed" | "legacy" | "unconfigured" | "error";
  pool: string | null; error?: string;
  chain?: { owner: string; signer: string; usdt: string; lpReceiver: string; usdtDecimals: number; poolBalance: string; totalClaimed: string; totalLpTokens: string; totalUsdtCharged: string; allocatedUnclaimed: string; unusedBalance: string; lpReady: boolean };
  signing: { configured: boolean; signer: string | null; claimPool: string | null; chainId: number; ttlSeconds: number; rateLimitPerMinute: number; signerMatches?: boolean };
  entitlements: { total: string; outstanding: string; addresses: number; rows: Array<{ address: string; tokens: string; chainClaimed: string; outstanding: string; reason: string[] }> };
}
interface HandoverResponse { signer: string; calldata: string; instruction: string; error?: string }
const emptyList: ListResponse = { items: [], total: 0, page: 1, pageSize: 10, globalSold: 0, hardCap: 20000, subscribeLocked: true, subscribePayee: "" };
const emptyBatches: BatchResponse = { items: [], total: 0, page: 1, pageSize: 10 };

function time(value: number) { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }
function statusLabel(status: string) { return status === "applied" ? "已写入" : status === "failed" ? "失败待重试" : "待写入"; }

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
  const [handoverSigner, setHandoverSigner] = useState(""), [handoverAccepted, setHandoverAccepted] = useState(false);
  const [handover, setHandover] = useState<HandoverResponse | null>(null);
  const [q, setQ] = useState(""), [page, setPage] = useState(1);
  const [payee, setPayee] = useState("");
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [hashDraft, setHashDraft] = useState<Record<string, string>>({});

  async function loadSubscriptions(next = page, nextQ = q) {
    const body = await fetchSubscriptions(next, nextQ);
    setList(body);
    setPayee(prev => prev || body.subscribePayee || "");
  }
  async function loadBatches(next = 1) {
    setBatches(await fetchBatches(next));
  }
  async function loadPool() {
    try { setPool(await fetchClaimPool()); setPoolError(""); }
    catch (cause) { setPoolError(cause instanceof Error ? cause.message : "领取池读取失败"); }
  }
  async function submitHandover() {
    if (busy || !handoverAccepted) return;
    setBusy("handover"); setError(""); setMessage(""); setHandover(null);
    try {
      const response = await fetch("/api/admin/claim-pool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "handover", signer: handoverSigner.trim() }) });
      const body = await response.json().catch(() => ({ error: "提交失败" })) as HandoverResponse;
      if (!response.ok) throw new Error(body.error || "提交失败");
      setHandover(body); setMessage("权限交接已记录审计；请由 owner 钱包执行 setSigner。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "提交失败"); }
    finally { setBusy(""); }
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
      const response = await fetch("/api/admin/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const body = await response.json().catch(() => ({ error: "保存失败" })) as { error?: string; settings?: { subscribePayee: string; subscribeLocked: boolean } };
      if (!response.ok) throw new Error(body.error || "保存失败");
      if (body.settings) { setPayee(body.settings.subscribePayee || ""); setList(prev => ({ ...prev, subscribePayee: body.settings!.subscribePayee || "", subscribeLocked: body.settings!.subscribeLocked })); }
      setMessage("已保存。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败"); }
    finally { setBusy(""); }
  }
  async function generateBatch() {
    if (busy) return;
    setBusy("generate"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/claim-batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generate" }) });
      const body = await response.json().catch(() => ({ error: "生成失败" })) as { error?: string; batch?: ClaimBatch; items?: Array<{ address: string; amount: string }>; skipped?: string[] };
      if (!response.ok || !body.batch) throw new Error(body.error || "生成失败");
      setMessage(`已生成批次 ${body.batch.id}：${body.batch.addresses} 个地址，${formatAssetAmount(BigInt(body.batch.total), 18)} CaBi${body.skipped?.length ? `；已领取跳过 ${body.skipped.length} 个` : ""}。请下载名单并用离线脚本写入。`);
      await loadBatches(1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "生成失败"); }
    finally { setBusy(""); }
  }
  async function mark(batch: ClaimBatch, status: "applied" | "failed") {
    if (busy) return;
    const txHash = (hashDraft[batch.id] || "").trim();
    if (status === "applied" && !/^0x[0-9a-fA-F]{64}$/.test(txHash)) { setError("请先填写有效的写入交易哈希。"); return; }
    setBusy(batch.id); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/admin/claim-batches/${encodeURIComponent(batch.id)}/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(status === "applied" ? { txHash } : { status }) });
      const body = await response.json().catch(() => ({ error: "登记失败" })) as { error?: string; idempotent?: boolean };
      if (!response.ok) throw new Error(body.error || "登记失败");
      setMessage(body.idempotent ? "该批次已写入，本次登记未产生重复发放。" : status === "applied" ? "已登记交易哈希，批次标记为已写入。" : "已标记失败，可重新生成批次。");
      await loadBatches(batches.page);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "登记失败"); }
    finally { setBusy(""); }
  }
  const percent = list.hardCap > 0 ? Math.min(100, list.globalSold * 100 / list.hardCap) : 0;
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  return <div className="space-y-5">
    <Card>
      <SectionHead title="认购管理" desc="USDT 直接转账 + 服务器核验记账；页面不保存任何 owner 私钥" />
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

    {pool?.mode === "signed" ? <Card>
      <SectionHead title="领取池（签名自领）" desc="额度按认购单 + 直推奖励 + 团队极差自动聚合；领取只有一条路径：支付 30% USDT 组 LP、30% 代币进 LP、70% 到账用户。服务器 signer 只签发一次性领取授权，用户自己去池里领取" />
      {poolError ? <p role="alert" className="mt-2 text-xs leading-6 text-down">{poolError}</p> : null}
      {pool.error ? <p className="mt-2 text-xs leading-6 text-down">{pool.error}</p> : null}
      <div className="mt-4 grid gap-x-6 sm:grid-cols-2">
        <DataRow label="池余额" value={pool.chain ? formatAssetAmount(BigInt(pool.chain.poolBalance), 18) + " CaBi" : "—"} />
        <DataRow label="已领取累计" value={pool.chain ? formatAssetAmount(BigInt(pool.chain.totalClaimed), 18) + " CaBi" : "—"} />
        <DataRow label="已转入 LP 累计" value={pool.chain ? formatAssetAmount(BigInt(pool.chain.totalLpTokens), 18) + " CaBi" : "—"} />
        <DataRow label="用户已支付 USDT 累计" value={pool.chain ? formatAssetAmount(BigInt(pool.chain.totalUsdtCharged), pool.chain.usdtDecimals) + " USDT" : "—"} />
        <DataRow label="可提回未分配" value={pool.chain ? formatAssetAmount(BigInt(pool.chain.unusedBalance), 18) + " CaBi" : "—"} />
        <DataRow label="待领额度（服务器聚合）" value={formatAssetAmount(BigInt(pool.entitlements.outstanding), 18) + " CaBi / " + pool.entitlements.addresses + " 个地址"} />
        <DataRow label="已分配未领（链上限额）" value={pool.chain ? formatAssetAmount(BigInt(pool.chain.allocatedUnclaimed), 18) + " CaBi" : "—"} />
        <DataRow label="签名服务" value={pool.signing.configured ? "已配置（可签发授权）" : "未配置（领取按钮会被禁用）"} />
        <DataRow label="服务器 signer" value={pool.signing.signer || "—"} />
        <DataRow label="链上 signer" value={pool.chain?.signer || "—"} />
        <DataRow label="领取规则" value="强制组 LP：支付 30% USDT，30% 代币进 LP，70% 到账" />
        <DataRow label="LP 接收地址" value={pool.chain?.lpReady ? pool.chain.lpReceiver : "未配置（用户无法领取）"} />
        <DataRow label="USDT" value={pool.chain?.usdt || "—"} />
        <DataRow label="owner" value={pool.chain?.owner || "—"} />
      </div>
      {pool.signing.configured && pool.chain && !pool.signing.signerMatches ? <p className="mt-2 text-xs leading-6 text-down">服务器 signer 与链上 signer 不一致：用户领取会失败，请立即完成权限交接或更新密钥。</p> : null}
      <p className="mt-3 rounded-lg border border-dashed border-line bg-well p-3 text-xs leading-6 text-mute">额度不需要逐人写入：用户每次请求领取时，服务器按「认购单 + 直推 + 极差」实时聚合，扣减链上已领与本地回执后签发 <code>amount</code>；nonce 单调递增且一次性使用，因此同一额度不会被重复签发。修改认购单或奖励结算后，额度会自动跟着变化。</p>
      <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => void loadPool()} disabled={Boolean(busy)} className="btn btn-outline min-h-11 px-4 text-xs"><RefreshCw size={13} />刷新领取池</button></div>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs">
        <thead className="border-b border-line text-mute"><tr><th className="py-2 pr-3">地址</th><th className="pr-3">应得额度</th><th className="pr-3">链上已领</th><th className="pr-3">待领</th><th>来源</th></tr></thead>
        <tbody className="divide-y divide-line">{pool.entitlements.rows.length ? pool.entitlements.rows.slice(0, 50).map(row => <tr key={row.address}><td className="py-2 pr-3 font-mono">{row.address}</td><td className="pr-3">{formatAssetAmount(BigInt(row.tokens), 18)}</td><td className="pr-3">{formatAssetAmount(BigInt(row.chainClaimed), 18)}</td><td className="pr-3">{formatAssetAmount(BigInt(row.outstanding), 18)}</td><td className="text-mute">{row.reason.join(" + ")}</td></tr>) : <tr><td colSpan={5} className="py-4 text-mute">暂无待领额度（还没有已确认的认购单或奖励）</td></tr>}</tbody>
      </table></div>
      <p className="mt-2 text-[11px] text-mute">仅显示前 50 行，共 {pool.entitlements.addresses} 个地址；如需修正额度，应修正认购单或奖励结算数据后重新聚合，而不是直接改链上余额。</p>
      <div className="mt-5 border-t border-line pt-4">
        <SectionHead title="权限交接（换 signer）" desc="owner 私钥不进入 Web 服务：这里只生成 setSigner 的 calldata 并写审计，由 owner 钱包执行" />
        <input aria-label="新的 signer 地址" value={handoverSigner} onChange={event => { setHandoverSigner(event.target.value); setHandoverAccepted(false); setHandover(null); }} placeholder="0x…（新的签名服务地址，需与服务器 CLAIM_SIGNER_PRIVATE_KEY 对应）" className="field mt-3 min-h-11 w-full px-3 font-mono text-xs" />
        <label className="mt-3 flex items-start gap-2 text-xs leading-6 text-mute"><input aria-label="确认权限交接" type="checkbox" checked={handoverAccepted} onChange={event => setHandoverAccepted(event.target.checked)} className="mt-1.5 h-4 w-4 shrink-0" />我已确认：切换后旧 signer 的未领取授权立即失效，且必须同步更新服务器密钥并重启。</label>
        <button onClick={() => void submitHandover()} disabled={Boolean(busy) || !handoverAccepted} className="btn btn-gold mt-3 min-h-11 px-4 text-xs">{busy === "handover" ? <Loader2 size={13} className="animate-spin" /> : null}提交交接（写审计）</button>
        {handover ? <div className="mt-3 rounded-lg border border-line bg-well p-3 text-xs leading-6"><p className="break-all font-mono">目标 signer：{handover.signer}</p><p className="break-all font-mono">calldata：{handover.calldata}</p><p className="mt-1 text-mute">{handover.instruction}</p></div> : null}
      </div>
    </Card> : pool?.mode === "legacy" || !pool ? <Card>
      <SectionHead title="可领额度生成与写入（备用方案）" desc="仅在仍使用旧版 CaBiSimpleClaimPool 批量写入时可用；新版签名自领主路径不需要此步骤" />
      <p className="mt-3 rounded-lg border border-dashed border-line bg-well p-3 text-xs leading-6 text-mute">推荐流程：生成批次 → 下载 <code>address,amount</code> 名单 → 在独立进程运行 <code>node scripts/push-claimable.cjs &lt;csv&gt; --send</code>（私钥只放在该进程环境变量）→ 回到本页登记交易哈希。Web 服务与浏览器都不会接触 owner 私钥。</p>
      <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => void generateBatch()} disabled={Boolean(busy)} className="btn btn-gold min-h-11 px-4 text-xs">{busy === "generate" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}生成增量批次</button><button onClick={() => void loadBatches(batches.page)} disabled={Boolean(busy)} className="btn btn-outline min-h-11 px-4 text-xs"><RefreshCw size={13} />刷新批次</button></div>
      <div className="mt-4 space-y-3">{batches.items.length ? batches.items.map(batch => <div key={batch.id} className="rounded-lg border border-line bg-well p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="break-all font-mono">{batch.id}</p><Badge tone={batch.status === "applied" ? "green" : batch.status === "failed" ? "red" : "gray"}>{statusLabel(batch.status)}</Badge></div>
        <div className="mt-2 grid gap-x-4 sm:grid-cols-2"><DataRow label="地址数" value={String(batch.addresses)} /><DataRow label="本次总额" value={formatAssetAmount(BigInt(batch.total), 18) + " CaBi"} /><DataRow label="交易哈希" value={batch.txHash ? batch.txHash.slice(0, 18) + "…" : "—"} /><DataRow label="生成时间" value={time(batch.createdAt)} /></div>
        <div className="mt-2 flex flex-wrap gap-2"><a href={`/api/admin/claim-batches/${encodeURIComponent(batch.id)}/export`} className="btn btn-outline min-h-10 px-3 text-xs"><Download size={12} />下载名单</a>{batch.txHash ? <a href={`https://bscscan.com/tx/${batch.txHash}`} target="_blank" rel="noreferrer" className="btn btn-outline min-h-10 px-3 text-xs"><ExternalLink size={12} />查看交易</a> : null}{batch.status !== "applied" ? <><input aria-label={`批次 ${batch.id} 交易哈希`} value={hashDraft[batch.id] || ""} onChange={event => setHashDraft(prev => ({ ...prev, [batch.id]: event.target.value }))} placeholder="写入交易哈希 0x…" className="field min-h-10 min-w-[220px] flex-1 px-2 font-mono text-[11px]" /><button onClick={() => void mark(batch, "applied")} disabled={busy === batch.id} className="btn btn-gold min-h-10 px-3 text-xs">登记哈希</button><button onClick={() => void mark(batch, "failed")} disabled={busy === batch.id} className="btn btn-outline min-h-10 px-3 text-xs">标记失败</button></> : null}</div>
      </div>) : <p className="text-xs text-mute">暂无批次。先确认认购单和领取池地址，再生成。</p>}</div>
    </Card> : null}
    {pool && pool.mode !== "signed" && pool.mode !== "legacy" ? <p className="text-xs leading-6 text-mute">{pool.mode === "unconfigured" ? "领取池尚未配置：部署 CaBiSignedClaimPool 后填写 NEXT_PUBLIC_CLAIM_POOL_ADDRESS。" : pool.error || "领取池暂时不可读。"}{poolError ? "（" + poolError + "）" : ""}</p> : null}
    {message ? <p role="status" className="text-xs leading-6 text-up">{message}</p> : null}
    {error ? <p role="alert" className="text-xs leading-6 text-down">{error}</p> : null}
  </div>;
}
