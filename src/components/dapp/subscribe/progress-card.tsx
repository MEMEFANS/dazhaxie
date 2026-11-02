"use client";
import { CircleHelp } from "lucide-react";
import { useSubscribeConfig } from "@/lib/subscribe-data";
import { formatAssetAmount } from "@/lib/amounts";
import { SectionTitle } from "@/components/dapp/ui";
export function ProgressCard() {
  const { data } = useSubscribeConfig();
  const rules = [
    data ? `转账单价 ${formatAssetAmount(BigInt(data.unitPrice) * 10n ** BigInt(data.usdtDecimals), data.usdtDecimals)} USDT / 份，每份获得 ${data.tokensPerShare.toLocaleString("en-US")} CaBi 配额。` : "认购价格与可用额度以页面显示为准。",
    data ? `每钱包最多 ${data.maxShares} 份，总份额硬顶 ${data.hardCap} 份；软顶 ${data.softCap} 份只预警、不拦截。` : "认购信息暂未就绪时，无法提交认购。",
    "认购直接向后台配置的收款地址转入 USDT，不调用任何认购合约；转账成功后提交哈希，由服务器核验并登记认购单。",
    "进入 DApp 前须用邀请码免费绑定推荐关系；服务器保存，认购自动沿用，绑定后不可更改。",
    "认购单、直推奖励与团队极差由服务器聚合计算，后台生成可领额度后写入独立领取池。",
    "领取时二选一：直接领取 50%，剩余 50% 销毁或留池；或领取 70%，剩余 30% 转入 LP 地址并支付 30% USDT 等值。",
    "同一交易哈希只能登记一次认购单；核验中的转账不会重复记账。",
  ];
  return <section className="card p-5 sm:p-6"><SectionTitle icon={CircleHelp} title="认购规则" /><div className="divide-y divide-line">{rules.map((rule, i) => <p key={i} className="py-3 text-xs leading-6 text-mute">{i + 1}. {rule}</p>)}</div></section>;
}
