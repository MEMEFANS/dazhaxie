"use client";

// 认购管理：全局进度 + 锁定/解锁认购

import { useStore } from "@/lib/store";
import { LoadingBlock, PageHeader, PageStack } from "@/components/dapp/ui";
import SubscribeAdmin from "@/components/admin/subscribe-admin";

export default function AdminSubscribePage() {
  const { hydrated } = useStore();

  if (!hydrated) return <LoadingBlock />;

  return (
    <PageStack>
      <PageHeader eyebrow="SUBSCRIBE" title="认购管理" desc="收款地址 · 认购单核验记账 · 可领额度生成与链上写入登记" />
      <SubscribeAdmin />
    </PageStack>
  );
}
