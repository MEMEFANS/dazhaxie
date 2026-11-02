"use client";
import { useSubscribeConfig } from "@/lib/subscribe-data";
import { formatAssetAmount } from "@/lib/amounts";
import { DataRow, Metric, Panel, ProgressRing, StatusPill } from "@/components/dapp/ui";
export function CapHeader() {
  const query = useSubscribeConfig(), d = query.data;
  const closed = Boolean(d && (!d.enabled || d.remainingGlobal <= 0));
  const remaining = d ? d.remainingGlobal : 0;
  return <Panel className="p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="kicker">SUBSCRIPTION</p><h1 className="mt-1.5 text-2xl font-semibold">份额认购</h1>
        <p className="mt-2 text-xs text-mute">{d ? "转账单价 " + formatAssetAmount(BigInt(d.unitPrice) * 10n ** BigInt(d.usdtDecimals), d.usdtDecimals) + " USDT / 份 · 服务器核验记账" : "认购配置查询完成后显示实际价格与额度"}</p></div>
      <StatusPill tone={d ? closed ? "paused" : "live" : query.status === "error" ? "error" : "neutral"}>{d ? closed ? "认购关闭" : "认购进行中" : query.status === "loading" ? "查询中" : query.status === "error" ? "查询失败" : "等待配置"}</StatusPill>
    </div>
    <div className="mt-5 grid items-center gap-6 sm:grid-cols-[auto_minmax(0,1fr)]">
      <ProgressRing value={d?.globalSold || 0} max={d?.hardCap || 1} size={132} label={d ? "已认购" : "待查询"} sublabel={d ? d.globalSold + " / " + d.hardCap : "—"} />
      <div><div className="grid grid-cols-2 gap-4"><Metric label="剩余份额" value={d ? remaining.toString() : "—"} unit="份" /><Metric label="硬顶" value={d ? d.hardCap.toString() : "—"} unit="份" /></div>
        <div className="mt-3 border-t border-line"><DataRow label="软顶预警" value={d ? d.softCap + " 份（不拦截）" : "—"} /><DataRow label="认购方式" value="USDT 直转 + 服务器记账" /></div></div>
    </div>
  </Panel>;
}
