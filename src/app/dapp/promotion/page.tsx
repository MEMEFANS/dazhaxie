"use client";
import { useStore } from "@/lib/store";
import { LoadingBlock,PageStack } from "@/components/dapp/ui";
import { ReferralCard } from "@/components/dapp/promotion/referral-card";
import { StatsCard } from "@/components/dapp/promotion/stats-card";
import { DirectRewardCard } from "@/components/dapp/promotion/direct-reward-card";
import { TierTable } from "@/components/dapp/promotion/tier-table";
import { RewardRecords } from "@/components/dapp/promotion/reward-records";
export default function PromotionPage(){const {hydrated}=useStore();if(!hydrated)return <LoadingBlock/>;return <PageStack><ReferralCard/><StatsCard/><DirectRewardCard/><TierTable/><RewardRecords/></PageStack>;}

