"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { History, RefreshCw, Save, Settings2 } from "lucide-react";
import type { AdminSettingsResponse } from "@/lib/admin-settings";
import { Card, PageHeader, PageStack, SectionTitle } from "@/components/dapp/ui";

function displayTime(at: number) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(at);
}
function displayDetail(detail: string) {
  try {
    const value = JSON.parse(detail);
    return `认购：${value.subscribeLocked.before ? "锁定" : "解锁"} → ${value.subscribeLocked.after ? "锁定" : "解锁"}；兑换：${value.exchangeEnabled.before ? "开启" : "关闭"} → ${value.exchangeEnabled.after ? "开启" : "关闭"}；词库：${value.sensitiveWords.before} → ${value.sensitiveWords.after} 条`;
  } catch { return detail; }
}

export default function OperationalSettingsPage() {
  const [result, setResult] = useState<AdminSettingsResponse | null>(null);
  const [subscribeLocked, setSubscribeLocked] = useState(true);
  const [exchangeEnabled, setExchangeEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const apply = useCallback((next: AdminSettingsResponse) => {
    setResult(next);
    setSubscribeLocked(next.settings.subscribeLocked);
    setExchangeEnabled(next.settings.exchangeEnabled);
  }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/settings", { cache: "no-store", credentials: "same-origin", signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "设置读取失败");
      apply(data);
    } catch (err) { if (!signal?.aborted) setError(err instanceof Error ? err.message : "设置读取失败"); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [apply]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load]);

  const changed = Boolean(result && (subscribeLocked !== result.settings.subscribeLocked || exchangeEnabled !== result.settings.exchangeEnabled));

  async function save() {
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/settings", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscribeLocked, exchangeEnabled, sensitiveWords: result?.settings.sensitiveWords ?? [] }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败");
      apply(data);
      window.dispatchEvent(new Event("cabi-operational-settings-updated"));
      setMessage("设置已保存，操作记录已更新。");
    } catch (err) { setError(err instanceof Error ? err.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  }

  return (
    <PageStack>
      <PageHeader eyebrow="OPERATIONS" title="运营设置" desc="管理服务开放准备与社群词库，查看操作记录" />
      <Card>
        <SectionTitle icon={Settings2} title="服务设置" />
        <p className="mb-5 text-sm leading-6 text-mute">这里保存运营配置。除兑换开关外，服务开关不会改变合约状态，也不会代替钱包签名。</p>
        {loading ? <p className="py-4 text-sm text-mute" role="status">正在读取服务器设置…</p> : <>
          <div className="mb-4 space-y-3 rounded-xl border border-line bg-well p-4 text-xs leading-6">
            <div><strong>认购 USDT 收款地址</strong><p className="break-all font-mono">{result?.settings.subscribePayee || "未配置"}</p><Link href="/admin/subscribe" className="text-purple-deep underline">前往认购管理修改</Link></div>
            <div><strong>兑换 CaBi 收款地址</strong><p className="break-all font-mono">{result?.settings.exchangePayee || "未配置"}</p><Link href="/admin/exchange" className="text-purple-deep underline">前往兑换管理修改</Link></div>
          </div>
          <label className="flex min-h-14 cursor-pointer items-center justify-between gap-4 rounded-xl border border-line p-4">
            <span><strong className="text-sm">暂停认购</strong><small className="mt-1 block text-xs leading-5 text-mute">保存后立即控制认购页面能否发起付款。</small><Link href="/admin/subscribe" className="mt-1 inline-block text-[11px] font-medium text-purple-deep underline">前往认购管理</Link></span>
            <input type="checkbox" checked={subscribeLocked} disabled={!result || saving} onChange={event => setSubscribeLocked(event.target.checked)} className="h-5 w-5 accent-purple" />
          </label>
          <label className="mt-3 flex min-h-14 cursor-pointer items-center justify-between gap-4 rounded-xl border border-line p-4">
            <span><strong className="text-sm">允许兑换</strong><small className="mt-1 block text-xs leading-5 text-mute">关闭后用户无法提交兑换订单（服务端立即生效）</small></span>
            <input type="checkbox" checked={exchangeEnabled} disabled={!result || saving} onChange={event => setExchangeEnabled(event.target.checked)} className="h-5 w-5 accent-purple" />
          </label>
          <div className="mt-5 rounded-xl border border-line bg-well p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-strong">社群敏感词</p>
                <p className="mt-1 text-xs leading-6 text-mute">当前 {result?.settings.sensitiveWords.length ?? 0} 条 · 词库统一在「敏感词库」页维护，保存后立即用于社群发言与工单提交校验。</p>
              </div>
              <Link href="/admin/words" className="btn btn-outline h-9 shrink-0 px-3 text-[11px]">前往敏感词库</Link>
            </div>
          </div>
        </>}
        {error ? <p className="mt-4 text-sm leading-6 text-down" role="alert">{error}</p> : null}
        {message ? <p className="mt-4 text-sm leading-6 text-up" role="status">{message}</p> : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <button onClick={save} disabled={loading || saving || !changed} className="btn btn-gold min-h-11 px-5 text-sm"><Save size={15} />{saving ? "正在保存…" : "保存设置"}</button>
          <button onClick={() => void load()} disabled={loading || saving} className="btn btn-outline min-h-11 px-5 text-sm"><RefreshCw size={15} />重新读取</button>
        </div>
      </Card>
      <Card>
        <SectionTitle icon={History} title="最近操作" />
        {result?.logs.length ? <ol className="divide-y divide-line">{result.logs.map(entry => <li key={entry.id} className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><strong>{entry.action}</strong><time className="text-xs text-mute" dateTime={new Date(entry.at).toISOString()}>{displayTime(entry.at)}</time></div>
          <p className="mt-1 break-words text-xs leading-6 text-mute">{entry.actor} · {displayDetail(entry.detail)}</p>
        </li>)}</ol> : <p className="py-4 text-sm text-mute">{loading ? "正在读取操作记录…" : "暂无操作记录"}</p>}
      </Card>
    </PageStack>
  );
}
