"use client";

import { useMemo, useSyncExternalStore } from "react";
import { createPublicClient, fallback, getAddress, http, isAddress, parseAbi, zeroAddress, type Address } from "viem";
import { appChain, chainConfig, chainConfigurationValid, contracts } from "./chain-config";

// CaBiLaunchPool：服务器签发 Prepare 授权，用户钱包先组 LP，领取开放后再领取 70%。
export const claimPoolAbi = parseAbi([
  "function token() view returns (address)", "function usdt() view returns (address)", "function usdtDecimals() view returns (uint8)",
  "function signer() view returns (address)", "function lpReceiver() view returns (address)",
  "function poolBalance() view returns (uint256)", "function totalPrepared() view returns (uint256)", "function totalClaimed() view returns (uint256)",
  "function totalLpTokens() view returns (uint256)", "function totalUsdtCharged() view returns (uint256)",
  "function preparedOf(address) view returns (uint256)", "function claimedHere(address) view returns (uint256)",
  "function previewPrepare(uint256) view returns (uint256 payout,uint256 lpTokens,uint256 usdtRequired,uint256 estimatedLiquidity)",
  "function prepareLiquidity((uint256 amount,uint256 cumulativeLimit,uint256 nonce,uint256 deadline),bytes,uint256,uint256)",
  "function claim()", "function claimPartial(uint256)", "function releaseProjectLp()",
]);
const assetAbi = parseAbi(["function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function maxWalletAmount() view returns (uint256)", "function isMaxWalletExempt(address) view returns (bool)"]);
const tokenAbi = parseAbi(["function isClaimOpen() view returns (bool)", "function liquidityEnabled() view returns (bool)", "function isTradingOpen() view returns (bool)", "function launchPool() view returns (address)"]);
export const claimPoolClient = createPublicClient({ chain: appChain, transport: fallback(chainConfig.rpcUrls.map(url => http(url, { timeout: 10_000, retryCount: 0 })), { retryCount: 0 }) });
export const serviceClient = claimPoolClient;
export interface ClaimPreview { amount: bigint; payout: bigint; lpTokens: bigint; usdtRequired: bigint; estimatedLiquidity: bigint; }
export interface ClaimPoolWallet { tokenBalance: bigint; usdtBalance?: bigint; allowance?: bigint; maxWalletAmount: bigint; exempt: boolean; }
export interface ClaimServerState { configured: boolean; authenticated: boolean; needsSignIn: boolean; liquidityEnabled: boolean; claimable?: bigint; entitlement?: bigint; error?: string; signer?: Address; }
export interface ClaimPoolData {
  token: Address; usdt: Address; lpReceiver: Address; signer: Address; usdtDecimals: number; tokenDecimals: number;
  poolBalance: bigint; totalPrepared: bigint; totalClaimed: bigint; totalLpTokens: bigint; totalUsdtCharged: bigint;
  claimOpen: boolean; prepared: bigint; claimed: bigint; lpReady: boolean; lpError?: string;
  server: ClaimServerState; wallet?: ClaimPoolWallet; preview?: ClaimPreview;
}
export type ClaimPoolStatus = "unconfigured" | "loading" | "ready" | "error";
type Snapshot = { status: ClaimPoolStatus; data?: ClaimPoolData; error?: string; updatedAt?: number };
export type ClaimPoolQuery = Snapshot & { refresh: () => void };
class ClaimPoolReadError extends Error {}

async function fetchServerState(): Promise<ClaimServerState> {
  const response = await fetch("/api/claim/authorization", { cache: "no-store" });
  const body = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) throw new ClaimPoolReadError(typeof body.error === "string" ? body.error : "签名服务暂时不可用，请稍后重试。");
  if (typeof body.claimPool === "string" && contracts.claimPool && body.claimPool.toLowerCase() !== contracts.claimPool.toLowerCase()) throw new ClaimPoolReadError("服务器配置的领取池与当前前端不一致，已暂停操作。");
  const configured = Boolean(body.configured && body.claimPool && body.signer);
  return { configured, authenticated: Boolean(body.authenticated), needsSignIn: !body.authenticated, liquidityEnabled: body.liquidityEnabled === true,
    claimable: body.claimable == null ? undefined : BigInt(String(body.claimable)), entitlement: body.entitlement == null ? undefined : BigInt(String(body.entitlement)),
    error: typeof body.error === "string" ? body.error : (configured ? undefined : "服务器未配置签名服务，暂时无法领取。"),
    signer: typeof body.signer === "string" && isAddress(body.signer, { strict: false }) ? getAddress(body.signer.toLowerCase()) : undefined };
}

export async function fetchClaimPoolData(account?: Address): Promise<ClaimPoolData> {
  const pool = contracts.claimPool, configuredToken = contracts.token;
  if (!pool || !configuredToken) throw new ClaimPoolReadError("领取池尚未配置。");
  if (!chainConfigurationValid || await claimPoolClient.getChainId() !== chainConfig.id) throw new ClaimPoolReadError("当前网络信息不一致，请稍后重试。");
  const block = await claimPoolClient.getBlock({ blockTag: "latest" }), blockNumber = block.number;
  if (blockNumber === null) throw new ClaimPoolReadError("暂时无法读取领取状态，请重试。");
  const read = <T extends Parameters<typeof claimPoolClient.readContract>[0]>(request: T) => claimPoolClient.readContract({ ...request, blockNumber });
  const code = await Promise.all([pool, configuredToken].map(address => claimPoolClient.getCode({ address, blockNumber })));
  if (code.some(value => !value || value === "0x")) throw new ClaimPoolReadError("领取服务尚未就绪。");
  const [token, usdt, lpReceiver, poolSigner, poolUsdtDecimals, claimOpen, liquidityEnabled, tradingOpen, launchPool] = await Promise.all([
    read({ address: pool, abi: claimPoolAbi, functionName: "token" }), read({ address: pool, abi: claimPoolAbi, functionName: "usdt" }),
    read({ address: pool, abi: claimPoolAbi, functionName: "lpReceiver" }), read({ address: pool, abi: claimPoolAbi, functionName: "signer" }),
    read({ address: pool, abi: claimPoolAbi, functionName: "usdtDecimals" }), read({ address: configuredToken, abi: tokenAbi, functionName: "isClaimOpen" }),
    read({ address: configuredToken, abi: tokenAbi, functionName: "liquidityEnabled" }), read({ address: configuredToken, abi: tokenAbi, functionName: "isTradingOpen" }),
    read({ address: configuredToken, abi: tokenAbi, functionName: "launchPool" }),
  ]) as [Address, Address, Address, Address, number, boolean, boolean, boolean, Address];
  if (token.toLowerCase() !== configuredToken.toLowerCase()) throw new ClaimPoolReadError("领取池代币与 CaBi 配置不一致，已暂停操作。");
  const [tokenDecimals, poolBalance, totalPrepared, totalClaimed, totalLpTokens, totalUsdtCharged, actualBalance] = await Promise.all([
    read({ address: token, abi: assetAbi, functionName: "decimals" }), read({ address: pool, abi: claimPoolAbi, functionName: "poolBalance" }),
    read({ address: pool, abi: claimPoolAbi, functionName: "totalPrepared" }), read({ address: pool, abi: claimPoolAbi, functionName: "totalClaimed" }),
    read({ address: pool, abi: claimPoolAbi, functionName: "totalLpTokens" }), read({ address: pool, abi: claimPoolAbi, functionName: "totalUsdtCharged" }),
    read({ address: token, abi: assetAbi, functionName: "balanceOf", args: [pool] }),
  ]) as [number, bigint, bigint, bigint, bigint, bigint, bigint];
  if (tokenDecimals !== 18 || poolBalance !== actualBalance) throw new ClaimPoolReadError("领取规则或储备信息不一致，请稍后重试。");
  const assetsReady = usdt.toLowerCase() !== zeroAddress && lpReceiver.toLowerCase() !== zeroAddress && Boolean(contracts.usdt && usdt.toLowerCase() === contracts.usdt.toLowerCase());
  const server = await fetchServerState();
  const lpReady = assetsReady && launchPool.toLowerCase() === pool.toLowerCase() && liquidityEnabled && !tradingOpen && server.liquidityEnabled;
  const result: ClaimPoolData = { token, usdt, lpReceiver, signer: poolSigner, usdtDecimals: poolUsdtDecimals, tokenDecimals,
    poolBalance, totalPrepared, totalClaimed, totalLpTokens, totalUsdtCharged, claimOpen, prepared: 0n, claimed: 0n, lpReady, server };
  if (!lpReady) result.lpError = tradingOpen ? "固定比例组 LP 已结束" : !server.liquidityEnabled ? "组 LP 已暂停，请等待重新开放" : !liquidityEnabled ? "组 LP 尚未开放" : "组 LP 配置尚未就绪，请联系管理员";
  if (!server.configured) result.lpError = result.lpError || "服务器未配置签名服务。";
  if (account) {
    const [balance, allowance, tokenBalance, maxWalletAmount, exempt, prepared, claimed] = await Promise.all([
      lpReady ? read({ address: usdt, abi: assetAbi, functionName: "balanceOf", args: [account] }) : Promise.resolve(0n),
      lpReady ? read({ address: usdt, abi: assetAbi, functionName: "allowance", args: [account, pool] }) : Promise.resolve(0n),
      read({ address: token, abi: assetAbi, functionName: "balanceOf", args: [account] }), read({ address: token, abi: assetAbi, functionName: "maxWalletAmount" }),
      read({ address: token, abi: assetAbi, functionName: "isMaxWalletExempt", args: [account] }), read({ address: pool, abi: claimPoolAbi, functionName: "preparedOf", args: [account] }),
      read({ address: pool, abi: claimPoolAbi, functionName: "claimedHere", args: [account] }),
    ]) as [bigint, bigint, bigint, bigint, boolean, bigint, bigint];
    result.wallet = { tokenBalance, usdtBalance: balance, allowance, maxWalletAmount, exempt }; result.prepared = prepared; result.claimed = claimed;
    if (server.claimable !== undefined && server.claimable > 0n && lpReady) {
      try {
        const preview = await read({ address: pool, abi: claimPoolAbi, functionName: "previewPrepare", args: [server.claimable] }) as readonly [bigint, bigint, bigint, bigint];
        result.preview = { amount: server.claimable, payout: preview[0], lpTokens: preview[1], usdtRequired: preview[2], estimatedLiquidity: preview[3] };
      } catch { result.lpReady = false; result.lpError = "组 LP 储备暂不满足条件，请稍后重试"; }
    }
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
  entry.refresh = () => { if (!valid || !configured || loading) return; loading = true; if (!entry.snapshot.data) publish({ status: "loading", updatedAt: entry.snapshot.updatedAt }); void fetchClaimPoolData(account).then(data => publish({ status: "ready", data, updatedAt: Date.now() }), error => publish({ ...entry.snapshot, status: "error", error: error instanceof ClaimPoolReadError ? error.message : "领取信息暂时无法更新，请重试。" })).finally(() => { loading = false; }); };
  entry.subscribe = listener => { entry.listeners.add(listener); if (entry.listeners.size === 1 && valid && configured) { if (!entry.snapshot.updatedAt || Date.now() - entry.snapshot.updatedAt >= 60000 || entry.snapshot.status !== "ready") entry.refresh(); timer = setInterval(entry.refresh, 60000); if (typeof window !== "undefined") window.addEventListener("cabi-chain-updated", entry.refresh); } return () => { entry.listeners.delete(listener); if (!entry.listeners.size) { if (timer) clearInterval(timer); timer = undefined; if (typeof window !== "undefined") window.removeEventListener("cabi-chain-updated", entry.refresh); } }; };
  entries.set(key, entry); return entry;
}
export function useClaimPoolData(address?: string): ClaimPoolQuery { const entry = useMemo(() => entryFor(address), [address]); return { ...useSyncExternalStore(entry.subscribe, () => entry.snapshot, () => entry.initial), refresh: entry.refresh }; }
export function refreshClaimPoolData() { entries.forEach(entry => entry.refresh()); }

export async function verifyLiquidityAccess() {
  const response = await fetch("/api/liquidity/status", { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.available !== true || body.chainId !== chainConfig.id || body.pool?.toLowerCase() !== contracts.claimPool?.toLowerCase() || body.token?.toLowerCase() !== contracts.token?.toLowerCase()) {
    throw new Error(typeof body.reason === "string" ? body.reason : "组 LP 状态暂时无法确认，请刷新后重试");
  }
}

export async function requestClaimAuthorization(amount: bigint): Promise<{ amount: bigint; cumulativeLimit: bigint; nonce: bigint; deadline: bigint; signature: `0x${string}` }> {
  const response = await fetch("/api/claim/authorization", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: amount.toString() }) });
  const body = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok || typeof body.error === "string") throw new Error(typeof body.error === "string" ? body.error : "领取授权申请失败，请稍后重试。");
  if (!/^0x[0-9a-fA-F]{130}$/.test(String(body.signature)) || !/^\d+$/.test(String(body.amount)) || !/^\d+$/.test(String(body.cumulativeLimit)) || !/^\d+$/.test(String(body.nonce))) throw new Error("领取授权格式异常，请稍后重试。");
  if (typeof body.claimPool !== "string" || body.claimPool.toLowerCase() !== contracts.claimPool?.toLowerCase() || body.chainId !== chainConfig.id) throw new Error("领取授权与当前领取池或网络不一致，请刷新后重试。");
  return { amount: BigInt(String(body.amount)), cumulativeLimit: BigInt(String(body.cumulativeLimit)), nonce: BigInt(String(body.nonce)), deadline: BigInt(Number(body.deadline)), signature: String(body.signature) as `0x${string}` };
}
export async function submitClaimReceipt(nonce: bigint, hash: `0x${string}`): Promise<void> { try { await fetch("/api/claim/authorization", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "receipt", nonce: nonce.toString(), hash }) }); } catch { /* 链上状态是最终事实 */ } }
