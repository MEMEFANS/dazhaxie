"use client";
import { useEffect, useRef, useState } from "react";
import { erc20Abi } from "viem";
import { ArrowRight, Check, Gift, Wallet } from "lucide-react";
import { useStore } from "@/lib/store";
import { getExplorerAddressUrl, getExplorerTxUrl, chainConfig } from "@/lib/chain-config";
import { useTokenData } from "@/lib/chain-data";
import { useContractTransaction, TransactionFeedback } from "@/lib/contract-transactions";
import { useRedemptionConfig, useRedemptionAccount, redemptionRequest, notifyRedemptionChanged } from "@/lib/redemption-client";
import type { RedemptionOrder, RedemptionShipping } from "@/lib/redemption";
import { EXCHANGE_COST, MAX_EXCHANGE_PER_TIME, fmt, shortAddr } from "@/lib/constants";
import { formatAssetAmount } from "@/lib/amounts";
import { Card, DataRow, SectionHead, StatusPill } from "@/components/dapp/ui";

// 已转账、待填写收货信息的本机记录：刷新或断网后仍可继续提交，避免重复转账。
type PendingTransfer = { quantity: number; amount: string; hash: `0x${string}`; at: number; confirmed?: boolean };
const storageKey = (chainId: number, address: string) => `cabi-exchange-pending:v1:${chainId}:${address.toLowerCase()}`;
const emptyShipping: RedemptionShipping = { name: "", phone: "", address: "" };

function readPending(key: string): PendingTransfer | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "null") as Partial<PendingTransfer> | null;
    if (!value || !Number.isSafeInteger(value.quantity) || typeof value.amount !== "string" || typeof value.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value.hash)) return null;
    return value as PendingTransfer;
  } catch { return null; }
}
function savePending(key: string, pending: PendingTransfer) {
  try { window.localStorage.setItem(key, JSON.stringify(pending)); } catch { /* 本地存储不可用时仍可在当前页面完成提交 */ }
}
function clearPending(key: string) {
  try { window.localStorage.removeItem(key); } catch { /* ignore */ }
}

const steps = [
  "支付 CaBi",
  "填写收货信息",
];

export default function ExchangeForm() {
  const { state, connect } = useStore();
  const config = useRedemptionConfig();
  const account = useRedemptionAccount();
  const token = useTokenData(state.connected ? state.address : undefined);
  const controller = useContractTransaction("physical-redemption");
  const [quantity, setQuantity] = useState("1");
  const [shipping, setShipping] = useState<RedemptionShipping>(emptyShipping);
  const [pending, setPending] = useState<PendingTransfer | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestRef = useRef<{ quantity: number; amount: string } | null>(null);
  const keyRef = useRef("");

  const data = config.data;
  const networkOk = state.connected && state.chainId === chainConfig.id;
  const maxShares = data?.maxPerTransaction ?? MAX_EXCHANGE_PER_TIME;
  const unitPrice = data?.unitPrice ? BigInt(data.unitPrice) : 0n;
  const quantityNumber = Number(quantity);
  const validQuantity = Number.isSafeInteger(quantityNumber) && quantityNumber >= 1 && quantityNumber <= maxShares;
  const cost = validQuantity ? unitPrice * BigInt(quantityNumber) : 0n;
  const balance = token.status === "ready" ? token.data?.balance : undefined;
  const enough = balance !== undefined && cost > 0n && balance >= cost;
  const affordable = balance !== undefined && unitPrice > 0n ? Number(balance / unitPrice) : undefined;
  const shortfall = balance !== undefined && cost > balance ? cost - balance : 0n;
  const payee = data?.payee;
  const payeeUrl = payee ? getExplorerAddressUrl(payee) : "";
  const busy = submitting || controller.busy || account.busy;
  const locked = pending !== null;
  const key = state.connected ? storageKey(state.chainId, state.address) : "";

  // 切换钱包/网络时恢复属于该地址的「已转账待提交」记录，避免重复转账。
  useEffect(() => {
    keyRef.current = key;
    const timer = window.setTimeout(() => {
      const saved = key ? readPending(key) : null;
      setPending(saved?.confirmed === false ? null : saved);
      setShipping(emptyShipping);
      setError("");
      setNotice("");
      requestRef.current = saved?.confirmed === false ? { quantity: saved.quantity, amount: saved.amount } : null;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [key]);

  // 广播后保存付款信息；刷新后继续确认，到账后再进入收货步骤。
  useEffect(() => {
    const transaction = controller.transaction;
    const request = requestRef.current;
    if (!request || !keyRef.current || !transaction?.hash || transaction.phase !== "action") return;
    if (transaction.status === "failed") {
      const saved = readPending(keyRef.current);
      if (saved?.confirmed === false && saved.hash === transaction.hash) clearPending(keyRef.current);
      requestRef.current = null;
      return;
    }
    if (transaction.status !== "pending" && transaction.status !== "success") return;
    const record: PendingTransfer = { ...request, hash: transaction.hash, at: Date.now(), confirmed: transaction.status === "success" };
    savePending(keyRef.current, record);
    if (!record.confirmed) return;
    requestRef.current = null;
    setPending(record);
    setError("");
    void token.refresh();
  }, [controller.transaction, token]);

  async function transfer(event: React.FormEvent) {
    event.preventDefault();
    if (busy || locked || !data?.enabled || !data.token || !payee || !networkOk) return;
    if (!validQuantity) { setError(`请输入 1–${maxShares} 份之间的兑换数量`); return; }
    if (balance === undefined) { setError("尚未读取到代币余额，请稍后重试"); return; }
    if (!enough) { setError(`代币余额不足，还差 ${formatAssetAmount(shortfall, 18)} CaBi`); return; }
    setError("");
    setNotice("");
    requestRef.current = { quantity: quantityNumber, amount: cost.toString() };
    await controller.run({
      address: data.token,
      abi: erc20Abi,
      functionName: "transfer",
      args: [payee, cost],
      description: `支付 ${quantityNumber} 份蟹礼（${formatAssetAmount(cost, 18)} CaBi）`,
    });
  }

  async function submitOrder(event: React.FormEvent) {
    event.preventDefault();
    if (!pending || submitting || !networkOk) return;
    const expectedKey = keyRef.current;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      if (!account.authenticated) await account.login();
      if (keyRef.current !== expectedKey) throw new Error("钱包已切换，请使用付款钱包继续提交");
      const { session } = await redemptionRequest<{ session: { address: string; chainId: number } | null }>("/api/redemption/auth/session");
      if (!session || session.address.toLowerCase() !== state.address.toLowerCase() || session.chainId !== chainConfig.id) {
        throw new Error("请在钱包中确认身份后提交收货信息");
      }
      const { order } = await redemptionRequest<{ order: RedemptionOrder }>("/api/redemption/orders", {
        method: "POST",
        body: JSON.stringify({ quantity: pending.quantity, shipping, hash: pending.hash }),
      });
      clearPending(expectedKey);
      notifyRedemptionChanged();
      if (keyRef.current !== expectedKey) return;
      setPending(null);
      setQuantity("1");
      setShipping(emptyShipping);
      controller.clear();
      void token.refresh();
      await account.refresh();
      setNotice(`兑换单已提交：${order.quantity} 份蟹礼，等待发货。`);
    } catch (e) {
      if (keyRef.current === expectedKey) setError(`${e instanceof Error ? e.message : "提交未完成"}。已付款，无需再次支付，请重试提交。`);
    } finally {
      setSubmitting(false);
    }
  }

  const transferLabel = config.loading
    ? "正在加载…"
    : !data?.enabled
    ? "兑换暂未开放"
    : !validQuantity
      ? `请输入 1–${maxShares} 份`
      : balance === undefined
        ? "正在读取代币余额"
        : !enough
          ? `余额不足，还差 ${formatAssetAmount(shortfall, 18)}`
          : `支付 ${formatAssetAmount(cost, 18)} CaBi`;

  return (
    <Card className="h-full p-5 sm:p-6">
      <SectionHead eyebrow="REDEEM" title={locked ? "填写收货信息" : "兑换蟹礼"} right={<StatusPill tone={locked ? "live" : data?.enabled ? "live" : "paused"}>{locked ? "已付款" : config.loading ? "加载中" : data?.enabled ? "兑换开放" : "尚未开放"}</StatusPill>} />

      <ol aria-label="兑换步骤" className="mt-5 grid grid-cols-2 gap-2">
        {steps.map((step, index) => {
          const active = locked ? index === 1 : index === 0;
          const done = locked && index === 0;
          return (
            <li key={step} aria-current={active ? "step" : undefined} className={`rounded-xl border px-3 py-3 ${active ? "border-purple/30 bg-purple/[0.06]" : "border-line bg-well"}`}>
              <p className={`flex items-center gap-2 text-xs font-semibold ${active ? "text-purple-deep" : done ? "text-up" : "text-faint"}`}>
                <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${active ? "bg-purple text-white" : done ? "bg-up text-white" : "bg-line text-mute"}`}>{done ? <Check size={12} /> : index + 1}</span>
                {step}
              </p>
            </li>
          );
        })}
      </ol>

      {!locked ? <div className="mt-4 rounded-lg border border-line bg-well px-4 py-2">
        <DataRow label="兑换单价" value={`${fmt(EXCHANGE_COST)} CaBi / 份`} />
        <DataRow label="CaBi 余额" value={balance !== undefined ? `${formatAssetAmount(balance, 18)} CaBi` : "—"} />
      </div> : null}

      {!state.connected ? (
        <button onClick={connect} className="btn btn-gold mt-5 min-h-11 w-full"><Wallet size={15} />连接钱包</button>
      ) : !networkOk ? (
        <p className="mt-4 text-sm text-warn">请切换到 {chainConfig.shortName}。</p>
      ) : locked ? (
        <form onSubmit={submitOrder} className="mt-5 space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-up/25 bg-up/[0.06] px-4 py-3">
            <p className="text-xs font-medium text-strong">{pending.quantity} 份蟹礼 · 已支付 {formatAssetAmount(BigInt(pending.amount), 18)} CaBi</p>
            <a href={getExplorerTxUrl(pending.hash)} target="_blank" rel="noreferrer" className="shrink-0 text-[11px] text-purple-deep underline">付款记录</a>
          </div>
          <label className="block space-y-2 text-xs text-mute"><span>收件人</span><input value={shipping.name} onChange={e => setShipping(s => ({ ...s, name: e.target.value }))} maxLength={60} autoComplete="name" className="field min-h-11 w-full px-3 text-sm" required disabled={submitting} /></label>
          <label className="block space-y-2 text-xs text-mute"><span>联系电话</span><input type="tel" value={shipping.phone} onChange={e => setShipping(s => ({ ...s, phone: e.target.value }))} maxLength={25} autoComplete="tel" className="field min-h-11 w-full px-3 text-sm" required disabled={submitting} /></label>
          <label className="block space-y-2 text-xs text-mute"><span>完整收货地址</span><textarea value={shipping.address} onChange={e => setShipping(s => ({ ...s, address: e.target.value }))} minLength={5} maxLength={500} autoComplete="street-address" rows={3} className="field w-full px-3 py-3 text-sm" required disabled={submitting} /></label>
          <button disabled={submitting} className="btn btn-gold min-h-11 w-full">
            <Gift size={15} />{account.busy ? "请在钱包中确认…" : submitting ? "正在提交…" : "提交收货信息"}<ArrowRight size={14} />
          </button>
        </form>
      ) : (
        <form onSubmit={transfer} className="mt-5 space-y-4">
          <label className="block space-y-2 text-xs text-mute">
            <span>兑换份数（单次 1–{maxShares} 份）</span>
            <input type="number" min="1" max={maxShares} step="1" value={quantity} onChange={e => setQuantity(e.target.value)} className="field min-h-11 w-full px-3 text-sm" required disabled={busy} />
          </label>
          <div className="rounded-lg border border-line bg-well px-4 py-2">
            <DataRow label="实付金额" value={`${formatAssetAmount(cost, 18)} CaBi`} />
            <DataRow label="收款地址" value={payee ? <a href={payeeUrl} target="_blank" rel="noreferrer" className="break-all font-mono text-[11px] text-purple-deep underline" title={payee}>{shortAddr(payee)}</a> : "暂未开放"} />
          </div>
          {balance !== undefined && !enough && validQuantity ? (
            <p className="text-xs leading-6 text-down">余额不足，还差 {formatAssetAmount(shortfall, 18)} CaBi；按当前余额最多可兑 {affordable ?? 0} 份。</p>
          ) : null}
          <button disabled={busy || !data?.enabled || !validQuantity || !enough} className="btn btn-gold min-h-11 w-full">
            <ArrowRight size={15} />{controller.busy ? controller.transaction?.status === "pending" ? "正在确认付款…" : "请在钱包中确认付款…" : transferLabel}
          </button>
        </form>
      )}

      {(error || account.error) ? <p role="alert" className="mt-4 text-sm text-down">{error || account.error}</p> : null}
      {notice ? <p role="status" className="mt-4 text-sm leading-6 text-up">{notice}</p> : null}
      {!locked ? <TransactionFeedback controller={controller} /> : null}
    </Card>
  );
}
