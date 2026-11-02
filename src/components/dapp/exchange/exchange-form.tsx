"use client";
import { useEffect, useRef, useState } from "react";
import { erc20Abi } from "viem";
import { ArrowRight, Gift, Lock, ShieldCheck, Wallet } from "lucide-react";
import { useStore } from "@/lib/store";
import { getExplorerAddressUrl, getExplorerTxUrl, chainConfig } from "@/lib/chain-config";
import { useTokenData } from "@/lib/chain-data";
import { useContractTransaction, TransactionFeedback } from "@/lib/contract-transactions";
import { useRedemptionConfig, useRedemptionAccount, redemptionRequest, notifyRedemptionChanged } from "@/lib/redemption-client";
import type { RedemptionOrder, RedemptionShipping } from "@/lib/redemption";
import { EXCHANGE_COST, MAX_EXCHANGE_PER_TIME, fmt, shortAddr } from "@/lib/constants";
import { formatAssetAmount } from "@/lib/amounts";
import { Card, DataRow, Notice, SectionHead, StatusPill } from "@/components/dapp/ui";

// 已转账、待填写收货信息的本机记录：刷新或断网后仍可继续提交，避免重复转账。
type PendingTransfer = { quantity: number; amount: string; hash: `0x${string}`; at: number };
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
  { title: "转入代币", desc: "向指定收款地址转账" },
  { title: "填写收货信息", desc: "提交后生成待发货兑换单" },
  { title: "后台发货", desc: "物流更新可在此查询" },
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
  const busy = submitting || controller.busy;
  const locked = pending !== null;
  const key = state.connected ? storageKey(state.chainId, state.address) : "";

  // 切换钱包/网络时恢复属于该地址的「已转账待提交」记录，避免重复转账。
  useEffect(() => {
    keyRef.current = key;
    const timer = window.setTimeout(() => {
      setPending(key ? readPending(key) : null);
      setShipping(emptyShipping);
      setError("");
      setNotice("");
      requestRef.current = null;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [key]);

  // 转账确认成功后即刻锁定待提交状态；此前不扣减、不生成订单。
  useEffect(() => {
    const transaction = controller.transaction;
    const request = requestRef.current;
    if (!request || !keyRef.current || transaction?.status !== "success" || transaction.phase !== "action" || !transaction.hash) return;
    const record: PendingTransfer = { ...request, hash: transaction.hash, at: Date.now() };
    requestRef.current = null;
    savePending(keyRef.current, record);
    setPending(record);
    setError("");
    void token.refresh();
  }, [controller.transaction, token]);

  async function transfer(event: React.FormEvent) {
    event.preventDefault();
    if (busy || locked || !data?.enabled || !data.token || !payee || !account.authenticated || !networkOk) return;
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
      description: `转入 ${quantityNumber} 份蟹礼代币（${fmt(EXCHANGE_COST * quantityNumber)} CaBi）`,
    });
  }

  async function submitOrder(event: React.FormEvent) {
    event.preventDefault();
    if (!pending || submitting || !account.authenticated) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const { order } = await redemptionRequest<{ order: RedemptionOrder }>("/api/redemption/orders", {
        method: "POST",
        body: JSON.stringify({ quantity: pending.quantity, shipping, hash: pending.hash }),
      });
      clearPending(keyRef.current);
      setPending(null);
      setQuantity("1");
      setShipping(emptyShipping);
      notifyRedemptionChanged();
      void token.refresh();
      await account.refresh();
      setNotice(`兑换单已提交：${order.quantity} 份蟹礼，等待后台发货。`);
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "兑换单提交失败"}。转账已锁定，请勿重复转账，可直接重试提交。`);
    } finally {
      setSubmitting(false);
    }
  }

  const transferLabel = !data?.enabled
    ? data?.message || "兑换尚未开放"
    : !validQuantity
      ? `请输入 1–${maxShares} 份`
      : balance === undefined
        ? "正在读取代币余额"
        : !enough
          ? `余额不足，还差 ${formatAssetAmount(shortfall, 18)}`
          : `转入 ${fmt(EXCHANGE_COST * Math.max(1, quantityNumber))} CaBi`;

  return (
    <Card className="h-full p-5 sm:p-6">
      <SectionHead eyebrow="REDEEM" title="办理兑换" right={<StatusPill tone={data?.enabled ? "live" : "paused"}>{config.loading ? "查询中" : data?.enabled ? "兑换开放" : "尚未开放"}</StatusPill>} />

      <ol className="mt-5 grid grid-cols-3 gap-2">
        {steps.map((step, index) => {
          const active = locked ? index === 1 : index === 0;
          const done = locked && index === 0;
          return (
            <li key={step.title} className={`rounded-lg border px-2.5 py-2 ${active ? "border-purple/30 bg-purple/[0.06]" : "border-line bg-well"}`}>
              <p className={`flex items-center gap-1 text-[10px] font-semibold ${active ? "text-purple-deep" : done ? "text-up" : "text-faint"}`}>
                <span className={`grid h-4 w-4 place-items-center rounded-full text-[9px] ${active ? "bg-purple text-white" : done ? "bg-up text-white" : "bg-line text-mute"}`}>{done ? "✓" : index + 1}</span>
                {step.title}
              </p>
              <p className="mt-1 text-[10px] leading-4 text-faint">{step.desc}</p>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 rounded-lg border border-line bg-well px-4 py-2">
        <DataRow label="兑换单价" value={`${fmt(EXCHANGE_COST)} CaBi / 份`} />
        <DataRow label="单次上限" value={`${maxShares} 份`} />
        <DataRow label="CaBi 余额" value={balance !== undefined ? `${formatAssetAmount(balance, 18)} CaBi` : "—"} />
        <DataRow label="按余额可兑" value={affordable !== undefined ? `${affordable} 份` : "—"} />
      </div>

      {config.error ? (
        <p role="alert" className="mt-4 text-sm text-down">
          {config.error}
          <button type="button" onClick={() => void config.refresh()} className="ml-3 underline">重试</button>
        </p>
      ) : !data?.configured ? (
        <p className="mt-4 text-sm leading-6 text-mute">{data?.message || "正在读取兑换配置"}。配置完成后开放兑换；不生成虚拟订单。</p>
      ) : null}

      {!state.connected ? (
        <button onClick={connect} className="btn btn-gold mt-5 min-h-11 w-full"><Wallet size={15} />连接钱包</button>
      ) : !networkOk ? (
        <p className="mt-4 text-sm text-warn">请切换到 {chainConfig.shortName}。</p>
      ) : !account.authenticated ? (
        <div className="mt-5 space-y-3">
          <p className="text-xs leading-6 text-mute">签名登录仅用于保护收货信息与本人订单，不授权任何转账。</p>
          <button disabled={account.busy || !data?.configured} onClick={() => void account.login()} className="btn btn-outline min-h-11 w-full">
            <ShieldCheck size={15} />{account.busy ? "请在钱包中签名…" : "签名登录收货服务"}
          </button>
        </div>
      ) : locked ? (
        <form onSubmit={submitOrder} className="mt-5 space-y-4">
          <div className="rounded-xl border border-up/25 bg-up/[0.06] p-4">
            <p className="flex items-center gap-1.5 text-sm font-medium text-strong"><Lock size={14} className="text-up" />已转账，待提交收货信息</p>
            <p className="mt-1.5 text-xs leading-6 text-mute">
              已转入 {pending.quantity} 份蟹礼 · {formatAssetAmount(BigInt(pending.amount), 18)} CaBi。请勿再次转账；该记录仅保存在本机，提交成功后解除锁定。
            </p>
            <a href={getExplorerTxUrl(pending.hash)} target="_blank" rel="noreferrer" className="mt-1 inline-block break-all font-mono text-[10px] text-purple-deep underline">
              {pending.hash}
            </a>
          </div>
          <label className="block space-y-2 text-xs text-mute"><span>收件人</span><input value={shipping.name} onChange={e => setShipping(s => ({ ...s, name: e.target.value }))} maxLength={60} autoComplete="name" className="field min-h-11 w-full px-3 text-sm" required disabled={submitting} /></label>
          <label className="block space-y-2 text-xs text-mute"><span>联系电话</span><input type="tel" value={shipping.phone} onChange={e => setShipping(s => ({ ...s, phone: e.target.value }))} maxLength={25} autoComplete="tel" className="field min-h-11 w-full px-3 text-sm" required disabled={submitting} /></label>
          <label className="block space-y-2 text-xs text-mute"><span>完整收货地址</span><textarea value={shipping.address} onChange={e => setShipping(s => ({ ...s, address: e.target.value }))} minLength={5} maxLength={500} autoComplete="street-address" rows={3} className="field w-full px-3 py-3 text-sm" required disabled={submitting} /></label>
          <p className="text-xs leading-6 text-mute">收货信息加密保存在服务端，不上链；提交后由后台安排发货。</p>
          <button disabled={submitting} className="btn btn-gold min-h-11 w-full">
            <Gift size={15} />{submitting ? "核验转账并提交…" : "提交兑换单（待发货）"}<ArrowRight size={14} />
          </button>
        </form>
      ) : (
        <form onSubmit={transfer} className="mt-5 space-y-4">
          <label className="block space-y-2 text-xs text-mute">
            <span>兑换份数（单次 1–{maxShares} 份）</span>
            <input type="number" min="1" max={maxShares} step="1" value={quantity} onChange={e => setQuantity(e.target.value)} className="field min-h-11 w-full px-3 text-sm" required disabled={busy} />
          </label>
          <div className="rounded-lg border border-line bg-well px-4 py-2">
            <DataRow label="应付代币" value={`${formatAssetAmount(cost, 18)} CaBi`} />
            <DataRow label="收款地址" value={payee ? <a href={payeeUrl} target="_blank" rel="noreferrer" className="break-all font-mono text-[11px] text-purple-deep underline" title={payee}>{shortAddr(payee)}</a> : "待后台配置"} />
          </div>
          {payee ? (
            <Notice tone="gold" icon={Lock} className="!px-3 !py-2.5">
              <p className="text-[11px] leading-5">代币将转入上方指定收款地址，<b className="text-strong">转入后不可撤回</b>。请核对份数与地址后再在钱包确认转账。</p>
            </Notice>
          ) : null}
          {balance !== undefined && !enough && validQuantity ? (
            <p className="text-xs leading-6 text-down">余额不足，还差 {formatAssetAmount(shortfall, 18)} CaBi；按当前余额最多可兑 {affordable ?? 0} 份。</p>
          ) : null}
          <button disabled={busy || !data?.enabled || !validQuantity || !enough} className="btn btn-gold min-h-11 w-full">
            <ArrowRight size={15} />{busy && controller.transaction?.status === "pending" ? "等待钱包/链上确认…" : transferLabel}
          </button>
          <p className="text-[11px] leading-5 text-faint">第一步只做代币转账，不生成订单；确认收款后页面进入第二步，再填写收货信息提交兑换单。</p>
        </form>
      )}

      {(error || account.error) ? <p role="alert" className="mt-4 text-sm text-down">{error || account.error}</p> : null}
      {notice ? <p role="status" className="mt-4 text-sm leading-6 text-up">{notice}</p> : null}
      <TransactionFeedback controller={controller} />
    </Card>
  );
}
