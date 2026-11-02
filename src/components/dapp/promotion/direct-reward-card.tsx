"use client";
import { useStore } from "@/lib/store";
import { usePromotionStats } from "@/lib/subscribe-data";
import { formatAssetAmount } from "@/lib/amounts";
import { TOKENS_PER_SHARE } from "@/lib/constants";
import { Card, DataRow, Metric, SectionHead } from "@/components/dapp/ui";
export function DirectRewardCard() {
  const { state } = useStore(), { stats } = usePromotionStats(state.connected);
  const shares = stats?.directShares, granted = stats?.directRewardShares, progress = shares === undefined ? undefined : shares % 3;
  return <Card className="p-5 sm:p-6"><SectionHead eyebrow="DIRECT REWARD" title="直推奖励" desc="推荐钱包每累计带来 3 份成功认购，服务器增加 1 份奖励额度" /><div className="mt-5 grid grid-cols-3 gap-4"><Metric label="直推认购" value={shares === undefined ? "—" : String(shares)} unit="份" /><Metric label="直推奖励" value={granted === undefined ? "—" : String(granted)} unit="份" /><Metric label="当前进度" value={progress === undefined ? "—" : progress + " / 3"} /></div><div className="mt-5 border-t border-line"><DataRow label="每份代币配额" value={formatAssetAmount(BigInt(TOKENS_PER_SHARE) * 10n ** 18n, 18) + " CaBi"} /><DataRow label="直推奖励配额" value={granted === undefined ? "—" : formatAssetAmount(BigInt(granted * TOKENS_PER_SHARE) * 10n ** 18n, 18) + " CaBi"} /></div><p className="mt-3 text-xs leading-6 text-faint">奖励份数与认购份额一起写入独立领取池；只有后台生成并写入链上额度后才可领取。</p></Card>;
}
