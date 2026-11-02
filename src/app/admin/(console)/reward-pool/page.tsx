"use client";

// 旧版奖励池存档；新的领取池管理在认购管理页完成。

import { useStore } from "@/lib/store";
import { LoadingBlock, PageHeader, PageStack } from "@/components/dapp/ui";
import RewardPoolAdmin from "@/components/admin/reward-pool-admin";

export default function AdminRewardPoolPage() {
  const { hydrated } = useStore();

  if (!hydrated) return <LoadingBlock />;

  return (
    <PageStack>
      <PageHeader
        eyebrow="REWARD POOL"
        title="旧版奖励池存档"
        desc="仅用于已部署的旧版奖励池；新认购与领取在「认购管理」生成额度并写入 CaBiSimpleClaimPool"
      />
      <RewardPoolAdmin />
    </PageStack>
  );
}
