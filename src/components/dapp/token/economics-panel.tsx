"use client";

import { RefreshCw, ShieldAlert } from "lucide-react";
import { formatUnits } from "viem";
import { useStore } from "@/lib/store";
import { useTokenData } from "@/lib/chain-data";
import { chainConfig, contracts, getExplorerAddressUrl, tradingMode, tokenLaunchMode } from "@/lib/chain-config";
import { PancakeSwapLink } from "@/components/dapp/pancake-swap-link";
import { BUY_FEE_BPS, MAX_WALLET_BALANCE, SELL_FEE_BPS, TOTAL_SUPPLY, fmt } from "@/lib/constants";
import { Badge, Card, ContractRow, DataRow, Metric, SectionHead } from "@/components/dapp/ui";

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
  const holdingBasisPoints = balance !== undefined && token && token.maxWalletAmount > 0n ? balance * 10000n / token.maxWalletAmount : undefined;
  const holdingPct = holdingBasisPoints === undefined ? undefined : Number(holdingBasisPoints > 10000n ? 10000n : holdingBasisPoints) / 100;
  const loading = query.status === "loading";
  const failed = query.status === "error" || Boolean(query.error);
  const statusText = failed ? "暂时无法更新" : { unconfigured: "资产信息待开放", loading: "正在更新", ready: "已更新", error: "暂时无法更新" }[query.status];

  return <Card className="p-5 sm:p-6">
    <SectionHead eyebrow="MY ASSETS" title="CaBi 资产" desc="查看余额、交易规则与持仓额度" right={<Badge tone={token ? "green" : failed ? "red" : "gray"}>{statusText}</Badge>} />
    <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5">
      <Metric label="发行总量" value={token ? assetAmount(token.totalSupply, token.decimals + 8) : fmt(TOTAL_SUPPLY / 100000000)} unit="亿枚" hint={token ? token.name : "项目发行规则"} />
      <Metric label="我的 CaBi 余额" value={balance !== undefined && token ? assetAmount(balance, token.decimals) : "—"} unit="枚" hint={!state.connected ? "连接钱包查看" : token ? "当前钱包余额" : "余额暂未更新"} />
    </div>

    <div className="mt-6 border-t border-line pt-5">
      <p className="kicker">交易规则</p>
      <div className="mt-3 rounded-lg border border-line bg-well px-4 py-1">
        <DataRow label="买入手续费" value={`${BUY_FEE_BPS / 100}%`} />
        <DataRow label="卖出手续费" value={`${SELL_FEE_BPS / 100}%`} />
        <DataRow label="钱包转账手续费" value="0%" />
      </div>
      <p className="mt-3 text-[12px] leading-6 text-mute">{tradingMode === "pancake" ? "买入和卖出手续费以 CaBi 收取，普通钱包之间转账不收手续费。请以交易页面显示的实际到账数量为准。" : "买入手续费以 USDT 收取，卖出手续费以 CaBi 收取，普通钱包之间转账不收手续费。请以交易页面显示的实际到账数量为准。"}</p>
      {tokenLaunchMode ? <p className="mt-2 text-[12px] leading-6 text-mute">领取和交易分阶段开放，公开交易开放前普通转账暂停。</p> : null}
      <PancakeSwapLink className="mt-4" />
    </div>

    <div className="mt-6 border-t border-line pt-5">
      <p className="kicker flex items-center gap-1.5"><ShieldAlert size={13} className="text-gold" />持仓额度</p>
      <div className="mt-3 rounded-lg border border-line bg-well px-4 py-1">
        <DataRow label={token ? "当前持仓上限" : "默认持仓上限"} value={token ? `${assetAmount(token.maxWalletAmount, token.decimals)} 枚` : `${fmt(MAX_WALLET_BALANCE)} 枚`} />
        <DataRow label="我的持仓限制" value={!state.connected ? "连接钱包查看" : token?.isExempt === true ? "不受持仓上限限制" : token?.isExempt === false ? "适用当前持仓上限" : "—"} mono={false} />
      </div>
      {holdingPct !== undefined && !token?.isExempt ? <div className="mt-3"><div className="flex items-center justify-between text-[12px] text-mute"><span>当前持仓占用</span><span>{holdingPct.toFixed(2)}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-line/60" role="progressbar" aria-label="当前持仓占用" aria-valuemin={0} aria-valuemax={100} aria-valuenow={holdingPct}><div className={`h-full rounded-full ${holdingPct >= 100 ? "bg-down" : "bg-gold-2"}`} style={{ width: `${holdingPct}%` }} /></div></div> : null}
      <p className="mt-3 text-[12px] leading-6 text-mute">接收认购、奖励或转账后，钱包余额需符合当前持仓上限。</p>
    </div>

    <div className="mt-6 rounded-xl border border-line bg-well px-4 py-3">
      <p className="mb-2 text-[12px] text-mute">代币合约验证</p>
      <ContractRow address={contracts.token} chain={chainConfig.name} href={contracts.token ? getExplorerAddressUrl(contracts.token) : undefined} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] leading-6 text-mute" aria-live="polite">
        <p>{failed ? "资产信息暂时无法更新，请稍后重试。" : loading ? "正在更新资产信息…" : query.status === "unconfigured" ? "资产信息将于开放后显示。" : query.updatedAt ? `最近更新 ${new Date(query.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "资产信息已更新"}</p>
        {contracts.token ? <button type="button" onClick={query.refresh} disabled={loading} className="btn btn-outline min-h-11 gap-2 px-4 text-[12px]"><RefreshCw size={14} className={loading ? "animate-spin" : undefined} />{loading ? "更新中" : "刷新数据"}</button> : null}
      </div>
    </div>
  </Card>;
}
