"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { erc20Abi, parseUnits } from "viem";
import { ArrowRight, Check, ChevronDown, Coins, Copy, ShoppingBag, Wallet } from "lucide-react";
import { useStore } from "@/lib/store";
import { chainConfig } from "@/lib/chain-config";
import { formatAssetAmount } from "@/lib/amounts";
import type { RedemptionShipping } from "@/lib/redemption";
import { fetchSubscribeConfig, useSubscribeConfig, useSubscribeOrders } from "@/lib/subscribe-data";
import { fetchReferralData, useReferralData } from "@/lib/referral-data";
import { useContractTransaction } from "@/lib/contract-transactions";
import { isUserCancelledError } from "@/lib/transaction-cancellation";
import { RelationNotice } from "./relation-notice";
import { ShareOptions } from "./share-options";
import { PurchaseSuccess } from "./purchase-success";
import { PurchaseRecords } from "./purchase-records";
import { PurchaseStatus, type PurchaseStatusKind } from "./purchase-status";
import styles from "./subscribe.module.css";

type PurchaseSnapshot = { hash: string; shares: number; paid: string; allocation: string; shipping: RedemptionShipping };
const emptyShipping: RedemptionShipping = { name: "", phone: "", address: "" };

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
  const [selectedQuantity, setQuantity] = useState(1), [error, setError] = useState("");
  const [cancelled, setCancelled] = useState(false), [resuming, setResuming] = useState(false);
  const [shipping, setShipping] = useState<RedemptionShipping>(emptyShipping);
  const shippingLoaded = useRef(false);
  const [serverState, setServerState] = useState<"idle" | "verifying" | "success" | "failed">("idle");
  const [serverMessage, setServerMessage] = useState("");
  const [pending, setPending] = useState<PurchaseSnapshot | null>(null);
  const [completed, setCompleted] = useState<PurchaseSnapshot | null>(null);
  const [unregisteredHash, setUnregisteredHash] = useState("");
  const [copied, setCopied] = useState(false);
  const [inlineActionVisible, setInlineActionVisible] = useState(false);
  const inlineActions = useRef<HTMLDivElement>(null), successResult = useRef<HTMLDivElement>(null), statusResult = useRef<HTMLDivElement>(null);
  const submitted = useRef<Omit<PurchaseSnapshot, "hash"> | null>(null);

  const shippingKey = state.connected ? `cabi-subscribe-shipping:v1:${state.chainId}:${state.address.toLowerCase()}` : "";
  useEffect(() => {
    shippingLoaded.current = false;
    const timer = window.setTimeout(() => {
      try {
        const saved = shippingKey ? JSON.parse(window.localStorage.getItem(shippingKey) || "null") as Partial<RedemptionShipping> | null : null;
        setShipping({ name: typeof saved?.name === "string" ? saved.name : "", phone: typeof saved?.phone === "string" ? saved.phone : "", address: typeof saved?.address === "string" ? saved.address : "" });
      } catch { setShipping(emptyShipping); }
      shippingLoaded.current = true;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [shippingKey]);
  useEffect(() => {
    if (!shippingLoaded.current || !shippingKey) return;
    try { window.localStorage.setItem(shippingKey, JSON.stringify(shipping)); } catch { /* local draft is optional */ }
  }, [shipping, shippingKey]);

  useEffect(() => {
    if (!inlineActions.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInlineActionVisible(entry.isIntersecting), {
      rootMargin: "-116px 0px -160px 0px", threshold: 1,
    });
    observer.observe(inlineActions.current);
    return () => observer.disconnect();
  }, [completed]);

  useEffect(() => {
    if (!completed || !successResult.current) return;
    const target = successResult.current;
    const frame = window.requestAnimationFrame(() => {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [completed]);

  async function verifyOnServer(hash: string, shares: number, shippingInfo: RedemptionShipping): Promise<Response> {
    return fetch("/api/subscribe/orders", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ shares, hash, shipping: shippingInfo }),
    });
  }
  function reportServerResult(response: Response, body: { error?: string }, purchase: PurchaseSnapshot) {
    if (response.status === 202) { setServerState("verifying"); setServerMessage(body.error || "转账确认中，请稍后点击重新查询。"); return false; }
    if (!response.ok) { setServerState("failed"); setServerMessage(body.error || "暂未完成认购登记，请查询本次结果，无需再次支付。"); return false; }
    setServerState("success"); setServerMessage(""); setCompleted(purchase); setPending(null);
    setQuantity(Math.max(1, data?.minShares ?? 1)); void query.refresh(); orders.refresh();
    return true;
  }

  useEffect(() => {
    if (tx.transaction?.status === "success") { void query.refresh(); orders.refresh(); }
  }, [tx.transaction?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const bound = referral.status === "ready" && Boolean(relation?.bound) && relation?.account.toLowerCase() === state.address.toLowerCase();
  const restoredShares = tx.transaction?.status === "pending" ? Number(tx.transaction.description.match(/^认购 (\d+) 份/)?.[1]) : 0;
  const quantity = Math.max(Math.max(1, data?.minShares ?? 1), Number.isSafeInteger(restoredShares) && restoredShares > 0 ? restoredShares : selectedQuantity);
  const amount = data ? parseUnits(String(data.unitPrice), data.usdtDecimals) * BigInt(quantity) : 0n;
  const quota = data ? parseUnits(String(data.tokensPerShare), data.tokenDecimals) * BigInt(quantity) : 0n;
  const remaining = data ? Math.max(0, data.maxShares - data.purchased) : 0;
  const confirmationKey = [state.address.toLowerCase(), state.chainId, quantity, data?.unitPrice, data?.usdtDecimals, data?.payee, data?.purchased, data?.globalSold, relation?.code, relation?.referrerCode, relation?.referrer, referral.status].join(":");
  const context = useMemo(() => ({ confirmationKey }), [confirmationKey]), current = useRef<object | null>(null);
  useEffect(() => { current.current = context; return () => { current.current = null; }; }, [context]);

  let reason = "";
  if (!state.connected) reason = "请连接钱包";
  else if (state.chainId !== chainConfig.id) reason = "请切换到" + chainConfig.shortName;
  else if (query.status !== "ready" || query.error || !data) reason = query.error || "正在读取认购配置";
  else if (!data.configured) reason = data.message || "认购暂未开放";
  else if (!bound) reason = referral.binding?.bound ? "请先签名登录" : "请先在邀请入口绑定推荐关系";
  else if (!data.enabled) reason = data.message || "认购暂时关闭";
  else if (quantity > remaining) reason = "超过此钱包剩余认购份数";
  else if (quantity > data.remainingGlobal) reason = "超过全局剩余份数";
  // 不做 USDT 余额前置校验：余额不足时钱包转账会自行失败回滚，避免误拦截
  else if (!data.payee || !data.usdt) reason = "收款地址或 USDT 配置缺失";

  async function verifyReferral() {
    const fresh = await fetchReferralData(state.address);
    if (!mounted.current || current.current !== context) throw new Error("钱包或认购状态已变化，请重新确认。");
    if (!fresh?.bound || fresh.code !== relation?.code || fresh.referrer !== relation?.referrer || fresh.root !== relation?.root) throw new Error("邀请码关系已变化或登录失效，请重新核对。");
  }

  async function verifyConfiguration() {
    const fresh = await fetchSubscribeConfig(state.address, true);
    if (!mounted.current || current.current !== context) throw new Error("钱包或认购状态已变化，请重新确认。");
    if (!fresh.configured || !fresh.enabled || fresh.locked) { query.refresh(); throw new Error(fresh.message || "认购暂时关闭"); }
    if (fresh.payee?.toLowerCase() !== data?.payee?.toLowerCase() || fresh.usdt?.toLowerCase() !== data?.usdt?.toLowerCase()
      || fresh.chainId !== state.chainId || fresh.unitPrice !== data?.unitPrice || fresh.usdtDecimals !== data?.usdtDecimals
      || fresh.tokensPerShare !== data?.tokensPerShare || fresh.tokenDecimals !== data?.tokenDecimals) {
      query.refresh();
      throw new Error("认购收款地址或金额已更新，页面正在同步，请核对后重新点击认购。");
    }
    if (quantity > fresh.remainingPersonal || quantity > fresh.remainingGlobal) { query.refresh(); throw new Error("剩余认购份数已变化，请重新选择。"); }
  }

  async function verifyPurchase() { await verifyReferral(); await verifyConfiguration(); }

  async function submit() {
    if (reason || !data?.payee || !data.usdt || !bound || operation.current || tx.busy || pending || unregisteredHash) return;
    if (!shipping.name.trim() || !/^[+0-9 ()-]{6,25}$/.test(shipping.phone.trim()) || shipping.address.trim().length < 5) {
      setError("请先填写完整收货姓名、联系电话和地址。收货信息用于认购后发货。"); return;
    }
    operation.current = true; setChecking(true); setError(""); setCancelled(false); setCompleted(null); setServerState("idle"); setServerMessage(""); tx.clear();
    submitted.current = { shares: quantity, paid: formatAssetAmount(amount, data.usdtDecimals), allocation: formatAssetAmount(quota, data.tokenDecimals), shipping: { name: shipping.name.trim(), phone: shipping.phone.trim(), address: shipping.address.trim() } };
    try {
      await verifyPurchase();
      const hash = await tx.run({
        address: data.usdt, abi: erc20Abi, functionName: "transfer",
        args: [data.payee, amount],
        description: `认购 ${quantity} 份，向收款地址转入 ${formatAssetAmount(amount, data.usdtDecimals)} USDT`,
        beforeSend: verifyPurchase,
        allowUnsimulated: true,
      });
      if (!hash || !mounted.current) return;
       await registerPurchase({ hash, ...submitted.current });
    } catch (cause) {
      if (mounted.current) { setServerState("failed"); setCancelled(isUserCancelledError(cause)); setError(isUserCancelledError(cause) ? "你已取消钱包确认，可重新发起认购。" : cause instanceof Error ? cause.message : "本次认购未完成，请核对后重试。"); }
    } finally { operation.current = false; if (mounted.current) setChecking(false); }
  }

  async function registerPurchase(purchase: PurchaseSnapshot) {
    setPending(purchase); setServerState("verifying"); setServerMessage("");
    try {
      const response = await verifyOnServer(purchase.hash, purchase.shares, purchase.shipping);
      const body = await response.json().catch(() => ({}));
      if (mounted.current) reportServerResult(response, body, purchase);
    } catch {
      if (mounted.current) { setServerState("failed"); setServerMessage("认购登记暂时无法查询，请重试查询本次结果，无需再次支付。"); }
    }
  }

  async function recheck() {
    if (!pending || checking || operation.current) return;
    operation.current = true; setChecking(true); setError("");
    try {
      const response = await verifyOnServer(pending.hash, pending.shares, pending.shipping);
      const body = await response.json().catch(() => ({}));
      if (!mounted.current) return;
      reportServerResult(response, body, pending);
    } catch (cause) {
      if (mounted.current) { setServerState("failed"); setServerMessage(cause instanceof Error ? cause.message : "重新核验失败，请稍后重试"); }
    } finally { operation.current = false; if (mounted.current) setChecking(false); }
  }

  async function resumeTransfer() {
    if (checking || resuming || operation.current) return;
    operation.current = true; setResuming(true); setError("");
    try {
      const description = tx.transaction?.description;
      const hash = await tx.resume();
      if (!hash || !mounted.current) return;
      let snapshot = submitted.current;
      // Restored transactions retain the original app-generated purchase description.
      const restored = description?.match(/^认购 (\d+) 份，向收款地址转入 ([\d,]+(?:\.\d+)?) USDT$/);
      if (!snapshot && restored && data) {
        const shares = Number(restored[1]);
        if (Number.isSafeInteger(shares) && shares > 0) snapshot = { shares, paid: restored[2], allocation: formatAssetAmount(parseUnits(String(data.tokensPerShare), data.tokenDecimals) * BigInt(shares), data.tokenDecimals), shipping };
      }
      if (snapshot) await registerPurchase({ hash, ...snapshot });
      else { setUnregisteredHash(hash); setServerState("failed"); setServerMessage("转账已确认，请联系支持核对本笔认购登记，无需再次支付。"); }
    } catch {
      if (mounted.current) setServerMessage("暂时无法查询链上结果，请稍后重试，无需再次支付。");
    } finally { operation.current = false; if (mounted.current) setResuming(false); }
  }

  async function copyPayee() {
    if (!data?.payee) return;
    try { await navigator.clipboard.writeText(data.payee); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* Clipboard may require a secure context. */ }
  }

  const busy = checking || resuming || tx.busy || serverState === "verifying" || Boolean(pending) || Boolean(unregisteredHash);
  const maximum = data ? Math.min(data.maxShares, data.remainingGlobal, state.connected ? remaining : data.maxShares) : 1;
  const shortPayee = data?.payee ? `${data.payee.slice(0, 6)}…${data.payee.slice(-4)}` : "等待配置";
  const confirming = tx.transaction?.status === "pending";
  const actionLabel = tx.busy ? tx.transaction?.status === "wallet" ? "等待钱包确认" : "等待链上确认" : checking ? "正在核对认购" : pending ? "等待认购登记" : unregisteredHash ? "请核对认购登记" : reason || "确认认购";
  const mobileLabel = !state.connected ? "连接钱包" : pending || confirming ? checking || resuming ? "正在查询…" : confirming ? "查询转账结果" : "查询认购结果" : actionLabel;
  const mobileDisabled = state.connected && (pending || confirming ? checking || resuming : Boolean(reason) || busy);
  let statusKind: PurchaseStatusKind | undefined;
  let statusMessage: string | undefined;
  if (pending || unregisteredHash) { statusKind = serverState === "failed" ? "registration-failed" : "registering"; statusMessage = serverMessage || undefined; }
  else if (error) { statusKind = cancelled ? "cancelled" : "failed"; statusMessage = error; }
  else if (tx.transaction?.status === "failed") { statusKind = tx.transaction.cancelled ? "cancelled" : "failed"; statusMessage = tx.transaction.message; }
  else if (confirming) { statusKind = "confirming"; statusMessage = serverMessage || undefined; }
  else if (tx.transaction?.status === "wallet") { statusKind = "wallet"; }
  else if (checking) { statusKind = "checking"; }

  useEffect(() => {
    if (!statusKind || !["failed", "cancelled", "registration-failed", "confirming"].includes(statusKind) || !statusResult.current) return;
    const target = statusResult.current;
    const frame = window.requestAnimationFrame(() => {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [statusKind]);

  return (
    <>
    <section className={styles.purchase} aria-labelledby="purchase-title">
      <div className={styles.purchaseHeading}><h2 id="purchase-title"><ShoppingBag size={19} strokeWidth={1.7} />选择认购份额</h2><span><Wallet size={13} />USDT 支付</span></div>
      <p className={styles.purchaseIntro}>认购同时登记蟹礼发货信息；代币配额不变，价格按全局认购进度分档。</p>
      {completed ? <div ref={successResult} tabIndex={-1} className={styles.successTarget} aria-label="本次认购结果">
        <PurchaseSuccess shares={completed.shares} paid={completed.paid} allocation={completed.allocation} txHash={completed.hash} />
        {data?.enabled && maximum >= Math.max(1, data.minShares) ? <button type="button" className={`btn btn-outline ${styles.continueButton}`} onClick={() => setCompleted(null)}>继续认购其他份额<ArrowRight size={14} /></button> : null}
      </div> : <>
      <RelationNotice />

      <ShareOptions value={quantity} onChange={setQuantity} config={data} available={maximum} disabled={busy} />
      <div className={styles.accountStats}><span>已认购 <strong>{data && state.connected ? data.purchased : "—"}</strong> 份</span><span>此钱包还可认购 <strong>{data && state.connected ? remaining : "—"}</strong> 份</span></div>

      <div className={styles.receipt}>
        <div className={styles.payment}><span>本次支付</span><strong aria-live="polite">{data ? formatAssetAmount(amount, data.usdtDecimals) : "—"}<small>USDT</small></strong></div>
        <div className={styles.allocation}><span><Coins size={14} />对应 CaBi 配额</span><strong>{data ? formatAssetAmount(quota, data.tokenDecimals) : "—"}<small>CaBi</small></strong></div>
        <p className={styles.receiptHint}>认购后前往代币中心领取：需支付 30% USDT 等值组建流动性，30% CaBi 进入项目 LP，70% 到账可交易。</p>
        <div className={styles.claimOptions}>
          <div><span>领取到账 · 70%</span><strong>{data ? formatAssetAmount(quota * 70n / 100n, data.tokenDecimals) : "—"}<small>CaBi</small></strong></div>
          <div><span>组建流动性 · 30%</span><strong>{data ? formatAssetAmount(quota * 30n / 100n, data.tokenDecimals) : "—"}<small>CaBi</small></strong><p className={styles.claimRequirement}>领取时另付 30% USDT 等值</p></div>
        </div>
      </div>
      {data ? <p className="mt-2 text-xs leading-5 text-mute">当前销售档位：{data.unitPrice} USDT / 份；价格档位为 50、55、60、70 USDT，每 5,000 份进入下一档。每份 CaBi 配额保持不变。</p> : null}

      <div className="mt-4 rounded-xl border border-line bg-well p-4">
        <p className="text-sm font-semibold text-strong">蟹礼收货信息</p>
        <p className="mt-1 text-xs leading-6 text-mute">付款确认后，后台会按这份信息记录并安排发货。</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block space-y-2 text-xs text-mute"><span>收货人</span><input value={shipping.name} onChange={event => setShipping(value => ({ ...value, name: event.target.value }))} maxLength={60} autoComplete="name" className="field min-h-11 w-full px-3 text-sm" disabled={busy} /></label>
          <label className="block space-y-2 text-xs text-mute"><span>联系电话</span><input type="tel" value={shipping.phone} onChange={event => setShipping(value => ({ ...value, phone: event.target.value }))} maxLength={25} autoComplete="tel" className="field min-h-11 w-full px-3 text-sm" disabled={busy} /></label>
        </div>
        <label className="mt-3 block space-y-2 text-xs text-mute"><span>完整收货地址</span><textarea value={shipping.address} onChange={event => setShipping(value => ({ ...value, address: event.target.value }))} minLength={5} maxLength={500} autoComplete="street-address" rows={3} className="field w-full px-3 py-3 text-sm" disabled={busy} /></label>
      </div>

      <details className={styles.payee}><summary><span>收款地址与网络</span><span>{shortPayee}<ChevronDown size={14} /></span></summary><div className={styles.payeeAddress}><code>{data?.payee || "暂未开放"}</code><button type="button" onClick={() => void copyPayee()} disabled={!data?.payee} className={styles.copyButton}>{copied ? <><Check size={12} />已复制</> : <><Copy size={12} />复制</>}</button></div><p>请使用 BSC 网络 USDT 支付，转账前核对收款地址与金额。</p></details>

      {statusKind ? <div ref={statusResult} tabIndex={-1} aria-label="本次认购状态"><PurchaseStatus kind={statusKind} message={statusMessage} hash={pending?.hash || unregisteredHash || tx.transaction?.hash} onQuery={pending ? () => void recheck() : confirming ? () => void resumeTransfer() : undefined} querying={checking || resuming} /></div> : null}
      {unregisteredHash ? <a href="/dapp/support" className={`btn btn-outline ${styles.continueButton}`}>联系支持核对登记<ArrowRight size={14} /></a> : null}
      <div ref={inlineActions} className={styles.actions}>
        {!state.connected ? <button type="button" onClick={connect} className={`btn btn-gold ${styles.primaryButton}`}><Wallet size={16} />连接钱包，开始认购<ArrowRight size={16} /></button> : <button type="button" onClick={() => void submit()} disabled={Boolean(reason) || busy} className={`btn btn-gold ${styles.primaryButton}`}>{actionLabel}{!reason && !busy ? <ArrowRight size={16} /> : null}</button>}
      </div>
      <p className={styles.actionHint}><Wallet size={12} />BSC 网络 · USDT 转账 · 确认后登记认购</p>
      </>}
      {orders.error ? <p role="status" className={styles.feedback}>{orders.error}</p> : null}
      <PurchaseRecords orders={orders.orders} usdtDecimals={data?.usdtDecimals} />
    </section>
    {!completed ? <div className={styles.mobileCheckout} data-inline-visible={inlineActionVisible} role="region" aria-label="快捷认购">
      <div className={styles.mobileCheckoutInner}>
        <div className={styles.mobileTotal}><span>本次支付 · {quantity} 份</span><strong aria-live="polite">{data ? formatAssetAmount(amount, data.usdtDecimals) : "—"}<small>USDT</small></strong></div>
        <button type="button" disabled={mobileDisabled} onClick={() => { if (!state.connected) connect(); else if (pending) void recheck(); else if (confirming) void resumeTransfer(); else void submit(); }} className={styles.mobileSubmit}>{mobileLabel}{!mobileDisabled ? <ArrowRight size={16} /> : null}</button>
      </div>
    </div> : null}
    </>
  );
}
