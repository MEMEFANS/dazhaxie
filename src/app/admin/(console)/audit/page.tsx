"use client";

import { PageHeader, PageStack } from "@/components/dapp/ui";
import { AuditAdmin } from "@/components/admin/audit-admin";

export default function AdminAuditPage() {
  return (
    <PageStack>
      <PageHeader eyebrow="AUDIT" title="审计与会话" desc="操作留痕、分页筛选与后台会话强制下线" />
      <AuditAdmin />
    </PageStack>
  );
}
