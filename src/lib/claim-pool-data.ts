"use client";

import { useMemo, useSyncExternalStore } from "react";
import { createPublicClient, fallback, getAddress, http, isAddress, parseAbi, zeroAddress, type Address } from "viem";
import { appChain, chainConfig, chainConfigurationValid, contracts } from "./chain-config";

// CaBiSignedClaimPool：额度由服务器按「认购单 + 直推 + 极差」聚合，并用 CLAIM_SIGNER 签发 EIP-712 授权；
// 前端只负责展示额度、请求签名、调用 claim(amount, nonce, deadline, mode, signature)。
export const claimPoolAbi = parseAbi([
  "function token() view returns (address)", "function usdt() view returns (address)", "function usdtDecimals() view returns (uint8)",
  "function owner() view returns (address)", "function pendingOwner() view returns (address)", "function lpReceiver() view returns (address)",
  "function signer() view returns (address)", "function burnRemainder() view returns (bool)",
  "function directRatio() view returns (uint256)", "function lpRatio() view returns (uint256)",
  "function lpTokenRatio() view returns (uint256)", "function lpUsdtRatio() view returns (uint256)",
  "function poolBalance() view returns (uint256)", "function totalClaimed() view returns (uint256)", "function totalBurned() view returns (uint256)",
  "function allocatedUnclaimed() view returns (uint256)", "function unusedBalance() view returns (uint256)",
  "function claimedOf(address) view returns (uint256)", "function claimLimitOf(address) view returns (uint256)",
  "function nonceUsed(address,uint256) view returns (bool)",
  "function previewClaim(uint256,uint8) view returns (uint256 payout,uint256 burnAmount,uint256 lpTokens,uint256 usdtRequired)",
  "function claim(uint256,uint256,uint256,uint8,bytes)",
  "function deposit(uint256)", "function withdrawUnused(uint256)", "function setSigner(address)", "function setBurnRemainder(bool)",
  "function setLpReceiver(address)", "function setUsdt(address)", "function transferOwnership(address)", "function acceptOwnership()",
]);
const assetAbi = parseAbi([
  "function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)",
  "function maxWalletAmount() view returns (uint256)", "function isMaxWalletExempt(address) view returns (bool)",
]);
export const claimPoolClient = createPublicClient({ chain: appChain, transport: fallback(chainConfig.rpcUrls.map(url => http(url, { timeout: 10_000, retryCount: 0 })), { retryCount: 0 }) });
export const serviceClient = claimPoolClient;
export interface ClaimPreview { amount: bigint; payout: bigint; burnAmount: bigint; lpTokens: bigint; usdtRequired: bigint; }
export interface ClaimPoolWallet { tokenBalance: bigint; usdtBalance?: bigint; allowance?: bigint; maxWalletAmount: bigint; exempt: boolean; }
/** 服务器签发的领取额度；未登录时 claimable 为空，needsSignIn=true。 */
export interface ClaimServerState { configured: boolean; authenticated: boolean; needsSignIn: boolean; claimable?: bigint; error?: string; signer?: Address; }
export interface ClaimPoolData {
  token: Address; usdt: Address; owner: Address; pendingOwner: Address; lpReceiver: Address; signer: Address; burnRemainder: boolean;
  directRatio: bigint; lpRatio: bigint; lpTokenRatio: bigint; lpUsdtRatio: bigint; usdtDecimals: number; tokenDecimals: number;
  poolBalance: bigint; totalClaimed: bigint; totalBurned: bigint; allocatedUnclaimed: bigint; unusedBalance: bigint;
  lpReady: boolean; lpError?: string;
  server: ClaimServerState;
  claimed: bigint;
  wallet?: ClaimPoolWallet; directPreview?: ClaimPreview; lpPreview?: ClaimPreview;
}
export type ClaimPoolStatus = "unconfigured" | "loading" | "ready" | "error";
type Snapshot = { status: ClaimPoolStatus; data?: ClaimPoolData; error?: string; updatedAt?: number };
export type ClaimPoolQuery = Snapshot & { refresh: () => void };
class ClaimPoolReadError extends Error {}

async function fetchServerState(): Promise<ClaimServerState> {
  const response = await fetch("/api/claim/authorization", { cache: "no-store" });
  const body = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) throw new ClaimPoolReadError(typeof body.error === "string" ? body.error : "签名服务暂时不可用，请稍后重试。");
  if (typeof body.claimPool === "string" && contracts.claimPool && body.claimPool.toLowerCase() !== contracts.claimPool.toLowerCase()) {
    throw new ClaimPoolReadError("服务器配置的领取池与当前前端不一致，已暂停操作。");
  }
  const configured = Boolean(body.configured && body.claimPool && body.signer);
  return {
    configured,
    authenticated: Boolean(body.authenticated),
    needsSignIn: !body.authenticated,
    claimable: body.claimable === null || body.claimable === undefined ? undefined : BigInt(String(body.claimable)),
    error: typeof body.error === "string" ? body.error : (configured ? undefined : "服务器未配置签名服务，暂时无法领取。"),
    signer: typeof body.signer === "string" && isAddress(body.signer, { strict: false }) ? getAddress(body.signer.toLowerCase()) : undefined,
  };
}

/// 领取前重新读取；链上字段共享同一区块，额度来自服务器签名服务。
export async function fetchClaimPoolData(account?: Address): Promise<ClaimPoolData> {
  const pool = contracts.claimPool, configuredToken = contracts.token;
  if (!pool || !configuredToken) throw new ClaimPoolReadError("领取池尚未配置。");
  if (!chainConfigurationValid || await claimPoolClient.getChainId() !== chainConfig.id) throw new ClaimPoolReadError("当前网络信息不一致，请稍后重试。");
  const block = await claimPoolClient.getBlock({ blockTag: "latest" }), blockNumber = block.number;
  if (blockNumber === null) throw new ClaimPoolReadError("暂时无法读取领取状态，请重试。");
  const read = <T extends Parameters<typeof claimPoolClient.readContract>[0]>(request: T) => claimPoolClient.readContract({ ...request, blockNumber });
  const code = await Promise.all([pool, configuredToken].map(address => claimPoolClient.getCode({ address, blockNumber })));
  if (code.some(value => !value || value === "0x")) throw new ClaimPoolReadError("领取服务尚未就绪。");
  const [token, usdt, poolOwner, pendingOwner, lpReceiver, poolSigner, burnRemainder, directRatio, lpRatio, lpTokenRatio, lpUsdtRatio, poolUsdtDecimals] = await Promise.all([
    read({ address: pool, abi: claimPoolAbi, functionName: "token" }), read({ address: pool, abi: claimPoolAbi, functionName: "usdt" }),
    read({ address: pool, abi: claimPoolAbi, functionName: "owner" }), read({ address: pool, abi: claimPoolAbi, functionName: "pendingOwner" }),
    read({ address: pool, abi: claimPoolAbi, functionName: "lpReceiver" }), read({ address: pool, abi: claimPoolAbi, functionName: "signer" }),
    read({ address: pool, abi: claimPoolAbi, functionName: "burnRemainder" }),
    read({ address: pool, abi: claimPoolAbi, functionName: "directRatio" }), read({ address: pool, abi: claimPoolAbi, functionName: "lpRatio" }),
    read({ address: pool, abi: claimPoolAbi, functionName: "lpTokenRatio" }), read({ address: pool, abi: claimPoolAbi, functionName: "lpUsdtRatio" }),
    read({ address: pool, abi: claimPoolAbi, functionName: "usdtDecimals" }),
  ]) as [Address, Address, Address, Address, Address, Address, boolean, bigint, bigint, bigint, bigint, number];
  if (token.toLowerCase() !== configuredToken.toLowerCase()) throw new ClaimPoolReadError("领取池代币与 CaBi 配置不一致，已暂停操作。");
  const [tokenDecimals, poolBalance, totalClaimed, totalBurned, allocatedUnclaimed, unusedBalance, actualBalance] = await Promise.all([
    read({ address: token, abi: assetAbi, functionName: "decimals" }), read({ address: pool, abi: claimPoolAbi, functionName: "poolBalance" }),
    read({ address: pool, abi: claimPoolAbi, functionName: "totalClaimed" }), read({ address: pool, abi: claimPoolAbi, functionName: "totalBurned" }),
    read({ address: pool, abi: claimPoolAbi, functionName: "allocatedUnclaimed" }), read({ address: pool, abi: claimPoolAbi, functionName: "unusedBalance" }),
    read({ address: token, abi: assetAbi, functionName: "balanceOf", args: [pool] }),
  ]) as [number, bigint, bigint, bigint, bigint, bigint, bigint];
  if (tokenDecimals !== 18 || directRatio !== 50n || lpRatio !== 70n || lpTokenRatio !== 30n || poolBalance !== actualBalance) throw new ClaimPoolReadError("领取规则或储备信息不一致，请稍后重试。");
  const lpReady = Boolean(usdt && usdt.toLowerCase() !== zeroAddress && lpReceiver && lpReceiver.toLowerCase() !== zeroAddress && contracts.usdt && usdt.toLowerCase() === contracts.usdt.toLowerCase());
  const server = await fetchServerState();
  const result: ClaimPoolData = {
    token, usdt, owner: poolOwner, pendingOwner, lpReceiver, signer: poolSigner, burnRemainder,
    directRatio, lpRatio, lpTokenRatio, lpUsdtRatio, usdtDecimals: poolUsdtDecimals, tokenDecimals,
    poolBalance, totalClaimed, totalBurned, allocatedUnclaimed, unusedBalance, lpReady, server, claimed: 0n,
  };
  if (!lpReady) result.lpError = "USDT 或 LP 接收地址尚未配置，暂时只能选择直接领取 50%。";
  if (!server.configured) result.lpError = result.lpError || "服务器未配置签名服务。";
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
    if (server.claimable !== undefined && server.claimable > 0n) {
      const [direct, lp] = await Promise.all([
        read({ address: pool, abi: claimPoolAbi, functionName: "previewClaim", args: [server.claimable, 0] }),
        lpReady ? read({ address: pool, abi: claimPoolAbi, functionName: "previewClaim", args: [server.claimable, 1] }) : Promise.resolve(undefined),
      ]) as [readonly [bigint, bigint, bigint, bigint], readonly [bigint, bigint, bigint, bigint] | undefined];
      const directPreview = { amount: server.claimable, payout: direct[0], burnAmount: direct[1], lpTokens: direct[2], usdtRequired: direct[3] };
      if (directPreview.payout !== server.claimable * 50n / 100n) throw new ClaimPoolReadError("领取预览与额度不一致，请刷新。");
      result.directPreview = directPreview;
      if (lp) {
        const lpPreview = { amount: server.claimable, payout: lp[0], burnAmount: lp[1], lpTokens: lp[2], usdtRequired: lp[3] };
        if (lpPreview.payout === server.claimable * 70n / 100n && lpPreview.lpTokens === server.claimable - lpPreview.payout) result.lpPreview = lpPreview;
        else result.lpError = "LP 领取报价暂不可用，可选择直接领取。";
      }
    }
    if (claimed > 0n && server.claimable === 0n) result.lpError = result.lpError || "当前没有可领取额度。";
  }
  return result;
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

/** 向签名服务申请领取授权；返回 amount/nonce/deadline/mode/signature。 */
export async function requestClaimAuthorization(mode: 0 | 1): Promise<{ amount: bigint; nonce: bigint; deadline: bigint; mode: 0 | 1; signature: `0x${string}` }> {
  const response = await fetch("/api/claim/authorization", {
    method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }),
  });
  const body = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok || typeof body.error === "string") throw new Error(typeof body.error === "string" ? body.error : "领取授权申请失败，请稍后重试。");
  if (!/^0x[0-9a-fA-F]{130}$/.test(String(body.signature)) || !/^\d+$/.test(String(body.amount)) || !/^\d+$/.test(String(body.nonce))) {
    throw new Error("领取授权格式异常，请稍后重试。");
  }
  return { amount: BigInt(String(body.amount)), nonce: BigInt(String(body.nonce)), deadline: BigInt(Number(body.deadline)), mode: body.mode === 1 ? 1 : 0, signature: String(body.signature) as `0x${string}` };
}

/** 领取成功后把交易哈希登记到服务器，用于本地已领记录与审计（失败不阻塞前端流程）。 */
export async function submitClaimReceipt(nonce: bigint, hash: `0x${string}`): Promise<void> {
  try {
    await fetch("/api/claim/authorization", {
      method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "receipt", nonce: nonce.toString(), hash }),
    });
  } catch { /* 回执失败不影响链上结果；下次签发会以链上 claimedOf 为准。 */ }
}
