"use client";

// 兑换管理：收款地址 + 兑换开关 + 订单发货

import { useStore } from "@/lib/store";
import { LoadingBlock, PageHeader, PageStack } from "@/components/dapp/ui";
import ExchangeAdmin from "@/components/admin/exchange-admin";

export default function AdminExchangePage() {
  const { hydrated } = useStore();

  if (!hydrated) return <LoadingBlock />;

  return (
    <PageStack>
      <PageHeader eyebrow="EXCHANGE" title="兑换管理" desc="收款地址、兑换开关与订单发货" />
      <ExchangeAdmin />
    </PageStack>
  );
}
