"use client";
import { useSubscribeConfig } from "@/lib/subscribe-data";
import { DataRow, StatusPill } from "@/components/dapp/ui";
export function LockedNotice() {
  const { data } = useSubscribeConfig();
  return <section className="card p-5 sm:p-6"><StatusPill tone="paused">认购关闭</StatusPill><h2 className="mt-3 text-lg font-semibold">当前不接受新认购</h2><p className="mt-2 text-xs leading-6 text-mute">认购已暂停或达成硬顶。已登记的认购单与已写入领取池的额度仍然有效，领取以链上记录为准。</p><DataRow label="已认购 / 硬顶" value={data ? data.globalSold + " / " + data.hardCap + " 份" : "—"} /><DataRow label="后台收款地址" value={data?.payee || "未设置"} /></section>;
}
