"use client";

// Retire legacy browser archives without changing authoritative server data.

import { RefreshCw } from "lucide-react";
import { useStore } from "@/lib/store";
import { Card, SectionTitle } from "@/components/dapp/ui";

export default function ResetCard() {
  const { resetDemo } = useStore();

  return (
    <Card>
      <SectionTitle title="清理旧版浏览器记录" />
      <div className="-mt-2 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-6 text-mute">仅移除旧版本的浏览器存档，保留钱包连接、服务器设置和操作日志。</p>
        <button
          onClick={resetDemo}
          className="btn h-10 shrink-0 border border-down/40 px-5 text-[11px] font-medium text-down transition hover:bg-down/10"
        >
          <RefreshCw size={13} /> 清理旧记录
        </button>
      </div>
    </Card>
  );
}
