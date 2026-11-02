"use client";

// 敏感词库：社群聊天敏感词维护

import { useStore } from "@/lib/store";
import { LoadingBlock, PageHeader, PageStack } from "@/components/dapp/ui";
import SensitiveWords from "@/components/admin/sensitive-words";

export default function AdminWordsPage() {
  const { hydrated } = useStore();

  if (!hydrated) return <LoadingBlock />;

  return (
    <PageStack>
      <PageHeader eyebrow="SENSITIVE WORDS" title="敏感词库" desc="社群聊天实时拦截词维护" />
      <SensitiveWords />
    </PageStack>
  );
}
