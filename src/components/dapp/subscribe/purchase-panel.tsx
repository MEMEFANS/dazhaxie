"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { erc20Abi, parseUnits } from "viem";
import { Check, Copy, Wallet } from "lucide-react";
import { useStore } from "@/lib/store";
import { chainConfig } from "@/lib/chain-config";
import { formatAssetAmount } from "@/lib/amounts";
import { fetchUsdtBalance, useSubscribeConfig, useSubscribeOrders } from "@/lib/subscribe-data";
import { fetchReferralData, useReferralData } from "@/lib/referral-data";
import { TransactionFeedback, useContractTransaction } from "@/lib/contract-transactions";
import { Badge, Card, DataRow, QtyStepper } from "@/components/dapp/ui";

export function PurchasePanel() {
  const { state } = useStore();
  return <PurchasePanelForm key={[state.connected, state.address.toLowerCase(), state.chainId].join(":")} />;
}

function PurchasePanelForm() {
  const { state, connect } = useStore();
  const query = useSubscribeConfig(state.connected ? state.address : undefined), data = query.data;
  const referral = useReferralData(state.connected ? state.address : undefined), relation = referral.data;
  const orders = useSubscribeOrders(state.connected);
  const tx = useContractTransaction("subscribe-transfer");
  const mounted = useRef(false), operation = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [checking, setChecking] = useState(false);
  const [quantity, setQuantity] = useState(1), [accepted, setAccepted] = useState(""), [error, setError] = useState("");
  const [balance, setBalance] = useState<bigint | undefined>();
  const [serverState, setServerState] = useState<"idle" | "verifying" | "success" | "failed">("idle");
  const [serverMessage, setServerMessage] = useState("");
  const [pending, setPending] = useState<{ hash: string; shares: number } | null>(null);
  const [copied, setCopied] = useState(false);

  async function verifyOnServer(hash: string, shares: number): Promise<Response> {
    return fetch("/api/subscribe/orders", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ shares, hash }),
    });
  }
  function reportServerResult(response: Response, body: { error?: string }, hash: string, shares: number) {
    if (response.status === 202) { setServerState("verifying"); setServerMessage(body.error || "等待区块确认，请稍后点击重新核验。"); return false; }
    if (!response.ok) { setServerState("failed"); setServerMessage(body.error || "认购核验未通过，请核对后重试。"); setPending(null); return false; }
    setServerState("success"); setServerMessage(`认购单已登记：${shares} 份，交易 ${hash.slice(0, 10)}…`); setPending(null);
    setConfirmed(false); setQuantity(1); void query.refresh(); orders.refresh();
    return true;
  }

  useEffect(() => {
    if (!state.connected || !data?.usdt) return;
    let active = true;
    void fetchUsdtBalance(state.address, data.usdt).then(value => { if (active) setBalance(value); }, () => { if (active) setBalance(undefined); });
    return () => { active = false; };
  }, [state.connected, state.address, data?.usdt, data?.globalSold, orders.orders.length]);

  useEffect(() => {
    if (tx.transaction?.status === "success") { void query.refresh(); orders.refresh(); }
  }, [tx.transaction?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const bound = referral.status === "ready" && Boolean(relation?.bound) && relation?.account.toLowerCase() === state.address.toLowerCase();
  const amount = data ? parseUnits(String(quantity * data.unitPrice), data.usdtDecimals) : 0n;
  const quota = data ? BigInt(quantity) * BigInt(data.tokensPerShare) * 10n ** 18n : 0n;
  const remaining = data ? Math.max(0, data.maxShares - data.purchased) : 0;
  const confirmationKey = [state.address.toLowerCase(), state.chainId, quantity, data?.unitPrice, data?.usdtDecimals, data?.payee, data?.purchased, data?.globalSold, relation?.code, relation?.referrerCode, relation?.referrer, referral.status].join(":");
  const context = useMemo(() => ({ confirmationKey }), [confirmationKey]), current = useRef<object | null>(null);
  useEffect(() => { current.current = context; return () => { current.current = null; }; }, [context]);
  const confirmed = accepted === confirmationKey;
  const setConfirmed = (value: boolean) => setAccepted(value ? confirmationKey : "");

  let reason = "";
  if (!state.connected) reason = "请连接钱包";
  else if (state.chainId !== chainConfig.id) reason = "请切换到" + chainConfig.shortName;
  else if (query.status !== "ready" || query.error || !data) reason = query.error || "正在读取认购配置";
  else if (!data.configured) reason = data.message || "等待后台设置认购收款地址";
  else if (!bound) reason = "请先在邀请入口绑定推荐关系";
  else if (!data.enabled) reason = data.message || "认购暂时关闭";
  else if (quantity > remaining) reason = "超过此钱包剩余认购份数";
  else if (quantity > data.remainingGlobal) reason = "超过全局剩余份数";
  else if (balance !== undefined && balance < amount) reason = "USDT 余额不足";
  else if (!data.payee || !data.usdt) reason = "收款地址或 USDT 配置缺失";

  async function verifyReferral() {
    const fresh = await fetchReferralData(state.address);
    if (!mounted.current || current.current !== context) throw new Error("钱包或认购状态已变化，请重新确认。");
    if (!fresh?.bound || fresh.code !== relation?.code || fresh.referrer !== relation?.referrer || fresh.root !== relation?.root) throw new Error("邀请码关系已变化或登录失效，请重新核对。");
  }

  async function submit() {
    if (reason || !data?.payee || !data.usdt || !bound || operation.current || tx.busy || !confirmed) return;
    operation.current = true; setChecking(true); setError(""); setServerState("idle"); setServerMessage("");
    try {
      await verifyReferral();
      const hash = await tx.run({
        address: data.usdt, abi: erc20Abi, functionName: "transfer",
        args: [data.payee, amount],
        description: `认购 ${quantity} 份，向收款地址转入 ${formatAssetAmount(amount, data.usdtDecimals)} USDT`,
        beforeSend: verifyReferral,
      });
      if (!hash || !mounted.current) return;
      const shares = quantity;
      setPending({ hash, shares });
      setServerState("verifying"); setServerMessage("转账已确认，服务器正在核验并写入认购单…");
      const response = await verifyOnServer(hash, shares);
      const body = await response.json().catch(() => ({}));
      const recorded = reportServerResult(response, body, hash, shares);
      if (recorded) setBalance(await fetchUsdtBalance(state.address, data.usdt).catch(() => balance));
    } catch (cause) {
      if (mounted.current) { setServerState("failed"); setPending(null); setError(cause instanceof Error ? cause.message : "认购校验失败，请重试"); }
    } finally { operation.current = false; if (mounted.current) setChecking(false); }
  }

  async function recheck() {
    if (!pending || !data?.usdt || checking || operation.current) return;
    operation.current = true; setChecking(true); setError("");
    try {
      const response = await verifyOnServer(pending.hash, pending.shares);
      const body = await response.json().catch(() => ({}));
      if (!mounted.current) return;
      if (reportServerResult(response, body, pending.hash, pending.shares)) setBalance(await fetchUsdtBalance(state.address, data.usdt).catch(() => balance));
    } catch (cause) {
      if (mounted.current) { setServerState("failed"); setServerMessage(cause instanceof Error ? cause.message : "重新核验失败，请稍后重试"); }
    } finally { operation.current = false; if (mounted.current) setChecking(false); }
  }

  async function copyPayee() {
    if (!data?.payee) return;
    try { await navigator.clipboard.writeText(data.payee); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* Clipboard may require a secure context. */ }
  }

  const busy = checking || tx.busy || serverState === "verifying" || Boolean(pending);
  return <Card className="p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="kicker">SUBSCRIBE</p><h2 className="mt-1.5 text-lg font-semibold">转账认购</h2></div><Badge tone={data?.enabled ? "green" : "gray"}>{data ? data.enabled ? "可认购" : data.locked ? "已暂停" : "等待配置" : "等待配置"}</Badge></div>
    <p className="mt-3 text-xs leading-6 text-mute">向下方收款地址转入 USDT（{data?.unitPrice ?? 50} USDT / 份），转账成功后提交交易哈希，服务器核验通过即登记认购单。整套流程不再调用认购合约。</p>
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <div className="min-w-0">
        <p className="mb-3 text-xs text-mute">每钱包限购 {data?.maxShares ?? 2} 份 · 剩余 {data ? remaining : "—"} 份</p>
        <QtyStepper value={quantity} onDecrease={() => { setQuantity(v => Math.max(1, v - 1)); setConfirmed(false); }} onIncrease={() => { setQuantity(v => Math.min(Number(data?.maxShares || 2), v + 1)); setConfirmed(false); }} />
        <div className="mt-4 rounded-lg border border-line bg-well px-4 py-2">
          <DataRow label="USDT 余额" value={balance !== undefined && data ? formatAssetAmount(balance, data.usdtDecimals) + " USDT" : "读取中…"} />
          <DataRow label="已认购" value={data ? data.purchased + " 份" : "—"} />
          <DataRow label="全局进度" value={data ? data.globalSold + " / " + data.hardCap + " 份" : "—"} />
          <DataRow label="剩余额度" value={data ? data.remainingGlobal + " 份" : "—"} />
        </div>
        <div className="mt-4 rounded-lg border border-line bg-well p-3">
          <div className="flex items-center justify-between gap-2"><p className="text-xs text-mute">认购收款地址</p><button type="button" onClick={() => void copyPayee()} disabled={!data?.payee} className="btn btn-outline min-h-9 px-2 text-[11px]">{copied ? <><Check size={12} />已复制</> : <><Copy size={12} />复制</>}</button></div>
          <p className="mt-2 break-all font-mono text-xs">{data?.payee || "等待后台设置"}</p>
          <p className="mt-2 text-[11px] leading-6 text-faint">仅转入 USDT；转错链、转错币或金额不符将无法核验。请勿重复转账。</p>
        </div>
      </div>
      <div className="min-w-0">
        <div className="rounded-lg border border-line bg-well px-4 py-2">
          <DataRow label="本次应付" value={data ? formatAssetAmount(amount, data.usdtDecimals) + " USDT" : "—"} />
          <DataRow label="代币配额" value={data ? formatAssetAmount(quota, data.tokenDecimals) + " CaBi" : "—"} />
          <DataRow label="直接领取到账" value={data ? formatAssetAmount(quota * 50n / 100n, data.tokenDecimals) + " CaBi（50%）" : "—"} />
          <DataRow label="组 LP 领取到账" value={data ? formatAssetAmount(quota * 70n / 100n, data.tokenDecimals) + " CaBi（70%）" : "—"} />
        </div>
        <div className="mt-4 rounded-lg border border-line bg-well p-3">
          <p className="text-xs text-mute">已绑定邀请码（服务器保存）</p>
          <p className="mt-2 break-all font-mono text-xs" data-referral-code>{bound ? (relation?.root ? "项目初始邀请账户" : relation?.referrerCode) : "请先在邀请入口完成绑定"}</p>
          <p className="mt-2 text-[11px] leading-6 text-faint">认购沿用已绑定关系，邀请链接不能覆盖推荐人。</p>
        </div>
        <label className="mt-3 flex items-start gap-2 text-xs leading-6 text-mute"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy || !data} className="mt-1.5 h-4 w-4 shrink-0" />我已核对收款地址、USDT 金额和推荐关系；转账成功后由服务器核验记账，领取时可在 50% / 70% 两种方式中二选一。</label>
      </div>
    </div>
    {error ? <p role="alert" className="mt-3 text-xs leading-6 text-down">{error}</p> : null}
    {serverMessage ? <p role={serverState === "failed" ? "alert" : "status"} className={"mt-3 text-xs leading-6 " + (serverState === "failed" ? "text-down" : serverState === "success" ? "text-up" : "text-mute")}>{serverMessage}</p> : null}
    {!state.connected ? <button onClick={connect} className="btn btn-outline mt-4 min-h-11 w-full text-sm"><Wallet size={14} />连接钱包</button> : null}
    {pending ? <button onClick={() => void recheck()} disabled={checking || tx.busy} className="btn btn-outline mt-3 min-h-11 w-full text-sm">{checking ? "重新核验中…" : "重新核验上一次转账（不会再次转账）"}</button> : null}
    <button onClick={() => void submit()} disabled={Boolean(reason) || !confirmed || busy} className="btn btn-gold mt-4 min-h-11 w-full text-sm">{checking || tx.busy ? "等待钱包 / 链上确认" : pending ? "等待服务器核验" : reason || "确认转账认购"}</button>
    <p className="mt-2 text-xs leading-6 text-faint">只有转账交易成功、达到 2 次确认且金额与份数一致时才会登记；同一交易哈希只能登记一次。</p>
    <TransactionFeedback controller={tx} />
    {orders.orders.length ? <div className="mt-4 rounded-lg border border-line bg-well px-4 py-2"><p className="mb-2 text-xs text-mute">我的认购凭证</p>{orders.orders.map(order => <DataRow key={order.id} label={`${new Date(order.createdAt).toLocaleString("zh-CN")} · ${order.shares} 份`} value={order.txHash.slice(0, 10) + "…"} />)}</div> : null}
  </Card>;
}
