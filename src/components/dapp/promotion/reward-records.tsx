"use client";
import { useStore } from "@/lib/store";
import { contracts, getExplorerAddressUrl } from "@/lib/chain-config";
import { Card, SectionHead } from "@/components/dapp/ui";
export function RewardRecords() {
  const { state } = useStore();
  return <Card className="p-5 sm:p-6">
    <SectionHead eyebrow="REWARD LEDGER" title="奖励历史记录" />
    <p className="mt-4 rounded-lg border border-dashed border-line p-4 text-xs leading-6 text-mute">认购单保存在服务器数据库，领取记录保存在链上；两者都可在下方入口核对。当前页面不还原浏览器本地历史。</p>
    <div className="mt-3 flex flex-wrap gap-3">
      {state.connected ? <a href={getExplorerAddressUrl(state.address)} target="_blank" rel="noreferrer" className="btn btn-outline min-h-11 px-4 text-xs">查看我的链上交易</a> : null}
      {contracts.claimPool ? <a href={getExplorerAddressUrl(contracts.claimPool)} target="_blank" rel="noreferrer" className="btn btn-outline min-h-11 px-4 text-xs">查看 CaBi 领取池</a> : null}
      {contracts.rewardPool ? <a href={getExplorerAddressUrl(contracts.rewardPool)} target="_blank" rel="noreferrer" className="btn btn-outline min-h-11 px-4 text-xs">查看旧版奖励池</a> : null}
    </div>
  </Card>;
}
