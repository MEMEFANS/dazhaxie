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

      <EconomicsPanel />

      <ClaimCard />

      <p className="flex items-center justify-center gap-1.5 text-center text-xs leading-6 text-faint">
        <Sparkles size={12} /> 余额、认购与奖励以当前网络的合约状态为准；实物订单在蟹礼页查询
      </p>
    </PageStack>
  );
}
