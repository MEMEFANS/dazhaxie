"use client";
import SimpleClaimCard from "./simple-claim-card";
import { contracts } from "@/lib/chain-config";
import { Badge, Card, SectionHead } from "@/components/dapp/ui";
export default function ClaimCard() {
  if (!contracts.claimPool) return <Card className="p-5 sm:p-6">
    <SectionHead eyebrow="CABI CLAIM" title="CaBi 领取" desc="认购与奖励额度自动汇总" right={<Badge tone="gray">暂未开放</Badge>} />
    <p className="mt-4 text-sm leading-7 text-mute">领取暂未开放，开放时间确定后将在这里公布。</p>
  </Card>;
  return <SimpleClaimCard />;
}
