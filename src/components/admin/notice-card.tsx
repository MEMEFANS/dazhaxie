"use client";

// 后台数据接入状态。

import { Settings2 } from "lucide-react";
import { Notice } from "@/components/dapp/ui";

export default function NoticeCard() {
  return (
    <Notice tone="gold" icon={Settings2}>
      运营设置由服务端保存，修改记录可在「运营设置」查看。资金统计与认购、兑换服务仍按各自接入状态展示，链上参数需要管理员钱包签名。
    </Notice>
  );
}
