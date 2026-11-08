"use client";

// 代币页：钱包资产、组 LP 与领取。

import Link from "next/link";
import { useStore } from "@/lib/store";
import { LoadingBlock, PageStack } from "@/components/dapp/ui";
import ClaimCard from "@/components/dapp/token/claim-card";
import EconomicsPanel from "@/components/dapp/token/economics-panel";

export default function TokenPageClient() {
  const { hydrated } = useStore();

  if (!hydrated) return <LoadingBlock />;

  return (
    <PageStack>
      <EconomicsPanel />

      <ClaimCard />

      <nav aria-label="订单与服务" className="flex flex-wrap justify-center gap-x-6 gap-y-1 text-xs text-mute">
        <Link className="inline-flex min-h-11 items-center hover:text-purple-deep" href="/dapp/subscribe#subscription-records">认购订单与收货</Link>
        <Link className="inline-flex min-h-11 items-center hover:text-purple-deep" href="/dapp/exchange">蟹礼兑换</Link>
        <Link className="inline-flex min-h-11 items-center hover:text-purple-deep" href="/dapp/support">客服与售后</Link>
      </nav>
    </PageStack>
  );
}
