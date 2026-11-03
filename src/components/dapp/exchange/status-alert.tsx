"use client";
import { Ban } from "lucide-react";
import { useRedemptionConfig } from "@/lib/redemption-client";
import { Notice } from "@/components/dapp/ui";
export function ExchangeClosedAlert() {
  const { data, loading, refresh } = useRedemptionConfig();
  if (loading || data?.enabled) return null;
  return (
    <Notice tone="gray" icon={Ban}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-strong">兑换暂未开放</p>
        {!data?.configured ? <button type="button" onClick={() => void refresh()} className="min-h-10 shrink-0 px-2 text-xs text-purple-deep underline">重新加载</button> : null}
      </div>
    </Notice>
  );
}
