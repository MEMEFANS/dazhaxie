"use client";
import { useSubscribeConfig } from "@/lib/subscribe-data";
import { DataRow, StatusPill } from "@/components/dapp/ui";
export function LockedNotice() {
  const { data } = useSubscribeConfig();
  return <section className="card p-5 sm:p-6"><StatusPill tone="paused">认购关闭</StatusPill><h2 className="mt-3 text-lg font-semibold">认购暂未开放或已售罄</h2><p className="mt-2 text-xs leading-6 text-mute">已完成的认购不受影响，可在代币中心正常领取。</p><DataRow label="已认购 / 总量" value={data ? data.globalSold + " / " + data.hardCap + " 份" : "—"} /></section>;
}
