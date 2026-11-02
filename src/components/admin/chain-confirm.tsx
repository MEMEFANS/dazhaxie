"use client";

// 链上参数二次确认：先展示「现值 → 新值 + 不可逆后果」，再由用户确认后进入钱包签名。
// 取消不触发任何链上请求；确认后的成功/失败仍由 useContractTransaction 写入审计。

import { useEffect } from "react";

export interface ChainConfirmRow { label: string; from: string; to: string }

export function ChainConfirmModal({ open, title, rows, consequence, confirmLabel = "确认并调用钱包签名", busy = false, onCancel, onConfirm }: {
  open: boolean;
  title: string;
  rows: ChainConfirmRow[];
  consequence: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function handle(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[85] grid place-items-center overflow-y-auto bg-plum/50 p-4 backdrop-blur-sm"
      onClick={() => { if (!busy) onCancel(); }}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="chain-confirm-title" className="card animate-pop-in w-full max-w-[480px] p-6 shadow-pop" onClick={event => event.stopPropagation()}>
        <span className="kicker text-gold">ON-CHAIN CONFIRMATION</span>
        <h3 id="chain-confirm-title" className="mt-2 text-[18px] font-semibold text-strong">{title}</h3>
        <div className="mt-4 space-y-3 rounded-lg border border-line bg-well p-3">
          {rows.map(row => (
            <div key={row.label} className="text-[12px] leading-5">
              <p className="text-[11px] text-faint">{row.label}</p>
              <p className="mt-0.5 break-all text-mute"><span>{row.from}</span><span className="mx-2 text-gold">→</span><span className="font-medium text-strong">{row.to}</span></p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] leading-5 text-warn">{consequence}</p>
        <p className="mt-2 text-[11px] leading-5 text-faint">参数直接写入合约，提交后不可撤销。确认后仍需在钱包中签名并等待链上确认；取消不会发出任何链上请求。</p>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onCancel} disabled={busy} aria-label="取消链上操作" className="btn btn-outline h-10 flex-1 text-[12px]">取消</button>
          <button type="button" onClick={onConfirm} disabled={busy} aria-label="确认执行链上操作" className="btn btn-gold h-10 flex-1 text-[12px]">{busy ? "正在校验 / 等待钱包…" : confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
