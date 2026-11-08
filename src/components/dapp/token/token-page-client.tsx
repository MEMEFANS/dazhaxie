"use client";

// 代币中心：我的代币（领取/LP） + 代币经济与池子（分配 / 销毁 / 风控）

import { Coins } from "lucide-react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { TOTAL_SUPPLY, fmt } from "@/lib/constants";
import { LoadingBlock, PageHeader, PageStack } from "@/components/dapp/ui";
import ClaimCard from "@/components/dapp/token/claim-card";
import EconomicsPanel from "@/components/dapp/token/economics-panel";

export default function TokenPageClient() {
  const { hydrated } = useStore();

  if (!hydrated) return <LoadingBlock />;

  return (
    <PageStack>
      <PageHeader
        eyebrow="TOKEN CENTER"
        title="代币中心"
        icon={Coins}
        desc={`总量 ${fmt(TOTAL_SUPPLY / 100000000)} 亿枚 · 永不增发`}
      />

      <ClaimCard />

      <EconomicsPanel />

      <nav aria-label="订单与服务" className="flex flex-wrap justify-center gap-x-6 gap-y-1 text-xs text-mute">
        <Link className="inline-flex min-h-11 items-center hover:text-purple-deep" href="/dapp/subscribe#subscription-records">认购订单与收货</Link>
        <Link className="inline-flex min-h-11 items-center hover:text-purple-deep" href="/dapp/exchange">蟹礼兑换</Link>
        <Link className="inline-flex min-h-11 items-center hover:text-purple-deep" href="/dapp/support">客服与售后</Link>
      </nav>
    </PageStack>
  );
}
