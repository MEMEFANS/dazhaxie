"use client";

import { ExternalLink } from "lucide-react";
import { chainConfig, contracts, getSwapUrl, tradingMode } from "@/lib/chain-config";
import { usePancakeTaxData } from "@/lib/pancake-data";

export function PancakeSwapLink({ className = "" }: { className?: string }) {
  const query = usePancakeTaxData();
  if (tradingMode !== "pancake") return null;
  const url = getSwapUrl();
  const failed = query.status === "error" || Boolean(query.error);
  const ready = Boolean(contracts.token && !chainConfig.isTestnet && query.status === "ready" && !failed && query.data?.bound && query.data.liquid && url);
  const reason = query.status === "loading" ? "正在加载交易信息" : failed ? "交易暂不可用，请稍后重试" : "交易暂未开放";
  return <div className={className}>
    {ready && url ? <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-gold min-h-11 w-full gap-2 px-4 text-sm">去交易 <ExternalLink size={14} /></a>
      : <button type="button" disabled className="btn btn-outline min-h-11 w-full px-4 text-xs">{reason}</button>}
    <p className="mt-2 text-xs leading-6 text-mute">将打开外部交易页面，请在钱包中核对交易信息。</p>
    {failed ? <button type="button" onClick={query.refresh} className="mt-1 min-h-11 text-xs text-mute underline">重试</button> : null}
  </div>;
}
