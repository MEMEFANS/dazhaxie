"use client";

// 客服工单：提交问题 · 后台回复 · 待处理 / 已处理标记

import { useState } from "react";
import { useStore } from "@/lib/store";
import { LoadingBlock, PageStack, SectionHead } from "@/components/dapp/ui";
import { TicketForm } from "@/components/dapp/support/ticket-form";
import { TicketList } from "@/components/dapp/support/ticket-list";
import type { FilterKey } from "@/components/dapp/support/category-picker";

export default function SupportPage() {
  const { hydrated } = useStore();
  // 筛选状态需跨组件联动（提交工单后重置为「全部」），故提升至页面
  const [filter, setFilter] = useState<FilterKey>("all");

  if (!hydrated) return <LoadingBlock />;

  return (
    <PageStack>
      <SectionHead
        eyebrow="SUPPORT"
        title="客服工单"
        desc="提交问题 · 后台回复并标记处理状态"
      />

      {/* 新建工单 */}
      <TicketForm onSubmitted={() => setFilter("all")} />

      {/* 工单列表 */}
      <TicketList filter={filter} onFilterChange={setFilter} />
    </PageStack>
  );
}
