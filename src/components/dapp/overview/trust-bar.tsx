"use client";

// 信任与提示：合约 / 链 / 风险，一行安静信息条

import { useStore } from "@/lib/store";
import { ContractRow } from "@/components/dapp/ui";

export function TrustBar() {
  const { state } = useStore();
  const chain = state.chainId > 0 ? `Chain ${state.chainId}` : "网络未连接";

  return (
    <div className="rounded-xl border border-line bg-well/60 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <ContractRow chain={chain} />
        <p className="text-[11px] leading-5 text-faint">
          风险提示：数字资产价格波动较大，请理性参与；页面内容不构成投资建议。
        </p>
      </div>
    </div>
  );
}
