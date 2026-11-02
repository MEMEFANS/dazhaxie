"use client";

// 常见问题：折叠列表（原生 details，无额外依赖）

import { ChevronDown } from "lucide-react";
import {
  EXCHANGE_COST,
  HARD_CAP,
  MAX_EXCHANGE_PER_TIME,
  MAX_SHARES,
  MIN_SHARES,
  TOKENS_PER_SHARE,
  fmt,
} from "@/lib/constants";
import { Card } from "@/components/dapp/ui";

const FAQS = [
  {
    q: "认购后怎么拿到 CaBi？",
    a: "使用认购时的钱包进入代币中心，查看自动记录的可领数量和开放时间。到时按页面显示的规则确认领取，实际结果以交易确认为准。",
  },
  {
    q: "兑换一份蟹礼需要多少代币？",
    a: `每份 ${fmt(EXCHANGE_COST)} CaBi，单次最多 ${MAX_EXCHANGE_PER_TIME} 份；确认后把代币转入后台指定收款地址，再填写收货信息等待发货。`,
  },
  {
    q: "一个人最多能认购多少？",
    a: `单账户累计可认购 ${MIN_SHARES}–${MAX_SHARES} 份；全局硬顶 ${fmt(HARD_CAP)} 份，达到后认购入口关闭。`,
  },
  {
    q: "每份份额对应多少配额？",
    a: `每份对应 ${fmt(TOKENS_PER_SHARE)} CaBi 空投配额，直推与团队奖励份数按现有规则另行计入。`,
  },
  {
    q: "商品库存和发货怎么查？",
    a: "蟹礼页读取链上库存。签名登录后可填写收货信息；兑换交易确认后生成待发货订单，物流与状态在我的兑换订单中查询。",
  },
];

export function FaqList() {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[18px] font-semibold tracking-tight text-strong">常见问题</h2>
        <span className="kicker">FAQ</span>
      </div>
      <div className="mt-2 divide-y divide-line">
        {FAQS.map((item) => (
          <details key={item.q} className="group py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[12px] font-medium leading-5 text-strong">
              {item.q}
              <ChevronDown
                size={14}
                className="shrink-0 text-faint transition-transform duration-200 group-open:rotate-180"
              />
            </summary>
            <p className="mt-2 pr-6 text-[12px] leading-6 text-mute">{item.a}</p>
          </details>
        ))}
      </div>
    </Card>
  );
}
