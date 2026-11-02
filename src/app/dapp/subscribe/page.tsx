"use client";
import { useStore } from "@/lib/store";
import { LoadingBlock,PageStack } from "@/components/dapp/ui";
import { CapHeader } from "@/components/dapp/subscribe/cap-header";
import { RelationNotice } from "@/components/dapp/subscribe/relation-notice";
import { PurchasePanel } from "@/components/dapp/subscribe/purchase-panel";
import { ProgressCard } from "@/components/dapp/subscribe/progress-card";
export default function SubscribePage(){const {hydrated}=useStore();if(!hydrated)return <LoadingBlock/>;return <PageStack><CapHeader/><RelationNotice/><PurchasePanel/><ProgressCard/></PageStack>;}

