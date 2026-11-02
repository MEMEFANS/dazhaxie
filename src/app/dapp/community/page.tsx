"use client";

// 社群入口与消息区域。

import { PageStack, SectionHead } from "@/components/dapp/ui";
import { CommunityView } from "@/components/dapp/community/community-view";

export default function CommunityPage() {
  return (
    <PageStack>
      <SectionHead
        eyebrow="COMMUNITY"
        title="官方社群"
        desc="蟹友交流与生态动态"
      />
      <CommunityView />
      <p className="text-center text-[11px] leading-5 text-faint">
        成员、管理员与消息均由服务器保存，被移出的地址重新连接钱包不会自动恢复
      </p>
    </PageStack>
  );
}
