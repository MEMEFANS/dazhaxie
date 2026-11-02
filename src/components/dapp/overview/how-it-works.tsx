"use client";

// 流程：认购 / 持有 / 兑换，三段各一句

import { EXCHANGE_COST, TOKENS_PER_SHARE, UNIT_PRICE, fmt } from "@/lib/constants";
import { Panel, SectionHead } from "@/components/dapp/ui";

const STEPS = [
  {
    no: "01",
    title: "认购",
    desc: `${UNIT_PRICE} USDT 认购 1 份生态份额，单账户限购 1–2 份。`,
  },
  {
    no: "02",
    title: "领取",
    desc: `每份对应 ${fmt(TOKENS_PER_SHARE)} CaBi 配额，认购记录自动计入资格。查看代币中心的开放时间，到时自行领取。`,
  },
  {
    no: "03",
    title: "兑换",
    desc: `${fmt(EXCHANGE_COST)} CaBi 兑换 1 份实物蟹礼：代币转入后台指定收款地址，再填写收货信息。`,
  },
];

export function HowItWorks() {
  return (
    <Panel className="p-5 sm:p-6">
      <SectionHead eyebrow="HOW IT WORKS" title="流程" desc="三步完成从认购到实物兑换" />
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <div
            key={step.no}
            className={`border-line sm:border-l sm:pl-4 ${
              i === 0 ? "sm:border-l-0 sm:pl-0" : ""
            }`}
          >
            <p className="num text-[11px] text-faint">{step.no}</p>
            <p className="mt-1.5 text-[13px] font-medium text-strong">{step.title}</p>
            <p className="mt-1 text-[12px] leading-5 text-mute">{step.desc}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}
