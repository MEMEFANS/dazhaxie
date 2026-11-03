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
    a: "认购成功后，CaBi 自动计入可领额度。开放领取后在代币中心自行领取，可选择直接领取 50% 或领取 70%。",
  },
  {
    q: "兑换一份蟹礼需要多少代币？",
    a: `每份 ${fmt(EXCHANGE_COST)} CaBi，单次最多兑换 ${MAX_EXCHANGE_PER_TIME} 份。确认转账后填写收货信息即可等待发货。`,
  },
  {
    q: "一个人最多能认购多少份？",
    a: `每个钱包限购 ${MIN_SHARES}–${MAX_SHARES} 份，总量 ${fmt(HARD_CAP)} 份，售完即止。`,
  },
  {
    q: "每份份额包含多少 CaBi？",
    a: `每份含 ${fmt(TOKENS_PER_SHARE)} CaBi，直推与团队奖励按规则另行累计。`,
  },
  {
    q: "兑换后怎么查发货？",
    a: "在蟹礼页提交收货信息后生成订单，发货状态与物流可在「我的订单」中查询。",
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
