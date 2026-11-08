"use client";
import { useStore } from "@/lib/store";
import { LoadingBlock, PageStack } from "@/components/dapp/ui";
import { ReferralCard } from "@/components/dapp/promotion/referral-card";
export default function PromotionPage(){const {hydrated}=useStore();if(!hydrated)return <LoadingBlock/>;return <PageStack><ReferralCard/></PageStack>;}
