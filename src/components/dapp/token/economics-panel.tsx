"use client";

import { formatUnits } from "viem";
import { useStore } from "@/lib/store";
import { useTokenData } from "@/lib/chain-data";
import { TOTAL_SUPPLY, fmt } from "@/lib/constants";
import { Badge, Card, Metric, SectionHead } from "@/components/dapp/ui";

function assetAmount(amount: bigint, decimals: number, precision = 4): string {
  const [integer, fraction = ""] = formatUnits(amount, decimals).split(".");
  const digits = fraction.slice(0, precision).replace(/0+$/, "");
  if (precision > 0 && amount > 0n && integer === "0" && !digits) return `<0.${"0".repeat(precision - 1)}1`;
  return `${BigInt(integer).toLocaleString("en-US")}${digits ? `.${digits}` : ""}`;
}

export default function EconomicsPanel() {
  const { state } = useStore();
  const query = useTokenData(state.connected ? state.address : undefined);
  const token = query.status === "ready" && !query.error ? query.data : undefined;
  const balance = token?.balance;
  const failed = query.status === "error" || Boolean(query.error);
  const statusText = failed ? "暂时无法更新" : { unconfigured: "资产信息待开放", loading: "正在更新", ready: "已更新", error: "暂时无法更新" }[query.status];

  return <Card className="p-5 sm:p-6">
    <SectionHead eyebrow="MY ASSETS" title="CaBi 资产" desc="查看发行总量与钱包余额" right={<Badge tone={token ? "green" : failed ? "red" : "gray"}>{statusText}</Badge>} />
    <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5">
      <Metric label="发行总量" value={token ? assetAmount(token.totalSupply, token.decimals + 8) : fmt(TOTAL_SUPPLY / 100000000)} unit="亿枚" hint={token ? token.name : "项目发行规则"} />
      <Metric label="我的 CaBi 余额" value={balance !== undefined && token ? assetAmount(balance, token.decimals) : "—"} unit="枚" hint={!state.connected ? "连接钱包查看" : token ? "当前钱包余额" : "余额暂未更新"} />
    </div>
  </Card>;
}
