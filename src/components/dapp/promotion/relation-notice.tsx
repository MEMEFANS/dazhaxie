"use client";
import { LockKeyhole } from "lucide-react";
import { useStore } from "@/lib/store";
import { useReferralData } from "@/lib/referral-data";
export function RelationNotice(){
  const {state}=useStore(),{data,status,binding}=useReferralData(state.connected?state.address:undefined);
  return <p className="mt-4 flex items-start gap-2 border-t border-line pt-3 text-[11px] leading-5 text-faint"><LockKeyhole size={12} className="mt-0.5 shrink-0"/><span>邀请码免费绑定后不能更换。当前上级邀请码：{status==="ready"&&data?.bound?(data.root?"项目初始邀请账户":data.referrerCode):binding?.bound?"已绑定，签名登录后查看":"待绑定"}</span></p>;
}
