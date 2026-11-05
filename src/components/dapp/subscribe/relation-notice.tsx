"use client";

import { CircleCheck, KeyRound } from "lucide-react";
import { useStore } from "@/lib/store";
import { useReferralData } from "@/lib/referral-data";
import styles from "./subscribe.module.css";

export function RelationNotice() {
  const { state } = useStore();
  const { data, binding } = useReferralData(state.connected ? state.address : undefined);
  const bound = state.connected && (data?.bound && data.account.toLowerCase() === state.address.toLowerCase() || binding?.bound && binding.account.toLowerCase() === state.address.toLowerCase());

  return (
    <div className={styles.relation} data-bound={Boolean(bound)}>
      {bound ? <CircleCheck size={17} /> : <KeyRound size={17} />}
      <p>{bound ? <>推荐关系已绑定{data && !data.root && data.referrerCode ? <> · <strong>{data.referrerCode}</strong></> : null}</> : state.connected ? "绑定邀请码后，即可参与认购" : "连接钱包后，查看推荐关系与可购份额"}</p>
      {bound ? <span>不可更改</span> : null}
    </div>
  );
}
