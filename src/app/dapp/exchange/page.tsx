"use client";

// 兑换大闸蟹：3500 CaBi / 份 · 转入后台指定收款地址 · 填写收货信息 · 后台发货

import { useStore } from "@/lib/store";
import { EXCHANGE_COST, fmt } from "@/lib/constants";
import { LoadingBlock, PageHeader, PageStack } from "@/components/dapp/ui";
import { ExchangeClosedAlert } from "@/components/dapp/exchange/status-alert";
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
        title="兑换大闸蟹"
        desc={`${fmt(EXCHANGE_COST)} CaBi = 1 份蟹礼 · 代币转入后台指定收款地址`}
      />

      <ExchangeClosedAlert />

      {/* 主操作区：移动端表单置顶，桌面端左信息右表单 */}
      <div className="grid gap-6 lg:grid-cols-[.92fr_1.08fr]">
        <div className="order-2 lg:order-1">
          <MarketInfo />
        </div>
        <div className="order-1 lg:order-2">
          <ExchangeForm />
        </div>
      </div>

      <ExchangeRecords />
    </PageStack>
  );
}
