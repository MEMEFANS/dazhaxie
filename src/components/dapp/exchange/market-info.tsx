"use client";
import Image from "next/image";
import { Lock } from "lucide-react";
import { useStore } from "@/lib/store";
import { useRedemptionConfig } from "@/lib/redemption-client";
import { useTokenData } from "@/lib/chain-data";
import { getExplorerAddressUrl } from "@/lib/chain-config";
import { EXCHANGE_COST, MAX_EXCHANGE_PER_TIME, fmt, shortAddr } from "@/lib/constants";
import { formatAssetAmount } from "@/lib/amounts";
import { DataRow, Notice, Panel, StatusPill } from "@/components/dapp/ui";

export default function MarketInfo() {
  const { state } = useStore();
  const { data } = useRedemptionConfig();
  const token = useTokenData(state.connected ? state.address : undefined);
  const balance = token.data?.balance;
  const payee = data?.payee;
  return (
    <Panel className="h-full p-5 sm:p-6">
      <div className="relative mb-5 h-44 overflow-hidden rounded-xl bg-[#f7effb]">
        <Image src="/images/xiebit-gift-v4.webp" alt="蟹礼礼盒示意插画" fill sizes="(max-width:1023px) 90vw,480px" className="object-cover" />
        <span className="absolute bottom-2 right-2 rounded-full bg-white/85 px-2.5 py-1 text-[9px] text-mute">实物规格与发货范围以运营说明为准</span>
      </div>
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <p className="kicker">REDEEM MARKET</p>
          <h2 className="mt-1.5 text-lg font-semibold">大闸蟹礼盒</h2>
          <p className="mt-1 text-xs leading-6 text-mute">以 CaBi 兑换实物：代币直接转入后台指定的收款地址。</p>
        </div>
        <StatusPill tone={data?.enabled ? "live" : "paused"}>{data?.enabled ? "兑换开放" : "尚未开放"}</StatusPill>
      </div>
      <div className="mt-4 divide-y divide-line border-t border-line">
        <DataRow label="兑换单价" value={`${fmt(EXCHANGE_COST)} CaBi / 份`} />
        <DataRow label="单次上限" value={`${MAX_EXCHANGE_PER_TIME} 份`} />
        <DataRow label="收款地址" value={payee ? <a href={getExplorerAddressUrl(payee)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-purple-deep underline" title={payee}>{shortAddr(payee)}</a> : "待后台配置"} />
        <DataRow label="当前余额" value={balance !== undefined ? `${formatAssetAmount(balance, 18)} CaBi` : "—"} />
        <DataRow label="按余额可兑换" value={balance !== undefined ? `${Number(balance / (BigInt(EXCHANGE_COST) * 10n ** 18n))} 份` : "—"} />
      </div>
      <Notice tone="gold" icon={Lock} className="mt-4 !px-3 !py-2.5">
        <p className="text-[11px] leading-5">代币将转入上方指定收款地址，<b className="text-strong">转入后不可撤回</b>；收货信息加密保存在服务端，不上链。</p>
      </Notice>
    </Panel>
  );
}
