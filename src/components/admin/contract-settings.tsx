"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, LoaderCircle, RefreshCw, Settings2, Wallet } from "lucide-react";
import { createPublicClient, createWalletClient, custom, encodeFunctionData, fallback, formatUnits, getAddress, http, isAddress, parseUnits, zeroAddress, type Abi, type Address, type Hash, type Hex } from "viem";
import { useStore } from "@/lib/store";
import { appChain, chainConfig, configIssues, contracts, getExplorerAddressUrl, getExplorerTxUrl, tradingMode } from "@/lib/chain-config";
import PancakeTaxSettings from "./pancake-tax-settings";
import { gatewayAbi, tokenAbi, useGatewayData, useTokenData, type GatewayData, type TokenData } from "@/lib/chain-data";
import { formatAssetAmount } from "@/lib/amounts";
import * as wallet from "@/lib/wallet";
import { recordChainAudit } from "@/lib/chain-audit";
import { Badge, Card, ContractRow, DataRow, PageHeader, PageStack } from "@/components/dapp/ui";

const publicClient = createPublicClient({ chain: appChain, transport: fallback(chainConfig.rpcUrls.map(url => http(url, { timeout: 12_000, retryCount: 0 }))) });
type Transaction = { status: "wallet" | "pending" | "success" | "failed"; description: string; hash?: Hash; target?: Address; data?: Hex; message?: string };
type PendingRecord = { hash: Hash; target: Address; data: Hex; description: string; account: Address; chainId: number; token?: Address; gateway?: Address };
const inputClass = "field min-h-11 w-full min-w-0 px-3 text-sm";

export default function ContractSettings() {
  return tradingMode === "pancake" ? <PancakeTaxSettings /> : <LegacyContractSettings />;
}

function LegacyContractSettings() {
  const { state, connect, connecting } = useStore();
  const token = useTokenData();
  const gateway = useGatewayData();
  const refresh = () => { token.refresh(); gateway.refresh(); };
  return (
    <PageStack>
      <PageHeader eyebrow="CONTRACT SETTINGS" title="链上合约配置" desc="查看实际合约状态，由对应管理员钱包签名设置" />
      <Card className="p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-base font-semibold"><Settings2 size={18} /> {chainConfig.shortName}</h2><Badge tone={contracts.token ? "gold" : "gray"}>{contracts.token ? "已配置代币地址" : "等待部署配置"}</Badge></div>
        <ContractRow address={contracts.token} chain={chainConfig.shortName} href={contracts.token ? getExplorerAddressUrl(contracts.token) : undefined} />
        <p className="mt-3 text-xs leading-6 text-mute">后台登录管理运营设置；链上配置由代币 owner 或网关 owner 的钱包授权。代币转账不会转移管理权限。</p>
        {!contracts.token ? <p className="mt-3 rounded-lg bg-well p-3 text-sm leading-6 text-mute">正式合约部署后，在服务器填写网络和合约地址并重新构建应用。配置完成前，所有链上设置按钮保持关闭。</p> : null}
        {configIssues.length ? <p className="mt-3 text-sm text-down">{configIssues.join(" ")}</p> : null}
        {token.status === "error" || gateway.status === "error" ? <div role="alert" className="mt-3 text-sm text-down">{token.error || gateway.error}<button onClick={refresh} className="ml-2 inline-flex min-h-11 items-center gap-1 text-mute"><RefreshCw size={13} />重新查询</button></div> : null}
        {token.status === "loading" || gateway.status === "loading" ? <p role="status" className="mt-3 flex items-center gap-2 text-sm text-mute"><LoaderCircle size={15} className="animate-spin" /> 正在读取链上配置</p> : null}
        {!state.connected ? <button disabled={connecting} onClick={connect} className="btn btn-outline mt-4 min-h-11 px-4 text-sm"><Wallet size={15} />{connecting ? "连接中…" : "连接管理员钱包"}</button> : state.chainId !== chainConfig.id ? <p role="status" className="mt-3 text-sm text-warn">请通过页面顶部切换到 {chainConfig.shortName}。</p> : null}
      </Card>
      <ContractForms key={`${state.address.toLowerCase()}:${state.chainId}`} token={token.data} gateway={gateway.data} refresh={refresh} />
    </PageStack>
  );
}

function ContractForms({ token, gateway, refresh }: { token?: TokenData; gateway?: GatewayData; refresh: () => void }) {
  const { state } = useStore();
  const [rate1, setRate1] = useState(gateway ? formatUnits(gateway.rate1Bps, 2) : "2");
  const [rate2, setRate2] = useState(gateway ? formatUnits(gateway.rate2Bps, 2) : "1");
  const [receiver1, setReceiver1] = useState(gateway?.receiver1 || "");
  const [receiver2, setReceiver2] = useState(gateway?.receiver2 || "");
  const [limit, setLimit] = useState(token ? formatUnits(token.maxWalletAmount, token.decimals) : "");
  const currentSettings = `${gateway?.receiver1}:${gateway?.receiver2}:${gateway?.rate1Bps}:${gateway?.rate2Bps}:${token?.maxWalletAmount}`;
  const [previousSettings, setPreviousSettings] = useState(currentSettings);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [formError, setFormError] = useState("");
  const correctNetwork = state.connected && state.chainId === chainConfig.id;
  const isOwner = (owner?: string) => Boolean(correctNetwork && owner && owner.toLowerCase() === state.address.toLowerCase());
  const busy = transaction?.status === "wallet" || transaction?.status === "pending";
  const storageKey = `cabi-pending-admin:${chainConfig.id}:${contracts.token || ""}:${contracts.gateway || ""}:${state.address.toLowerCase()}`;

  if (previousSettings !== currentSettings) {
    setPreviousSettings(currentSettings);
    if (gateway) {
      setRate1(formatUnits(gateway.rate1Bps, 2));
      setRate2(formatUnits(gateway.rate2Bps, 2));
      setReceiver1(gateway.receiver1);
      setReceiver2(gateway.receiver2);
    }
    if (token) setLimit(formatUnits(token.maxWalletAmount, token.decimals));
  }

  useEffect(() => {
    if (!state.address) return;
    const timer = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const record = JSON.parse(raw) as PendingRecord;
        if (!/^0x[0-9a-fA-F]{64}$/.test(record.hash) || !isAddress(record.target) || !/^0x[0-9a-fA-F]+$/.test(record.data) || record.account.toLowerCase() !== state.address.toLowerCase()
          || record.chainId !== chainConfig.id || record.token !== contracts.token || record.gateway !== contracts.gateway) return;
        setTransaction({ status: "pending", hash: record.hash, target: record.target, data: record.data, description: record.description, message: "发现待确认交易，点击查询链上结果。" });
      } catch { /* Unavailable browser storage never supplies a transaction result. */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [state.address, storageKey]);

  async function confirmTransaction(hash: Hash, description: string, target: Address, data: Hex, after?: unknown) {
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 60_000, pollingInterval: 2_000 });
      const actual = await publicClient.getTransaction({ hash: receipt.transactionHash });
      if (actual.from.toLowerCase() !== state.address.toLowerCase() || actual.to?.toLowerCase() !== target.toLowerCase() || actual.input !== data) {
        setTransaction({ status: "failed", hash: receipt.transactionHash, description, message: "链上交易内容与本次设置不同，请核对交易记录。" });
        recordChainAudit({ action: description, status: "failed", txHash: receipt.transactionHash, wallet: state.address, after, error: "交易内容与本次设置不同" });
        try { localStorage.removeItem(storageKey); } catch { /* No local transaction result is authoritative. */ }
        return;
      }
      setTransaction({ status: receipt.status === "success" ? "success" : "failed", hash: receipt.transactionHash, description,
        message: receipt.status === "success" ? "交易已确认，正在重新读取合约配置。" : "交易未生效，请查看区块浏览器中的原因。" });
      recordChainAudit({ action: description, status: receipt.status === "success" ? "success" : "failed", txHash: receipt.transactionHash, wallet: state.address, after });
      try { localStorage.removeItem(storageKey); } catch { /* Receipt remains authoritative. */ }
      refresh();
    } catch {
      setTransaction({ status: "pending", hash, target, data, description, message: "暂未查询到确认结果，请稍后继续查询。请勿重复提交同一设置。" });
    }
  }

  async function submit(target: Address | undefined, abi: Abi, functionName: string, args: readonly unknown[], owner: Address | undefined, description: string) {
    setFormError("");
    if (busy || !target || !owner || !isOwner(owner)) return;
    const connection = wallet.getConnection();
    if (!connection) return;
    try {
      setTransaction({ status: "wallet", description, message: "请核对设置内容，并在钱包中确认。" });
      if (await wallet.getChainId() !== chainConfig.id || await publicClient.getChainId() !== chainConfig.id) throw new Error("请先切换到应用配置的网络");
      const accounts = await connection.provider.request({ method: "eth_accounts" }) as string[];
      if (!accounts[0] || accounts[0].toLowerCase() !== state.address.toLowerCase()) throw new Error("钱包账户已切换，请重新核对管理员地址");
      const account = getAddress(accounts[0]);
      const actualOwner = await publicClient.readContract({ address: target, abi: tokenAbi, functionName: "owner" });
      if (actualOwner.toLowerCase() !== account.toLowerCase()) throw new Error("当前钱包不具备此合约的管理权限");
      const simulation = await publicClient.simulateContract({ address: target, abi, functionName, args, account });
      const data = encodeFunctionData({ abi, functionName, args });
      const signer = createWalletClient({ chain: appChain, transport: custom(connection.provider) });
      const hash = await signer.writeContract(simulation.request);
      const record: PendingRecord = { hash, target, data, description, account, chainId: chainConfig.id, token: contracts.token, gateway: contracts.gateway };
      try { localStorage.setItem(storageKey, JSON.stringify(record)); } catch { /* The visible hash still permits manual verification. */ }
      setTransaction({ status: "pending", hash, target, data, description, message: "交易已广播，等待链上确认。" });
      recordChainAudit({ action: description, status: "pending", txHash: hash, wallet: account, after: { functionName, args } });
      await confirmTransaction(hash, description, target, data, { functionName, args });
    } catch (error) {
      const message = error instanceof Error && /账户已切换|管理权限|切换到应用/.test(error.message) ? error.message
        : "操作未提交或未完成。请检查钱包确认、余额和输入参数后重试。";
      setTransaction({ status: "failed", description, message });
      recordChainAudit({ action: description, status: "failed", wallet: state.address, after: { functionName, args }, error: message });
    }
  }

  function updateRates(event: React.FormEvent) {
    event.preventDefault();
    try {
      if (!/^\d+(\.\d{1,2})?$/.test(rate1) || !/^\d+(\.\d{1,2})?$/.test(rate2)) throw new Error();
      const first = parseUnits(rate1, 2), second = parseUnits(rate2, 2);
      if (first < 0n || second < 0n || first + second !== 300n) throw new Error();
      void submit(contracts.gateway, gatewayAbi, "setDividendRates", [first, second], gateway?.owner, `分账比例调整为 ${rate1}% / ${rate2}%`);
    } catch { setFormError("请填写两位以内小数的百分比，两项合计必须为 3%。"); }
  }

  function updateReceivers(event: React.FormEvent) {
    event.preventDefault();
    const first = receiver1.trim(), second = receiver2.trim();
    if (!isAddress(first, { strict: false }) || !isAddress(second, { strict: false }) || first.toLowerCase() === second.toLowerCase()
      || [first.toLowerCase(), second.toLowerCase()].includes(zeroAddress)) { setFormError("请填写两个不同的有效非零收款地址。"); return; }
    void submit(contracts.gateway, gatewayAbi, "setDividendReceivers", [getAddress(first.toLowerCase()), getAddress(second.toLowerCase())], gateway?.owner, `更新分红收款地址：${first} / ${second}`);
  }

  function updateLimit(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    try {
      if (!/^\d+(\.\d+)?$/.test(limit) || (limit.split(".")[1]?.length || 0) > token.decimals) throw new Error();
      const amount = parseUnits(limit, token.decimals);
      if (amount <= 0n || amount > token.totalSupply) throw new Error();
      void submit(contracts.token, tokenAbi, "setMaxWalletAmount", [amount], token.owner, `持仓上限调整为 ${limit} CaBi`);
    } catch { setFormError("请填写大于 0 且不超过代币总量的有效数量。"); }
  }

  return (
    <>
      <Card className="p-5 sm:p-6">
        <h2 className="text-base font-semibold">确认链上操作</h2>
        <p className="mt-2 text-xs leading-6 text-down">以下操作会直接修改链上参数，提交后不可撤销，仅在链上交易确认后生效。请仔细核对钱包显示的合约与参数。</p>
      </Card>
      <Card className="p-5 sm:p-6">
        <h2 className="text-base font-semibold">分红地址与比例</h2>
        <p className="mt-2 break-all text-xs leading-6 text-mute">网关管理员：{gateway?.owner || "网关尚未配置"}</p>
        {gateway ? <p className="mt-1 text-xs leading-6 text-mute">当前钱包{isOwner(gateway.owner) ? "具备网关设置权限" : "仅可查看；修改需连接对应管理员钱包"}</p> : null}
        <form onSubmit={updateRates} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-2 text-xs text-mute"><span>地址一占买入金额（%）</span><input aria-label="地址一手续费百分比" className={inputClass} inputMode="decimal" value={rate1} onChange={e => setRate1(e.target.value)} disabled={!isOwner(gateway?.owner) || busy} /></label><label className="space-y-2 text-xs text-mute"><span>地址二占买入金额（%）</span><input aria-label="地址二手续费百分比" className={inputClass} inputMode="decimal" value={rate2} onChange={e => setRate2(e.target.value)} disabled={!isOwner(gateway?.owner) || busy} /></label></div>
          <p className="text-xs leading-6 text-mute">两项合计固定为 3%，剩余 97% USDT 用于兑换 CaBi。</p>
          <button disabled={!isOwner(gateway?.owner) || busy} className="btn btn-gold min-h-11 px-4 text-sm">确认比例并在钱包签名</button>
        </form>
        <form onSubmit={updateReceivers} className="mt-5 space-y-3 border-t border-line pt-5">
          <label className="block space-y-2 text-xs text-mute"><span>收款地址一</span><input className={inputClass} value={receiver1} onChange={e => setReceiver1(e.target.value)} spellCheck={false} autoComplete="off" placeholder="0x…" disabled={!isOwner(gateway?.owner) || busy} /></label>
          <label className="block space-y-2 text-xs text-mute"><span>收款地址二</span><input className={inputClass} value={receiver2} onChange={e => setReceiver2(e.target.value)} spellCheck={false} autoComplete="off" placeholder="0x…" disabled={!isOwner(gateway?.owner) || busy} /></label>
          <button disabled={!isOwner(gateway?.owner) || busy} className="btn btn-outline min-h-11 px-4 text-sm">确认地址并在钱包签名</button>
        </form>
      </Card>
      <Card className="p-5 sm:p-6">
        <h2 className="text-base font-semibold">普通地址持仓上限</h2>
        <p className="mt-2 break-all text-xs leading-6 text-mute">代币管理员：{token?.owner || "代币尚未配置"}</p>
        <DataRow label="链上当前上限" value={token ? `${formatAssetAmount(token.maxWalletAmount, token.decimals)} CaBi` : "—"} />
        <form onSubmit={updateLimit} className="mt-3 space-y-3"><label className="block space-y-2 text-xs text-mute"><span>新的持仓上限（CaBi）</span><input className={inputClass} inputMode="decimal" value={limit} onChange={e => setLimit(e.target.value)} disabled={!isOwner(token?.owner) || busy} /></label><p className="text-xs leading-6 text-mute">降低上限不会扣回已有余额。已豁免的钱包不受普通持仓上限限制。</p><button disabled={!isOwner(token?.owner) || busy} className="btn btn-gold min-h-11 px-4 text-sm">确认上限并在钱包签名</button></form>
      </Card>
      {formError ? <p role="alert" className="text-sm text-down">{formError}</p> : null}
      {transaction ? <Card className="p-5 sm:p-6"><div role="status" aria-live="polite" className="flex items-center gap-2 text-sm font-semibold">{busy ? <LoaderCircle className="animate-spin" size={16} /> : transaction.status === "success" ? <CheckCircle2 size={16} /> : null}{transaction.status === "wallet" ? "等待钱包确认" : transaction.status === "pending" ? "等待链上确认" : transaction.status === "success" ? "设置已生效" : "设置未完成"}</div><p className="mt-2 break-words text-sm leading-6">{transaction.description}</p><p className="mt-2 text-xs leading-6 text-mute">{transaction.message}</p>{transaction.hash ? <a href={getExplorerTxUrl(transaction.hash)} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center gap-1 break-all text-xs text-mute">查看交易 <ExternalLink size={13} /></a> : null}{transaction.status === "pending" && transaction.hash ? <button onClick={() => void confirmTransaction(transaction.hash!, transaction.description, transaction.target!, transaction.data!)} className="btn btn-outline ml-3 min-h-11 px-3 text-xs">继续查询确认结果</button> : null}</Card> : null}
    </>
  );
}
