"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, fallback, http, parseAbi, type Address } from "viem";
import { appChain, chainConfig } from "./chain-config";

export interface SubscribeConfig {
  configured: boolean; enabled: boolean; locked: boolean; message?: string;
  payee?: Address; usdt?: Address; token?: Address; chainId: number;
  unitPrice: number; tokensPerShare: number; minShares: number; maxShares: number; hardCap: number; softCap: number;
  globalSold: number; remainingGlobal: number; purchased: number; remainingPersonal: number;
  tokenDecimals: number; usdtDecimals: number;
}
export interface SubscribeOrderView { id: string; address: string; shares: number; amount: string; txHash: string; status: string; createdAt: number }
export interface PromotionStats {
  purchased: number; directCount: number; directShares: number; directRewardShares: number;
  teamCount: number; teamShares: number; differentialShares: number; globalSold: number;
}
export interface PromotionBranch { address: string; name: string; selfShares: number; teamShares: number; tierIndex: number; tierLabel: string; diffRate: number; reward: number; selfReward: number }
export interface PromotionResult { stats: PromotionStats; branches: PromotionBranch[] }
export interface SubscribeSnapshot { status: "loading" | "ready" | "error"; data?: SubscribeConfig; error?: string }
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const client = createPublicClient({ chain: appChain, transport: fallback(chainConfig.rpcUrls.map(url => http(url, { timeout: 10_000, retryCount: 0 })), { retryCount: 0 }) });

export async function fetchSubscribeConfig(address?: string): Promise<SubscribeConfig> {
  const url = address ? `/api/subscribe/config?address=${encodeURIComponent(address)}` : "/api/subscribe/config";
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("认购配置暂时无法读取");
  return await response.json() as SubscribeConfig;
}
export async function fetchSubscribeOrders(): Promise<SubscribeOrderView[]> {
  const response = await fetch("/api/subscribe/orders", { cache: "no-store" });
  if (response.status === 401) return [];
  if (!response.ok) throw new Error("认购记录暂时无法读取");
  const body = await response.json() as { orders?: SubscribeOrderView[] };
  return Array.isArray(body.orders) ? body.orders : [];
}
export async function fetchUsdtBalance(address: string, usdt: Address): Promise<bigint> {
  return await client.readContract({ address: usdt, abi: erc20, functionName: "balanceOf", args: [address as Address] });
}
export function useSubscribeConfig(address?: string) {
  const [snapshot, setSnapshot] = useState<SubscribeSnapshot>({ status: "loading" });
  const refresh = useCallback(() => {
    let active = true;
    void fetchSubscribeConfig(address).then(data => { if (active) setSnapshot({ status: "ready", data }); }, error => { if (active) setSnapshot({ status: "error", error: error instanceof Error ? error.message : "认购配置暂时无法读取" }); });
    return () => { active = false; };
  }, [address]);
  useEffect(() => {
    const cancel = refresh();
    const timer = window.setInterval(() => { void fetchSubscribeConfig(address).then(data => setSnapshot({ status: "ready", data }), error => setSnapshot(previous => previous.data ? previous : { status: "error", error: error instanceof Error ? error.message : "认购配置暂时无法读取" })); }, 15_000);
    return () => { cancel(); window.clearInterval(timer); };
  }, [address, refresh]);
  return useMemo(() => ({ ...snapshot, refresh }), [snapshot, refresh]);
}
export async function fetchPromotionStats(): Promise<PromotionResult | undefined> {
  const response = await fetch("/api/promotion/stats", { cache: "no-store" });
  if (response.status === 401) return undefined;
  if (!response.ok) throw new Error("推广统计暂时无法读取");
  const body = await response.json() as Partial<PromotionResult>;
  return body.stats ? { stats: body.stats, branches: Array.isArray(body.branches) ? body.branches : [] } : undefined;
}
export function usePromotionStats(enabled: boolean) {
  const [result, setResult] = useState<PromotionResult | undefined>();
  const [error, setError] = useState("");
  const refresh = useCallback(() => {
    if (!enabled) { setResult(undefined); return; }
    void fetchPromotionStats().then(value => { setResult(value); setError(value ? "" : "请先免费签名登录"); }, cause => setError(cause instanceof Error ? cause.message : "推广统计暂时无法读取"));
  }, [enabled]);
  useEffect(() => {
    const timer = window.setTimeout(refresh, 0);
    const interval = window.setInterval(refresh, 30_000);
    return () => { window.clearTimeout(timer); window.clearInterval(interval); };
  }, [refresh]);
  return { stats: result?.stats, branches: result?.branches || [], error, refresh };
}
export function useSubscribeOrders(enabled: boolean) {
  const [orders, setOrders] = useState<SubscribeOrderView[]>([]);
  const [error, setError] = useState("");
  const refresh = useCallback(() => {
    if (!enabled) { setOrders([]); return; }
    void fetchSubscribeOrders().then(setOrders, cause => setError(cause instanceof Error ? cause.message : "认购记录暂时无法读取"));
  }, [enabled]);
  useEffect(() => {
    const timer = window.setTimeout(refresh, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  return { orders, error, refresh };
}
