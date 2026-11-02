"use client";

import { PageHeader, PageStack } from "@/components/dapp/ui";
import { UsersAdmin } from "@/components/admin/users-admin";

export default function AdminUsersPage() {
  return (
    <PageStack>
      <PageHeader eyebrow="USERS" title="用户明细" desc="按地址查看认购、奖励与领取记录，支持 CSV 导出" />
      <UsersAdmin />
    </PageStack>
  );
}
