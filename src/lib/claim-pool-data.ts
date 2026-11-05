"use client";

import { useMemo, useSyncExternalStore } from "react";
import { createPublicClient, fallback, getAddress, http, isAddress, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { appChain, chainConfig, chainConfigurationValid, contracts } from "./chain-config";

/**
 * CaBiMerkleClaimPool：owner 用自己钱包发布 Merkle root，服务器只按批次返回 proof，不持有私钥。
 * 领取只有一条路径：支付 30% USDT 组建流动性，30% 代币转入 LP 接收地址，70% 到账用户。
 * 前端流程：取 proof → 用户钱包直接调用 claim(累计额度, proof)。
 */
export const claimPoolAbi = parseAbi([
  "function token() view returns (address)", "function usdt() view returns (address)", "function usdtDecimals() view returns (uint8)",
  "function owner() view returns (address)", "function pendingOwner() view returns (address)", "function lpReceiver() view returns (address)",
  "function merkleRoot() view returns (bytes32)", "function epoch() view returns (uint256)",
  "function poolBalance() view returns (uint256)", "function totalClaimed() view returns (uint256)",
  "function totalLpTokens() view returns (uint256)", "function totalUsdtCharged() view returns (uint256)",
  "function claimedOf(address) view returns (uint256)",
  "function previewClaim(address,uint256) view returns (uint256 delta,uint256 payout,uint256 lpTokens,uint256 usdtRequired)",
  "function claim(uint256,bytes32[])",
  "error InvalidProof()", "error AlreadyClaimed()", "error InvalidAmount()", "error RootUnset()",
  "error LpReceiverUnset()", "error UsdtUnset()", "error LpPaymentFailed()", "error InsufficientPoolBalance()",
  "error NotOwner()", "error InvalidRoot()", "error EpochNotAdvanced()", "error Reentrancy()",
]);
const assetAbi = parseAbi([
  "function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)",
  "function maxWalletAmount() view returns (uint256)", "function isMaxWalletExempt(address) view returns (bool)",
]);
export const claimPoolClient = createPublicClient({ chain: appChain, transport: fallback(chainConfig.rpcUrls.map(url => http(url, { timeout: 10_000, retryCount: 0 })), { retryCount: 0 }) });
export const serviceClient = claimPoolClient;
export interface ClaimPreview { amount: bigint; payout: bigint; lpTokens: bigint; usdtRequired: bigint; }
export interface ClaimPoolWallet { tokenBalance: bigint; usdtBalance?: bigint; allowance?: bigint; maxWalletAmount: bigint; exempt: boolean; }
/** 服务器返回的当前批次 proof；未登录时 claimable 为空，needsSignIn=true。 */
export interface ClaimServerState {
  configured: boolean; authenticated: boolean; needsSignIn: boolean;
  amount?: bigint; claimable?: bigint; proof?: Hex[]; root?: Hex; epoch?: number; error?: string;
}
export interface ClaimPoolData {
  token: Address; usdt: Address; owner: Address; pendingOwner: Address; lpReceiver: Address;
  merkleRoot: Hex; epoch: number;
  usdtDecimals: number; tokenDecimals: number;
  poolBalance: bigint; totalClaimed: bigint; totalLpTokens: bigint; totalUsdtCharged: bigint;
  lpReady: boolean; lpError?: string;
  server: ClaimServerState;
  claimed: bigint;
  wallet?: ClaimPoolWallet; preview?: ClaimPreview;
}
export type ClaimPoolStatus = "unconfigured" | "loading" | "ready" | "error";
type Snapshot = { status: ClaimPoolStatus; data?: ClaimPoolData; error?: string; updatedAt?: number };
export type ClaimPoolQuery = Snapshot & { refresh: () => void };
class ClaimPoolReadError extends Error {}

function asHexArray(value: unknown): Hex[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Hex => typeof item === "string" && /^0x[0-9a-fA-F]{64}$/.test(item));
}

async function fetchServerState(): Promise<ClaimServerState> {
  const response = await fetch("/api/claim/proof", { cache: "no-store" });
  const body = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) throw new ClaimPoolReadError(typeof body.error === "string" ? body.error : "领取证明暂时不可用，请稍后重试。");
  if (typeof body.claimPool === "string" && contracts.claimPool && body.claimPool.toLowerCase() !== contracts.claimPool.toLowerCase()) {
    throw new ClaimPoolReadError("服务器配置的领取池与当前前端不一致，已暂停操作。");
  }
  return {
    configured: Boolean(body.configured && body.claimPool),
    authenticated: Boolean(body.authenticated),
    needsSignIn: !body.authenticated,
    amount: body.amount === null || body.amount === undefined ? undefined : BigInt(String(body.amount)),
    claimable: body.claimable === null || body.claimable === undefined ? undefined : BigInt(String(body.claimable)),
    proof: asHexArray(body.proof),
    root: typeof body.root === "string" && /^0x[0-9a-fA-F]{64}$/.test(body.root) ? body.root as Hex : undefined,
    epoch: body.epoch === undefined ? undefined : Number(body.epoch),
    error: typeof body.error === "string" ? body.error : undefined,
  };
}

/// 领取前重新读取；链上字段共享同一区块，额度与 proof 来自当前已发布的 Merkle 批次。
export async function fetchClaimPoolData(account?: Address): Promise<ClaimPoolData> {
  const pool = contracts.claimPool, configuredToken = contracts.token;
  if (!pool || !configuredToken) throw new ClaimPoolReadError("领取池尚未配置。");
  if (!chainConfigurationValid || await claimPoolClient.getChainId() !== chainConfig.id) throw new ClaimPoolReadError("当前网络信息不一致，请稍后重试。");
  const block = await claimPoolClient.getBlock({ blockTag: "latest" }), blockNumber = block.number;
  if (blockNumber === null) throw new ClaimPoolReadError("暂时无法读取领取状态，请重试。");
  const read = <T extends Parameters<typeof claimPoolClient.readContract>[0]>(request: T) => claimPoolClient.readContract({ ...request, blockNumber });
  const code = await Promise.all([pool, configuredToken].map(address => claimPoolClient.getCode({ address, blockNumber })));
  if (code.some(value => !value || value === "0x")) throw new ClaimPoolReadError("领取服务尚未就绪。");
  const [token, usdt, poolOwner, pendingOwner, lpReceiver, merkleRoot, epoch, poolUsdtDecimals] = await Promise.all([
    read({ address: pool, abi: claimPoolAbi, functionName: "token" }), read({ address: pool, abi: claimPoolAbi, functionName: "usdt" }),
    read({ address: pool, abi: claimPoolAbi, functionName: "owner" }), read({ address: pool, abi: claimPoolAbi, functionName: "pendingOwner" }),
    read({ address: pool, abi: claimPoolAbi, functionName: "lpReceiver" }),
    read({ address: pool, abi: claimPoolAbi, functionName: "merkleRoot" }), read({ address: pool, abi: claimPoolAbi, functionName: "epoch" }),
    read({ address: pool, abi: claimPoolAbi, functionName: "usdtDecimals" }),
  ]) as [Address, Address, Address, Address, Address, Hex, bigint, number];
  if (token.toLowerCase() !== configuredToken.toLowerCase()) throw new ClaimPoolReadError("领取池代币与 CaBi 配置不一致，已暂停操作。");
  const [tokenDecimals, poolBalance, totalClaimed, totalLpTokens, totalUsdtCharged, actualBalance] = await Promise.all([
    read({ address: token, abi: assetAbi, functionName: "decimals" }), read({ address: pool, abi: claimPoolAbi, functionName: "poolBalance" }),
    read({ address: pool, abi: claimPoolAbi, functionName: "totalClaimed" }), read({ address: pool, abi: claimPoolAbi, functionName: "totalLpTokens" }),
    read({ address: pool, abi: claimPoolAbi, functionName: "totalUsdtCharged" }),
    read({ address: token, abi: assetAbi, functionName: "balanceOf", args: [pool] }),
  ]) as [number, bigint, bigint, bigint, bigint, bigint];
  if (tokenDecimals !== 18 || poolBalance !== actualBalance) throw new ClaimPoolReadError("领取规则或储备信息不一致，请稍后重试。");
  const lpReady = Boolean(usdt && usdt.toLowerCase() !== zeroAddress && lpReceiver && lpReceiver.toLowerCase() !== zeroAddress && contracts.usdt && usdt.toLowerCase() === contracts.usdt.toLowerCase());
  const server = await fetchServerState();
  if (server.root && server.root.toLowerCase() !== merkleRoot.toLowerCase()) throw new ClaimPoolReadError("领取批次已更新，请刷新后重试。");
  const result: ClaimPoolData = {
    token, usdt, owner: poolOwner, pendingOwner, lpReceiver, merkleRoot, epoch: Number(epoch),
    usdtDecimals: poolUsdtDecimals, tokenDecimals,
    poolBalance, totalClaimed, totalLpTokens, totalUsdtCharged, lpReady, server, claimed: 0n,
  };
  if (!lpReady) result.lpError = "USDT 或 LP 接收地址尚未配置，领取暂不可用，请等待管理员完成配置。";
  if (!server.configured) result.lpError = result.lpError || "领取池尚未配置。";
  if (account) {
    const [balance, allowance, tokenBalance, maxWalletAmount, exempt, claimed] = await Promise.all([
      lpReady ? read({ address: usdt, abi: assetAbi, functionName: "balanceOf", args: [account] }) : Promise.resolve(0n),
      lpReady ? read({ address: usdt, abi: assetAbi, functionName: "allowance", args: [account, pool] }) : Promise.resolve(0n),
      read({ address: token, abi: assetAbi, functionName: "balanceOf", args: [account] }),
      read({ address: token, abi: assetAbi, functionName: "maxWalletAmount" }),
      read({ address: token, abi: assetAbi, functionName: "isMaxWalletExempt", args: [account] }),
      read({ address: pool, abi: claimPoolAbi, functionName: "claimedOf", args: [account] }),
    ]) as [bigint, bigint, bigint, bigint, boolean, bigint];
    result.wallet = { tokenBalance, usdtBalance: balance, allowance, maxWalletAmount, exempt };
    result.claimed = claimed;
    if (server.claimable !== undefined && server.claimable > 0n && lpReady && server.amount !== undefined && server.proof?.length) {
      const preview = await read({ address: pool, abi: claimPoolAbi, functionName: "previewClaim", args: [account, server.amount] }) as readonly [bigint, bigint, bigint, bigint];
      const quote: ClaimPreview = { amount: preview[0], payout: preview[1], lpTokens: preview[2], usdtRequired: preview[3] };
      if (quote.amount !== server.claimable || quote.payout !== server.claimable * 70n / 100n || quote.lpTokens !== server.claimable - quote.payout) throw new ClaimPoolReadError("领取预览与额度不一致，请刷新。");
      result.preview = quote;
    }
    if (claimed > 0n && server.claimable === 0n) result.lpError = result.lpError || "当前没有可领取额度。";
  }
  return result;
}

/** 把合约自定义错误翻译成可操作的提示；无法识别时保留原始信息。 */
export function claimErrorText(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  if (/InvalidProof/i.test(raw)) return "领取凭证无效，请刷新页面后重试（批次可能已更新）。";
  if (/AlreadyClaimed/i.test(raw)) return "本次额度已全部领取，无需重复操作。";
  if (/LpPaymentFailed/i.test(raw)) return "USDT 余额或授权不足，无法完成 30% LP 支付。";
  if (/InsufficientPoolBalance/i.test(raw)) return "领取池余额不足，请联系管理员补足后重试。";
  if (/LpReceiverUnset|UsdtUnset/i.test(raw)) return "领取池的 LP 地址或 USDT 尚未配置，暂不能领取。";
  if (/RootUnset|InvalidRoot|EpochNotAdvanced/i.test(raw)) return "领取批次尚未生效，请等待管理员发布。";
  if (/InvalidAmount/i.test(raw)) return "本次领取额度不足以组建流动性。";
  if (/Reentrancy/i.test(raw)) return "领取请求过于频繁，请稍后重试。";
  return raw;
}

type Entry = { initial: Snapshot; snapshot: Snapshot; listeners: Set<() => void>; subscribe: (listener: () => void) => () => void; refresh: () => void };
const entries = new Map<string, Entry>();
function entryFor(address?: string): Entry {
  const account = address && isAddress(address, { strict: false }) ? getAddress(address.toLowerCase()) : undefined;
  const key = [chainConfig.id, contracts.claimPool, contracts.token, contracts.usdt, address?.toLowerCase() || "public"].join(":");
  const existing = entries.get(key); if (existing) return existing;
  const valid = !address || Boolean(account), configured = Boolean(contracts.claimPool && contracts.token);
  const initial: Snapshot = valid ? { status: configured ? "loading" : "unconfigured" } : { status: "error", error: "钱包地址无效，请重新连接。" };
  let loading = false, timer: ReturnType<typeof setInterval> | undefined;
  const entry: Entry = { initial, snapshot: initial, listeners: new Set(), subscribe: () => () => {}, refresh: () => {} };
  const publish = (snapshot: Snapshot) => { entry.snapshot = snapshot; entry.listeners.forEach(fn => fn()); };
  entry.refresh = () => {
    if (!valid || !configured || loading) return;
    loading = true; publish({ status: "loading", updatedAt: entry.snapshot.updatedAt });
    void fetchClaimPoolData(account).then(data => publish({ status: "ready", data, updatedAt: Date.now() }), error => publish({ status: "error", error: error instanceof ClaimPoolReadError ? error.message : "领取信息暂时无法更新，请重试。" })).finally(() => { loading = false; });
  };
  entry.subscribe = listener => {
    entry.listeners.add(listener);
    if (entry.listeners.size === 1 && valid && configured) {
      if (!entry.snapshot.updatedAt || Date.now() - entry.snapshot.updatedAt >= 15000 || entry.snapshot.status !== "ready") entry.refresh();
      timer = setInterval(entry.refresh, 15000);
      if (typeof window !== "undefined") window.addEventListener("cabi-chain-updated", entry.refresh);
    }
    return () => { entry.listeners.delete(listener); if (!entry.listeners.size) { if (timer) clearInterval(timer); timer = undefined; if (typeof window !== "undefined") window.removeEventListener("cabi-chain-updated", entry.refresh); } };
  };
  entries.set(key, entry); return entry;
}
export function useClaimPoolData(address?: string): ClaimPoolQuery {
  const entry = useMemo(() => entryFor(address), [address]);
  return { ...useSyncExternalStore(entry.subscribe, () => entry.snapshot, () => entry.initial), refresh: entry.refresh };
}
export function refreshClaimPoolData() { entries.forEach(entry => entry.refresh()); }
