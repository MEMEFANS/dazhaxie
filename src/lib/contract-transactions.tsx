"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, LoaderCircle } from "lucide-react";
import { createPublicClient, createWalletClient, custom, encodeFunctionData, erc20Abi, fallback, getAddress, http, isAddress, type Abi, type Address, type Hash, type Hex } from "viem";
import { appChain, chainConfig, chainConfigurationValid, contracts, getExplorerTxUrl } from "./chain-config";
import * as wallet from "./wallet";
import { useStore } from "./store";
import { recordChainAudit } from "./chain-audit";
import { isUserCancelledError } from "./transaction-cancellation";

const client = createPublicClient({ chain: appChain, transport: fallback(chainConfig.rpcUrls.map(url => http(url, { timeout: 12_000, retryCount: 0 })), { retryCount: 0 }) });
type Phase = "approval" | "action";
export type ContractTransaction = { status: "wallet" | "pending" | "success" | "failed"; description: string; phase: Phase; hash?: Hash; message: string; cancelled?: boolean };
type Pending = { version: 1; scope: string; chainId: number; account: Address; address: Address; data: Hex; hash: Hash; description: string; phase: Phase; retainReceipt?: boolean };
export type ContractRequest = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; description: string; approval?: { token: Address; amount: bigint }; beforeSend?: () => Promise<void>; allowUnsimulated?: boolean; retainReceipt?: boolean };
const inFlight = new Set<string>();
const configuredTargets = () => Object.values(contracts).filter((value): value is Address => Boolean(value));
const isConfigured = (address: string) => configuredTargets().some(value => value.toLowerCase() === address.toLowerCase());
function readPending(key: string, account: string, scope: string): Pending | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const record = JSON.parse(raw) as Pending;
    if (record.version !== 1 || record.scope !== scope || record.chainId !== chainConfig.id || !isAddress(record.account) || record.account.toLowerCase() !== account.toLowerCase()
      || !isAddress(record.address) || !isConfigured(record.address) || !/^0x[0-9a-fA-F]{64}$/.test(record.hash) || !/^0x(?:[0-9a-fA-F]{2}){4,}$/.test(record.data)
      || !["approval", "action"].includes(record.phase) || typeof record.description !== "string" || record.description.length > 500) return null;
    return record;
  } catch { return null; }
}
function savePending(key: string, record: Pending) { try { localStorage.setItem(key, JSON.stringify(record)); } catch { /* Visible hash remains available if storage is unavailable. */ } }
function removePending(key: string) { try { localStorage.removeItem(key); } catch { /* Chain is authoritative. */ } }
function errorText(error: unknown) {
  const text = error instanceof Error ? error.message : "";
  if (isUserCancelledError(error)) return "已取消钱包确认，本次操作未完成。";
  if (/insufficient funds/i.test(text)) return "BNB 手续费余额不足，请补足后重试。";
  if (/钱包|网络|配置|管理员|账户|合约|授权|余额|处理中/.test(text) && text.length < 160) return text;
  if (/max wallet/i.test(text)) return "到账后将超过当前持仓上限，请先调整持仓。";
  if (/insufficient|balance not enough|pool balance|unfunded|reserved/i.test(text)) return "余额或合约可用资金不足，请刷新数据后重试。";
  return "交易未提交或执行未通过，请刷新链上状态并核对余额、额度及合约开关。";
}

export function useContractTransaction(scope: string, options?: { audit?: boolean }) {
  const { state } = useStore();
  const auditEnabled = Boolean(options?.audit);
  const identity = `${state.address.toLowerCase()}:${state.chainId}:${scope}`;
  const lifecycle = useMemo(() => ({ identity, connected: state.connected }), [identity, state.connected]);
  const currentIdentity = useRef<typeof lifecycle | null>(lifecycle);
  useEffect(() => {
    currentIdentity.current = lifecycle;
    return () => { if (currentIdentity.current === lifecycle) currentIdentity.current = null; };
  }, [lifecycle]);
  const [visible, setVisible] = useState<{ identity: string; transaction: ContractTransaction | null }>({ identity, transaction: null });
  const pending = useRef<{ key: string; record: Pending } | null>(null);
  const account = state.connected && isAddress(state.address, { strict: false }) ? getAddress(state.address.toLowerCase()) : undefined;
  const key = `cabi-transaction:v1:${chainConfig.id}:${account || "disconnected"}:${scope}`;
  const transaction = visible.identity === identity ? visible.transaction : null;
  const busy = transaction?.status === "wallet" || transaction?.status === "pending";
  const publish = (value: ContractTransaction) => { if (currentIdentity.current === lifecycle) setVisible({ identity, transaction: value }); };

  useEffect(() => {
    pending.current = null;
    if (!account) return;
    const timer = window.setTimeout(() => {
      const record = readPending(key, account, scope);
      if (record) {
        pending.current = { key, record };
        setVisible({ identity, transaction: { status: "pending", phase: record.phase, hash: record.hash, description: record.description, message: "发现已广播交易，请先查询确认结果，避免重复提交。" } });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [account, identity, key, scope]);

  async function verifyWallet(expected: Address) {
    if (!chainConfigurationValid) throw new Error("应用网络配置无效。");
    const connection = wallet.getConnection();
    if (!connection || currentIdentity.current !== lifecycle) throw new Error("钱包账户已改变，请重新核对。");
    if (await wallet.getChainId() !== chainConfig.id || await client.getChainId() !== chainConfig.id) throw new Error(`请将钱包切换至 ${chainConfig.shortName}。`);
    const addresses = await connection.provider.request({ method: "eth_accounts" }) as string[];
    if (currentIdentity.current !== lifecycle || addresses[0]?.toLowerCase() !== expected.toLowerCase() || wallet.getConnection()?.address.toLowerCase() !== expected.toLowerCase()) throw new Error("钱包账户已改变，请重新核对。");
    return connection;
  }

  async function confirm(record: Pending, storageKey: string): Promise<Hash | undefined> {
    try {
      const receipt = await client.waitForTransactionReceipt({ hash: record.hash, confirmations: 2, timeout: 60_000, pollingInterval: 2_000 });
      const actual = await client.getTransaction({ hash: receipt.transactionHash });
      if (actual.from.toLowerCase() !== record.account.toLowerCase() || actual.to?.toLowerCase() !== record.address.toLowerCase() || actual.input.toLowerCase() !== record.data.toLowerCase() || actual.value !== 0n) {
        removePending(storageKey); pending.current = null;
        publish({ status: "failed", phase: record.phase, hash: receipt.transactionHash, description: record.description, message: "交易已被替换或取消，链上内容与本次操作不一致。" });
        if (auditEnabled) recordChainAudit({ action: record.description, status: "failed", txHash: receipt.transactionHash, wallet: record.account, error: "交易已被替换或取消" });
        return undefined;
      }
      if (receipt.status !== "success") {
        removePending(storageKey); pending.current = null;
        publish({ status: "failed", phase: record.phase, hash: receipt.transactionHash, description: record.description, message: "交易执行失败，本次业务未生效。" });
        if (auditEnabled) recordChainAudit({ action: record.description, status: "failed", txHash: receipt.transactionHash, wallet: record.account, error: "交易执行失败" });
        return undefined;
      }
      if (!record.retainReceipt) { removePending(storageKey); pending.current = null; }
      else {
        const confirmedRecord = { ...record, hash: receipt.transactionHash };
        savePending(storageKey, confirmedRecord); pending.current = { key: storageKey, record: confirmedRecord };
      }
      publish({ status: "success", phase: record.phase, hash: receipt.transactionHash, description: record.description, message: record.phase === "approval" ? "授权已确认；授权不代表业务已完成，请继续提交原操作。" : "链上交易已确认，业务数据正在刷新。" });
      if (auditEnabled) recordChainAudit({ action: record.description, status: "success", txHash: receipt.transactionHash, wallet: record.account, after: { phase: record.phase } });
      window.dispatchEvent(new Event("cabi-chain-updated"));
      return currentIdentity.current === lifecycle ? receipt.transactionHash : undefined;
    } catch {
      publish({ status: "pending", phase: record.phase, hash: record.hash, description: record.description, message: "交易已广播，暂未查到最终结果。请继续查询，不要重复提交。" });
      return undefined;
    }
  }

  async function run(request: ContractRequest): Promise<Hash | undefined> {
    if (!account || currentIdentity.current !== lifecycle || inFlight.has(key)) return undefined;
    if (pending.current?.key === key || readPending(key, account, scope)) {
      const record = pending.current?.key === key ? pending.current.record : readPending(key, account, scope)!;
      publish({ status: "pending", hash: record.hash, phase: record.phase, description: record.description, message: "存在待确认交易，请先查询链上结果。" });
      return undefined;
    }
    inFlight.add(key);
    let phase: Phase = "action";
    const send = async (address: Address, abi: Abi, functionName: string, args: readonly unknown[], description: string, stage: Phase) => {
      phase = stage;
      const connection = await verifyWallet(account);
      const bytecode = await client.getCode({ address });
      if (!isConfigured(address) || !bytecode || bytecode === "0x") throw new Error("目标合约未正确配置。");
      publish({ status: "wallet", phase: stage, description, message: "请核对钱包显示的合约、金额及操作内容。" });
      const data = encodeFunctionData({ abi, functionName, args });
      let hash: Hash;
      let walletRequested = false;
      try {
        const simulation = await client.simulateContract({ address, abi, functionName, args, account });
        await verifyWallet(account);
        if (stage === "action" && request.beforeSend) { await request.beforeSend(); await verifyWallet(account); }
        const signer = createWalletClient({ chain: appChain, transport: custom(connection.provider) });
        walletRequested = true;
        hash = await signer.writeContract(simulation.request);
      } catch (simulationError) {
        // 认购等场景允许跳过前端预演：预演失败（如余额不足）时仍唤起钱包，由钱包与链上自行判定成败。
        if (walletRequested || isUserCancelledError(simulationError) || !request.allowUnsimulated) throw simulationError;
        const fresh = await verifyWallet(account);
        if (stage === "action" && request.beforeSend) { await request.beforeSend(); await verifyWallet(account); }
        const signer = createWalletClient({ chain: appChain, transport: custom(fresh.provider) });
        hash = await signer.sendTransaction({ account, chain: appChain, to: address, data, value: 0n });
      }
      const record: Pending = { version: 1, scope, chainId: chainConfig.id, account, address, data, hash, description, phase: stage, ...(stage === "action" && request.retainReceipt ? { retainReceipt: true } : {}) };
      savePending(key, record); pending.current = { key, record };
      publish({ status: "pending", phase: stage, description, hash, message: "交易已广播，等待两个区块确认。" });
      if (auditEnabled) recordChainAudit({ action: description, status: "pending", txHash: hash, wallet: account, after: { address, functionName, args } });
      return confirm(record, key);
    };
    try {
      if (!isConfigured(request.address)) throw new Error("业务合约未正确配置。");
      await verifyWallet(account);
      publish({ status: "wallet", phase: "action", description: request.description, message: "正在核对钱包与链上状态。" });
      if (request.approval && request.approval.amount > 0n) {
        if (![contracts.usdt, contracts.token].some(value => value?.toLowerCase() === request.approval!.token.toLowerCase())) throw new Error("授权资产与项目配置不一致。");
        const allowance = await client.readContract({ address: request.approval.token, abi: erc20Abi, functionName: "allowance", args: [account, request.address] });
        if (allowance < request.approval.amount) {
          if (allowance > 0n && !await send(request.approval.token, erc20Abi, "approve", [request.address, 0n], "重置原授权额度", "approval")) return undefined;
          if (!await send(request.approval.token, erc20Abi, "approve", [request.address, request.approval.amount], "授权本次所需金额", "approval")) return undefined;
          const approved = await client.readContract({ address: request.approval.token, abi: erc20Abi, functionName: "allowance", args: [account, request.address] });
          if (approved < request.approval.amount) throw new Error("钱包实际授权额不足，请重新授权本次所需金额后再组 LP。");
        }
      }
      return await send(request.address, request.abi, request.functionName, request.args || [], request.description, "action");
    } catch (error) {
      publish({ status: "failed", phase, description: request.description, message: errorText(error), cancelled: isUserCancelledError(error) });
      if (auditEnabled) recordChainAudit({ action: request.description, status: "failed", wallet: account, error: errorText(error) });
      return undefined;
    } finally { inFlight.delete(key); }
  }

  async function resume(): Promise<Hash | undefined> {
    if (!account || currentIdentity.current !== lifecycle || inFlight.has(key)) return undefined;
    const record = pending.current?.key === key ? pending.current.record : readPending(key, account, scope);
    if (!record) return undefined;
    inFlight.add(key);
    try {
      if (await client.getChainId() !== chainConfig.id) throw new Error();
      const hash = await confirm(record, key);
      return record.phase === "action" ? hash : undefined;
    } catch {
      publish({ status: "pending", phase: record.phase, hash: record.hash, description: record.description, message: "当前节点网络不匹配或查询失败。交易仍待确认，请核对项目网络后重新查询。" });
      return undefined;
    } finally { inFlight.delete(key); }
  }
  function clear() { if (!busy) setVisible({ identity, transaction: null }); }
  function acknowledge(hash: string) {
    if (!account) return;
    const record = pending.current?.key === key ? pending.current.record : readPending(key, account, scope);
    if (record?.hash.toLowerCase() === hash.toLowerCase()) { removePending(key); pending.current = null; }
  }
  return { run, busy, transaction, resume, clear, acknowledge };
}

export type ContractTransactionController = ReturnType<typeof useContractTransaction>;
export function TransactionFeedback({ controller }: { controller: ContractTransactionController }) {
  const tx = controller.transaction;
  if (!tx) return null;
  return <div className="mt-4 rounded-xl border border-line bg-well p-4" role="status" aria-live="polite">
    <p className="flex items-center gap-2 text-sm font-medium text-strong">{tx.status === "wallet" || tx.status === "pending" ? <LoaderCircle size={16} className="animate-spin" /> : tx.status === "success" ? <CheckCircle2 size={16} /> : null}{tx.description}</p>
    <p className="mt-2 text-xs leading-6 text-mute">{tx.message}</p>
    <div className="flex flex-wrap gap-3">{tx.hash ? <a href={getExplorerTxUrl(tx.hash)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-xs text-mute">查看链上交易 <ExternalLink size={12} /></a> : null}{tx.status === "pending" ? <button type="button" className="btn btn-outline mt-2 min-h-11 px-3 text-xs" onClick={() => void controller.resume()}>继续查询结果</button> : null}</div>
  </div>;
}
