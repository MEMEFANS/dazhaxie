"use client";

// 工单处理：服务端工单回复、状态流转与完结

import { PageHeader, PageStack } from "@/components/dapp/ui";
import { TicketsAdmin } from "@/components/admin/tickets-admin";

export default function AdminTicketsPage() {
  return (
    <PageStack>
      <PageHeader eyebrow="TICKETS" title="工单处理" desc="用户反馈回复与进度管理" />
      <TicketsAdmin />
    </PageStack>
  );
}
