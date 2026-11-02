"use client";
import { LockKeyhole } from "lucide-react";
import { useStore } from "@/lib/store";
import { useReferralData } from "@/lib/referral-data";
import { Notice } from "@/components/dapp/ui";
export function RelationNotice(){
  const {state}=useStore(),{data,status}=useReferralData(state.connected?state.address:undefined);
  const bound=status==="ready"&&data?.bound&&data.account.toLowerCase()===state.address.toLowerCase();
  return <Notice tone={bound?"green":"gray"} icon={LockKeyhole}>{bound?data.root?"项目初始邀请账户已启用。":`已绑定邀请码 ${data.referrerCode}，服务器保存，绑定免费且不可更换。`:"请先在邀请入口填写邀请码并免费绑定，无需 Gas。"}</Notice>;
}
