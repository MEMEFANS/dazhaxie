"use client";
import Image from "next/image";
import { useRedemptionConfig } from "@/lib/redemption-client";
import { EXCHANGE_COST, MAX_EXCHANGE_PER_TIME, fmt } from "@/lib/constants";
import { DataRow, Panel } from "@/components/dapp/ui";

export default function MarketInfo() {
  const { data } = useRedemptionConfig();
  return (
    <Panel className="h-full p-5 sm:p-6">
      <div className="relative mb-5 aspect-[4/3] overflow-hidden rounded-xl bg-[#f7effb]">
        <Image src="/images/xiebit-gift-v4.webp" alt="蟹礼礼盒示意插画" fill sizes="(max-width:1023px) 90vw,480px" className="object-cover" />
        <span className="absolute bottom-2 right-2 rounded-full bg-white/85 px-2.5 py-1 text-[10px] text-mute">蟹礼示意图</span>
      </div>
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <p className="kicker">REDEEM MARKET</p>
          <h2 className="mt-1.5 text-lg font-semibold">大闸蟹礼盒</h2>
          <p className="mt-1 text-xs leading-6 text-mute">用 CaBi 兑换一份心意，鲜美蟹礼送到家。</p>
        </div>
      </div>
      <div className="mt-4 divide-y divide-line border-t border-line">
        <DataRow label="兑换单价" value={`${fmt(EXCHANGE_COST)} CaBi / 份`} />
        <DataRow label="单次可兑" value={`1–${data?.maxPerTransaction ?? MAX_EXCHANGE_PER_TIME} 份`} />
      </div>
    </Panel>
  );
}
