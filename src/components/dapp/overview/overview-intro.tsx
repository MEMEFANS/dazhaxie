"use client";

// 项目概览：两段说明 + 关键参数数据行（不写规则细节）

import { useStore } from "@/lib/store";
import {
  EXCHANGE_COST,
  HARD_CAP,
  MAX_EXCHANGE_PER_TIME,
  TOKENS_PER_SHARE,
  TOTAL_SUPPLY,
  fmt,
} from "@/lib/constants";
import { useSubscribeConfig } from "@/lib/subscribe-data";
import { DataRow, Panel } from "@/components/dapp/ui";

export function OverviewIntro() {
  const { state } = useStore();
  const subscribe = useSubscribeConfig();
  const chain = state.chainId > 0 ? `Chain ${state.chainId}` : "网络未连接";

  return (
    <section className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
      <Panel className="p-5 sm:p-6">
        <p className="kicker">ABOUT</p>
        <h2 className="mt-1.5 text-[20px] font-semibold tracking-tight text-strong">项目概览</h2>
        <div className="mt-3 space-y-2.5 text-[13px] leading-6 text-mute">
          <p>
            蟹比特把实物蟹礼与链上份额连接：先用 USDT 认购生态份额，每份对应固定数量的 CaBi
            配额，持有后可在兑换商城换实物礼盒。
          </p>
          <p>
            CaBi 总量 {fmt(TOTAL_SUPPLY / 100000000)} 亿枚、永不增发；空投池绑定{" "}
            {fmt(HARD_CAP)} 份硬顶。份额、配额与兑换记录等待数据服务接入。
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {["实物兑换", "链上份额", "转入指定地址"].map((tag) => (
            <span
              key={tag}
              className="inline-flex h-6 items-center rounded-md border border-line bg-plum/5 px-2 text-[11px] text-mute"
            >
              {tag}
            </span>
          ))}
        </div>
      </Panel>

      <Panel className="p-5 sm:p-6">
        <p className="kicker">PARAMETERS</p>
        <h2 className="mt-1.5 text-[20px] font-semibold tracking-tight text-strong">关键参数</h2>
        <div className="mt-3 divide-y divide-line">
          <DataRow label="网络" value={chain} mono={false} />
          <DataRow label="认购资产" value="USDT" mono={false} />
          <DataRow label="认购单价" value={`${fmt(subscribe.data?.unitPrice ?? 50)} USDT / 份（分档 50 / 55 / 60 / 70）`} />
          <DataRow label="硬顶" value={`${fmt(HARD_CAP)} 份`} />
          <DataRow label="每份配额" value={`${fmt(TOKENS_PER_SHARE)} CaBi`} />
          <DataRow label="兑换单价" value={`${fmt(EXCHANGE_COST)} CaBi / 份`} />
          <DataRow label="单次兑换上限" value={`${MAX_EXCHANGE_PER_TIME} 份`} />
        </div>
      </Panel>
    </section>
  );
}
