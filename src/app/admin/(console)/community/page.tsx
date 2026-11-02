"use client";

// 社群管理（后台）：成员 / 管理员 / 移出恢复 / 操作日志，读服务端 SQLite

import { PageHeader, PageStack } from "@/components/dapp/ui";
import { CommunityAdmin } from "@/components/admin/community-admin";
import { ReferralRoots } from "@/components/admin/referral-roots";

export default function AdminCommunityPage() {
  return (
    <PageStack>
      <PageHeader eyebrow="COMMUNITY" title="社群管理" desc="管理员设置 · 成员移出与恢复 · 操作留痕" />
      <ReferralRoots />
      <CommunityAdmin />
    </PageStack>
  );
}
