"use client";

// 代币中心：我的代币（领取/LP） + 代币经济与池子（分配 / 销毁 / 风控）

import { Sparkles } from "lucide-react";
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
        desc={`总量 ${fmt(TOTAL_SUPPLY / 100000000)} 亿枚 · 永不增发`}
      />

      <ClaimCard />

      <EconomicsPanel />

      <p className="flex items-center justify-center gap-1.5 text-center text-xs leading-6 text-faint">
        <Sparkles size={12} /> 认购蟹礼请在认购记录中补填收货信息；兑换订单在蟹礼页查看。
      </p>
    </PageStack>
  );
}
