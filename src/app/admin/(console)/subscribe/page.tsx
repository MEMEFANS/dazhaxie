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
      <PageHeader eyebrow="SUBSCRIBE" title="认购管理" desc="认购订单 · 蟹礼发货 · 组 LP 额度" />
      <SubscribeAdmin />
    </PageStack>
  );
}
