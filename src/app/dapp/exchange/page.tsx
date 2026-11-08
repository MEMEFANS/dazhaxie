"use client";

// 兑换大闸蟹：3500 CaBi / 份 · 转入后台指定收款地址 · 填写收货信息 · 后台发货

import { useStore } from "@/lib/store";
import { Gift } from "lucide-react";
import { EXCHANGE_COST, fmt } from "@/lib/constants";
import { LoadingBlock, PageHeader, PageStack } from "@/components/dapp/ui";
import MarketInfo from "@/components/dapp/exchange/market-info";
import ExchangeForm from "@/components/dapp/exchange/exchange-form";
import ExchangeRecords from "@/components/dapp/exchange/exchange-records";

export default function ExchangePage() {
  const { hydrated } = useStore();

  if (!hydrated) return <LoadingBlock />;

  return (
    <PageStack>
      <PageHeader
        eyebrow="CRAB EXCHANGE"
        title="蟹礼兑换"
        icon={Gift}
        desc={`${fmt(EXCHANGE_COST)} CaBi / 份 · 付款后填写收货信息`}
      />

      <div className="grid items-start gap-4 sm:gap-6 lg:grid-cols-[.92fr_1.08fr]">
        <div>
          <MarketInfo />
        </div>
        <div>
          <ExchangeForm />
        </div>
      </div>

      <ExchangeRecords />
    </PageStack>
  );
}
