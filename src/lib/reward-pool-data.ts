"use client";

// 历史奖励池（NEXT_PUBLIC_REWARD_POOL_ADDRESS）读取。新的认购领取链路使用 claim-pool-data。
import { useMemo, useSyncExternalStore } from "react";
import { createPublicClient, fallback, getAddress, http, isAddress, parseAbi, type Abi, type Address } from "viem";
import { appChain, chainConfig, chainConfigurationValid, contracts } from "./chain-config";

export const rewardPoolAbi = parseAbi([
  "function owner() view returns (address)", "function xbt() view returns (address)", "function usdt() view returns (address)", "function lpReceiver() view returns (address)",
  "function directRatio() view returns (uint256)", "function lpRatio() view returns (uint256)", "function lpUsdtRatio() view returns (uint256)",
  "function burnRemainder() view returns (bool)", "function UNIT_PRICE() view returns (uint256)", "function TOKENS_PER_SHARE() view returns (uint256)",
  "function totalAllocated() view returns (uint256)", "function totalClaimed() view returns (uint256)", "function totalBurned() view returns (uint256)",
  "function poolBalance() view returns (uint256)", "function unusedBalance() view returns (uint256)", "function claimable(address) view returns (uint256)",
  "function claims(address) view returns (bool claimed,uint8 mode,uint256 amount)", "function claim(uint8)", "function claimChecked(uint8,uint256,uint256,uint256,address,bool)",
  "function deposit(uint256)", "function withdrawUnused(uint256)", "function batchSetClaimable(address[],uint256[],bool)",
  "function setBurnRemainder(bool)", "function setDirectRatio(uint256)", "function setLpRatio(uint256)",
  "function setLpUsdtRatio(uint256)", "function setLpReceiver(address)",
]);
const assetAbi = parseAbi(["function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"]);
export const serviceClient = createPublicClient({ chain: appChain, transport: fallback(chainConfig.rpcUrls.map(url => http(url, {timeout: 10_000, retryCount: 0, batch: { wait: 12, batchSize: 30 } })), { retryCount: 0 }) });
export interface ServiceWallet { tokenBalance: bigint; usdtBalance: bigint; allowance: bigint; }
export interface RewardPoolData {
  owner: Address; token: Address; usdt: Address; lpReceiver: Address; directRatio: bigint; lpRatio: bigint; lpUsdtRatio: bigint; burnRemainder: boolean;
  unitPrice: bigint; tokensPerShare: bigint; totalAllocated: bigint; totalClaimed: bigint; totalBurned: bigint; poolBalance: bigint; unusedBalance: bigint; tokenDecimals: number; usdtDecimals: number;
  claimable?: bigint; claim?: { claimed: boolean; mode: number; amount: bigint }; wallet?: ServiceWallet;
}
export type ServiceStatus = "unconfigured" | "loading" | "ready" | "error";
export type ServiceQuery<T> = { status: ServiceStatus; data?: T; error?: string; updatedAt?: number; refresh: () => void };
class ServiceReadError extends Error {}
function read(address: Address, abi: Abi, functionName: string, blockNumber: bigint, args?: readonly unknown[]) { return serviceClient.readContract({ address, abi, functionName, args, blockNumber }); }
async function loadReward(account?: Address): Promise<RewardPoolData> {
  const address = contracts.rewardPool!;
  if (!chainConfigurationValid || await serviceClient.getChainId() !== chainConfig.id) throw new ServiceReadError("RPC 与项目网络不一致，请检查配置。");
  const blockNumber = await serviceClient.getBlockNumber({ cacheTime: 0 });
  const code = await serviceClient.getCode({ address, blockNumber });
  if (!code || code === "0x") throw new ServiceReadError("当前网络未找到配置的奖励池合约。");
  const [token, usdt] = await Promise.all([read(address, rewardPoolAbi, "xbt", blockNumber), read(address, rewardPoolAbi, "usdt", blockNumber)]) as [Address, Address];
  if (token.toLowerCase() !== contracts.token!.toLowerCase() || usdt.toLowerCase() !== contracts.usdt!.toLowerCase()) throw new ServiceReadError("奖励池资产与 CaBi / USDT 配置不一致，已禁止操作。");
  const [tokenDecimals, usdtDecimals] = await Promise.all([read(token, assetAbi, "decimals", blockNumber), read(usdt, assetAbi, "decimals", blockNumber)]) as [number, number];
  if (tokenDecimals !== 18 || ![6,18].includes(usdtDecimals)) throw new ServiceReadError("当前业务仅适配 18 位 CaBi 与 6 / 18 位 USDT，请检查配置。");
  const names = ["owner","lpReceiver","directRatio","lpRatio","lpUsdtRatio","burnRemainder","UNIT_PRICE","TOKENS_PER_SHARE","totalAllocated","totalClaimed","totalBurned","poolBalance","unusedBalance"] as const;
  const [owner,lpReceiver,directRatio,lpRatio,lpUsdtRatio,burnRemainder,unitPrice,tokensPerShare,totalAllocated,totalClaimed,totalBurned,poolBalance,unusedBalance] = await Promise.all(names.map(name => read(address, rewardPoolAbi, name, blockNumber))) as [Address,Address,bigint,bigint,bigint,boolean,bigint,bigint,bigint,bigint,bigint,bigint,bigint];
  if ([directRatio,lpRatio,lpUsdtRatio].some(r => r > 100n) || tokensPerShare === 0n) throw new ServiceReadError("奖励池返回了无效比例或定价。");
  const result: RewardPoolData = { owner, token, usdt, lpReceiver, directRatio, lpRatio, lpUsdtRatio, burnRemainder, unitPrice, tokensPerShare, totalAllocated, totalClaimed, totalBurned, poolBalance, unusedBalance, tokenDecimals, usdtDecimals };
  if (account) {
    const [claimable, claim, tokenBalance, usdtBalance] = await Promise.all([
      read(address, rewardPoolAbi, "claimable", blockNumber, [account]), read(address, rewardPoolAbi, "claims", blockNumber, [account]),
      read(token, assetAbi, "balanceOf", blockNumber, [account]), read(usdt, assetAbi, "balanceOf", blockNumber, [account]),
    ]) as [bigint, readonly [boolean, number, bigint], bigint, bigint];
    Object.assign(result, { claimable, claim: { claimed: claim[0], mode: claim[1], amount: claim[2] }, wallet: { tokenBalance, usdtBalance, allowance: 0n } });
  }
  return result;
}
type Entry<T> = { snapshot: ServiceQuery<T>; initial: ServiceQuery<T>; listeners: Set<() => void>; refresh: () => void; subscribe: (listener: () => void) => () => void };
const entries = new Map<string, Entry<RewardPoolData>>();
function entryFor(address?: string) {
  const account = address && isAddress(address, { strict: false }) ? getAddress(address.toLowerCase()) : undefined;
  const key = [chainConfig.id, contracts.rewardPool, contracts.token, contracts.usdt, address?.toLowerCase() || "public"].join(":");
  const existing = entries.get(key); if (existing) return existing;
  const invalid = Boolean(address && !account), configured = Boolean(contracts.rewardPool && contracts.token && contracts.usdt);
  const initial: ServiceQuery<RewardPoolData> = invalid ? { status: "error", error: "钱包地址无效", refresh: () => {} } : { status: configured ? "loading" : "unconfigured", refresh: () => {} };
  let busy = false, timer: ReturnType<typeof setInterval> | undefined;
  const entry: Entry<RewardPoolData> = { snapshot: initial, initial, listeners: new Set(), refresh: () => {}, subscribe: () => () => {} };
  const publish = (snapshot: ServiceQuery<RewardPoolData>) => { entry.snapshot = snapshot; entry.listeners.forEach(fn => fn()); };
  entry.refresh = () => { if (!configured || invalid || busy) return; busy = true; publish({ status: "loading", updatedAt: entry.snapshot.updatedAt, refresh: entry.refresh }); void loadReward(account).then(data => publish({ status: "ready", data, updatedAt: Date.now(), refresh: entry.refresh }), error => publish({ status: "error", error: error instanceof ServiceReadError ? error.message : "链上查询失败，请刷新重试。", refresh: entry.refresh })).finally(() => { busy = false; }); };
  entry.subscribe = listener => { entry.listeners.add(listener); if (entry.listeners.size === 1 && configured && !invalid) { if (!entry.snapshot.updatedAt || Date.now() - entry.snapshot.updatedAt >= 30_000 || entry.snapshot.status !== "ready") entry.refresh(); timer = setInterval(entry.refresh, 30_000); } return () => { entry.listeners.delete(listener); if (!entry.listeners.size && timer) { clearInterval(timer); timer = undefined; } }; };
  entries.set(key, entry); return entry;
}
export function useRewardPoolData(address?: string): ServiceQuery<RewardPoolData> {
  const entry = useMemo(() => entryFor(address), [address]);
  return { ...useSyncExternalStore(entry.subscribe, () => entry.snapshot, () => entry.initial), refresh: entry.refresh };
}
export function refreshRewardPoolData() { entries.forEach(entry => entry.refresh()); }
