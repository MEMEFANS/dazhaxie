"use client";
import Image from "next/image";
import { useRedemptionConfig } from "@/lib/redemption-client";
import { EXCHANGE_COST, MAX_EXCHANGE_PER_TIME, fmt } from "@/lib/constants";
import { DataRow, Panel } from "@/components/dapp/ui";

export default function MarketInfo() {
  const { data } = useRedemptionConfig();
  return (
    <Panel className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-4 p-4 sm:p-6 lg:block">
      <div className="relative row-span-2 aspect-square overflow-hidden rounded-2xl bg-[#f7effb] lg:mb-5 lg:aspect-[4/3]">
        <Image src="/images/xiebit-gift-v4.webp" alt="蟹礼礼盒示意插画" fill sizes="(max-width:1023px) 90vw,480px" className="object-cover" />
        <span className="absolute bottom-2 right-2 hidden rounded-full bg-white/85 px-2.5 py-1 text-[10px] text-mute lg:block">蟹礼示意图</span>
      </div>
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <p className="kicker">REDEEM MARKET</p>
          <h2 className="mt-1.5 text-lg font-semibold">大闸蟹礼盒</h2>
          <p className="mt-1 text-xs leading-6 text-mute">用 CaBi 兑换一份心意，鲜美蟹礼送到家。</p>
        </div>
      </div>
      <div className="col-span-2 mt-4 divide-y divide-line border-t border-line">
        <DataRow label="兑换单价" value={`${fmt(EXCHANGE_COST)} CaBi / 份`} />
        <DataRow label="单次可兑" value={`1–${data?.maxPerTransaction ?? MAX_EXCHANGE_PER_TIME} 份`} />
      </div>
    </Panel>
  );
}
