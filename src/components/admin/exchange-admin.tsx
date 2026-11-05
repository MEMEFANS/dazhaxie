"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, Gift, Loader2, Package, RefreshCw, Save, Search, ShieldAlert, XCircle } from "lucide-react";
import { getAddress, isAddress, zeroAddress } from "viem";
import { useStore } from "@/lib/store";
import { getExplorerAddressUrl, getExplorerTxUrl } from "@/lib/chain-config";
import { useRedemptionConfig, redemptionRequest, notifyRedemptionChanged } from "@/lib/redemption-client";
import type { RedemptionOrder } from "@/lib/redemption";
import type { AdminAuditEntry, OperationalSettings } from "@/lib/admin-settings";
import { shortAddr } from "@/lib/constants";
import { formatAssetAmount } from "@/lib/amounts";
import { Card, DataRow, EmptyRow, Modal, Notice, SectionTitle, StatusPill } from "@/components/dapp/ui";

const statusLabels: Record<RedemptionOrder["status"], string> = { paid: "待发货", shipped: "已发货", delivered: "已完结", cancelled: "已取消" };
const statusTones: Record<RedemptionOrder["status"], "live" | "soon" | "paused"> = { paid: "soon", shipped: "live", delivered: "paused", cancelled: "paused" };
const PAGE_SIZE = 10;

export default function ExchangeAdmin() {
  const { toggleExchange } = useStore();
  const config = useRedemptionConfig();
  const [settings, setSettings] = useState<OperationalSettings | null>(null);
  const [logs, setLogs] = useState<AdminAuditEntry[]>([]);
  const [payeeInput, setPayeeInput] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [orders, setOrders] = useState<RedemptionOrder[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [orderPage, setOrderPage] = useState(1);
  const [orderStatus, setOrderStatus] = useState("all");
  const [orderQuery, setOrderQuery] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [cancelTarget, setCancelTarget] = useState<RedemptionOrder | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [shipping, setShipping] = useState<Record<string, { carrier: string; trackingNumber: string }>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const currentPayee = settings?.exchangePayee || config.data?.payee || "";
  const exchangeOn = config.data?.exchangeEnabled ?? settings?.exchangeEnabled ?? false;
  const payeeLogs = logs.filter(entry => entry.action === "更新兑换收款地址").slice(0, 8);
  const orderPages = Math.max(1, Math.ceil(ordersTotal / PAGE_SIZE));

  async function loadSettings() {
    try {
      const body = await redemptionRequest<{ settings: OperationalSettings; logs: AdminAuditEntry[] }>("/api/admin/settings");
      setSettings(body.settings);
      setLogs(body.logs);
      setPayeeInput(body.settings.exchangePayee);
    } catch (e) { setError(e instanceof Error ? e.message : "设置读取失败"); }
  }
  const loadOrders = useCallback(async () => {
    try {
      const params = new URLSearchParams({ q: orderSearch, status: orderStatus === "all" ? "" : orderStatus, page: String(orderPage), pageSize: String(PAGE_SIZE) });
      const body = await redemptionRequest<{ items: RedemptionOrder[]; total: number }>(`/api/admin/redemption?${params}`);
      setOrders(body.items);
      setOrdersTotal(body.total);
    } catch (e) { setError(e instanceof Error ? e.message : "订单读取失败"); }
  }, [orderSearch, orderStatus, orderPage]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadSettings(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadOrders(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadOrders]);

  function requestPayee(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    const value = payeeInput.trim();
    if (!isAddress(value, { strict: false })) { setError("收款地址格式不正确，请填写合法的 0x 地址"); return; }
    if (value.toLowerCase() === zeroAddress) { setError("收款地址不能是零地址"); return; }
    const normalized = getAddress(value.toLowerCase());
    if (normalized === currentPayee) { setNotice("收款地址未发生变化"); return; }
    setConfirmValue(normalized);
    setConfirming(true);
  }
  async function applyPayee() {
    if (!settings || !confirmValue) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const body = await redemptionRequest<{ settings: OperationalSettings; logs: AdminAuditEntry[] }>("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify({ subscribeLocked: settings.subscribeLocked, exchangeEnabled: settings.exchangeEnabled, sensitiveWords: settings.sensitiveWords, exchangePayee: confirmValue }),
      });
      setSettings(body.settings);
      setLogs(body.logs);
      setPayeeInput(body.settings.exchangePayee);
      setNotice("兑换收款地址已更新，新订单将转入该地址；旧订单仍按下单时锁定的地址核对。");
      window.dispatchEvent(new Event("cabi-operational-settings-updated"));
      notifyRedemptionChanged();
      await config.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "收款地址保存失败"); }
    finally { setSaving(false); setConfirming(false); }
  }

  async function ship(id: string) {
    setBusy(id);
    setError("");
    try {
      const values = shipping[id];
      await redemptionRequest("/api/admin/redemption", { method: "PATCH", body: JSON.stringify({ id, ...values }) });
      await loadOrders();
      setNotice("已标记发货。");
    } catch (e) { setError(e instanceof Error ? e.message : "发货未保存"); }
    finally { setBusy(""); }
  }
  async function saveNote(id: string) {
    setBusy(id);
    setError("");
    try {
      const order = await redemptionRequest<{ order: RedemptionOrder }>("/api/admin/redemption", { method: "PATCH", body: JSON.stringify({ id, note: notes[id] ?? "" }) });
      setOrders(list => list.map(item => item.id === id ? order.order : item));
      setNotice("备注已保存。");
    } catch (e) { setError(e instanceof Error ? e.message : "备注未保存"); }
    finally { setBusy(""); }
  }
  async function cancelOrder() {
    if (!cancelTarget || !cancelReason.trim()) { setError("请填写取消原因"); return; }
    setBusy(cancelTarget.id);
    setError("");
    try {
      await redemptionRequest("/api/admin/redemption", { method: "PATCH", body: JSON.stringify({ id: cancelTarget.id, action: "cancel", reason: cancelReason.trim() }) });
      setCancelTarget(null);
      setCancelReason("");
      await loadOrders();
      setNotice("订单已取消，请在线下完成退款并保留凭证。");
    } catch (e) { setError(e instanceof Error ? e.message : "取消失败"); }
    finally { setBusy(""); }
  }
  async function exportOrders() {
    setError("");
    try {
      const params = new URLSearchParams({ q: orderSearch, status: orderStatus === "all" ? "" : orderStatus });
      const response = await fetch(`/api/admin/redemption/export?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("导出失败，请确认登录状态");
      const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url;
      link.download = `cabi-orders-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof Error ? e.message : "导出失败"); }
  }

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle icon={Gift} title="兑换 CaBi 收款地址" extra={<StatusPill tone={config.data?.enabled ? "live" : "paused"}>{config.data?.enabled ? "开放中" : "未开放"}</StatusPill>} />
        <p className="mb-3 text-xs leading-6 text-mute">此地址接收实物兑换的 CaBi。认购 USDT 收款请到 <Link href="/admin/subscribe" className="text-purple-deep underline">认购管理</Link> 设置。</p>
        <div className="rounded-lg border border-line bg-well px-4 py-2">
          <DataRow label="当前收款地址" value={currentPayee ? <a href={getExplorerAddressUrl(currentPayee)} target="_blank" rel="noreferrer" className="break-all font-mono text-[11px] text-purple-deep underline">{currentPayee}</a> : "未配置"} />
          <DataRow label="兑换单价" value={`${formatAssetAmount(BigInt(config.data?.unitPrice || "3500000000000000000000"), 18)} CaBi / 份`} />
          <DataRow label="单次上限" value={`${config.data?.maxPerTransaction ?? 20} 份`} />
        </div>
        <Notice tone="red" icon={ShieldAlert} className="mt-3 !px-3 !py-2.5">
          <p className="text-[11px] leading-5">这是代币收款地址，修改后立即生效，改错会导致用户转入错误地址且无法找回。请在保存前核对完整地址。</p>
        </Notice>
        <form onSubmit={requestPayee} className="mt-4 space-y-3 border-t border-line pt-4">
          <label className="block space-y-2 text-xs text-mute"><span>收款地址（默认黑洞地址，可改为任意项目地址，即「销毁或归集」由运营决定）</span>
            <input value={payeeInput} onChange={e => setPayeeInput(e.target.value)} placeholder="0x…" maxLength={42} spellCheck={false} className="field min-h-11 w-full break-all px-3 font-mono text-xs" disabled={saving} />
          </label>
          <button disabled={saving || !settings} className="btn btn-gold min-h-11 px-4 text-xs"><Save size={14} />保存收款地址</button>
        </form>
        {payeeLogs.length ? <div className="mt-4 border-t border-line pt-3">
          <p className="kicker">修改记录</p>
          <ul className="mt-2 space-y-1.5">
            {payeeLogs.map(entry => {
              let detail: { before?: string; after?: string } = {};
              try { detail = JSON.parse(entry.detail); } catch { /* 保持空明细 */ }
              return <li key={entry.id} className="text-[11px] leading-5 text-mute">
                {new Date(entry.at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                {" · "}{shortAddr(entry.actor)}：{detail.before ? shortAddr(detail.before) : "—"} → {detail.after ? shortAddr(detail.after) : "—"}
              </li>;
            })}
          </ul>
        </div> : null}
        <button onClick={toggleExchange} className="btn btn-outline mt-4 min-h-11 px-4 text-xs">{exchangeOn ? "关闭运营兑换入口" : "打开运营兑换入口"}</button>
        {config.error ? <p role="alert" className="mt-3 text-sm text-down">{config.error}</p> : null}
        {notice ? <p role="status" className="mt-3 text-sm text-up">{notice}</p> : null}
      </Card>

      <Card>
        <SectionTitle icon={Package} title="兑换订单与发货" extra={<button onClick={() => void loadOrders()} className="btn btn-outline min-h-11 px-3 text-xs"><RefreshCw size={13} />刷新</button>} />
        {error ? <p role="alert" className="mb-3 text-sm text-down">{error}</p> : null}
        <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex flex-wrap rounded-full border border-line bg-well p-0.5">
            {[{ key: "all", label: "全部" }, { key: "paid", label: "待发货" }, { key: "shipped", label: "已发货" }, { key: "delivered", label: "已完结" }, { key: "cancelled", label: "已取消" }].map(item => (
              <button key={item.key} onClick={() => { setOrderStatus(item.key); setOrderPage(1); }} className={`h-7 rounded-full px-2.5 text-[10px] transition ${orderStatus === item.key ? "seg-active font-medium" : "text-mute hover:text-strong"}`}>{item.label}</button>
            ))}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <form onSubmit={e => { e.preventDefault(); setOrderPage(1); setOrderSearch(orderQuery.trim()); }} className="flex min-w-0 flex-1 items-center gap-2">
              <label className="relative min-w-0 flex-1 lg:w-56">
                <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input value={orderQuery} onChange={e => setOrderQuery(e.target.value)} placeholder="地址 / 订单号 / 收货人" className="field h-9 w-full pl-8 pr-3 text-[12px]" />
              </label>
              <button type="submit" className="btn btn-outline h-9 px-3 text-[11px]">搜索</button>
            </form>
            <button onClick={() => void exportOrders()} className="btn btn-outline h-9 shrink-0 px-3 text-[11px]"><Download size={12} /> CSV</button>
          </div>
        </div>
        {!orders.length ? <EmptyRow text="暂无匹配的已转账兑换单" /> : <div className="space-y-4">
          {orders.map(order => (
            <article key={order.id} className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <p className="text-sm font-medium">{order.quantity} 份 · {formatAssetAmount(BigInt(order.amount), 18)} CaBi</p>
                <StatusPill tone={statusTones[order.status]}>{statusLabels[order.status]}</StatusPill>
              </div>
              <p className="mt-2 break-all font-mono text-[10px] text-faint">{order.id}<br />用户 {order.address}<br />收款 {order.payee}</p>
              <p className="mt-2 text-xs leading-6">{order.shipping.name} · {order.shipping.phone}<br />{order.shipping.address}</p>
              {order.transactionHash ? <a href={getExplorerTxUrl(order.transactionHash)} target="_blank" rel="noreferrer" className="mt-1 inline-block break-all font-mono text-[10px] text-purple-deep underline">转账 {order.transactionHash}</a> : null}
              {order.carrier ? <p className="mt-2 text-xs leading-6">{order.carrier} · {order.trackingNumber}</p> : null}
              {order.status !== "cancelled" ? <div className="mt-3 space-y-2">
                <textarea rows={2} maxLength={200} value={notes[order.id] ?? order.note ?? ""} onChange={e => setNotes(s => ({ ...s, [order.id]: e.target.value }))} placeholder="订单备注（最多 200 字）" className="field w-full px-3 py-2 text-xs" disabled={busy === order.id} />
                <div className="flex flex-wrap gap-2">
                  <button disabled={busy === order.id} onClick={() => void saveNote(order.id)} className="btn btn-outline min-h-11 px-3 text-xs">保存备注</button>
                  {order.status === "paid" ? <button disabled={busy === order.id} onClick={() => { setCancelTarget(order); setCancelReason(""); }} className="btn min-h-11 border border-down/30 bg-down/[0.06] px-3 text-xs text-down hover:bg-down/[0.12]"><XCircle size={13} /> 取消 / 退款</button> : null}
                </div>
              </div> : <p className="mt-2 text-[11px] text-down">已取消，退款离线处理{order.note ? ` · 原因：${order.note}` : ""}</p>}
              {order.status === "paid" ? <div className="mt-3 grid gap-2">
                <input placeholder="物流公司" value={shipping[order.id]?.carrier || ""} onChange={e => setShipping(s => ({ ...s, [order.id]: { carrier: e.target.value, trackingNumber: s[order.id]?.trackingNumber || "" } }))} maxLength={60} className="field min-h-11 w-full px-3 text-sm" />
                <input placeholder="真实运单号" value={shipping[order.id]?.trackingNumber || ""} onChange={e => setShipping(s => ({ ...s, [order.id]: { trackingNumber: e.target.value, carrier: s[order.id]?.carrier || "" } }))} maxLength={80} className="field min-h-11 w-full px-3 text-sm" />
                <button disabled={busy === order.id} onClick={() => void ship(order.id)} className="btn btn-gold min-h-11 px-4 text-xs">保存物流并标记已发货</button>
              </div> : null}
            </article>
          ))}
        </div>}
        <div className="mt-3 flex items-center justify-between text-[11px] text-faint">
          <span>共 <span className="num">{ordersTotal}</span> 单 · 第 <span className="num">{orderPage}</span>/<span className="num">{orderPages}</span> 页（已取消订单仅保留记录）</span>
          <div className="flex gap-1.5">
            <button onClick={() => setOrderPage(p => Math.max(1, p - 1))} disabled={orderPage <= 1} className="btn btn-outline h-7 w-7 px-0" aria-label="上一页"><ChevronLeft size={13} /></button>
            <button onClick={() => setOrderPage(p => Math.min(orderPages, p + 1))} disabled={orderPage >= orderPages} className="btn btn-outline h-7 w-7 px-0" aria-label="下一页"><ChevronRight size={13} /></button>
          </div>
        </div>
      </Card>

      {confirming ? <Modal onClose={() => setConfirming(false)}>
        <p className="text-sm font-semibold text-strong">确认修改兑换收款地址？</p>
        <p className="mt-2 break-all font-mono text-[11px] leading-5 text-down">{confirmValue}</p>
        <p className="mt-2 text-xs leading-6 text-mute">保存后立即生效，用户新提交的兑换将转入该地址；已提交订单仍按下单时锁定的地址核对。地址错误会导致代币无法找回。</p>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <button onClick={() => setConfirming(false)} className="btn btn-outline min-h-11 text-xs">取消</button>
          <button disabled={saving} onClick={() => void applyPayee()} className="btn btn-gold min-h-11 text-xs">{saving ? "保存中…" : "确认保存"}</button>
        </div>
      </Modal> : null}

      {cancelTarget ? <Modal onClose={() => setCancelTarget(null)}>
        <p className="text-sm font-semibold text-strong">取消兑换订单并退款？</p>
        <p className="mt-2 text-xs leading-6 text-mute">{cancelTarget.quantity} 份 · {cancelTarget.shipping.name} · <span className="num">{cancelTarget.id}</span></p>
        <p className="mt-2 text-xs leading-6 text-down">仅未发货订单可取消。取消后订单状态不可恢复，退款需在线下完成；请填写原因以便审计追溯。</p>
        <textarea rows={3} maxLength={200} value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="取消 / 退款原因（必填，最多 200 字）" className="field mt-3 w-full resize-none px-3 py-2 text-xs" />
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button onClick={() => setCancelTarget(null)} className="btn btn-outline min-h-11 text-xs">返回</button>
          <button disabled={busy === cancelTarget.id || !cancelReason.trim()} onClick={() => void cancelOrder()} className="btn min-h-11 border border-down/40 bg-down/[0.08] text-xs text-down hover:bg-down/[0.14]">{busy === cancelTarget.id ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />} 确认取消</button>
        </div>
      </Modal> : null}
    </div>
  );
}
