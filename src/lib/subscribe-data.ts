"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { fetchSharedConfig } from "./shared-config-request";

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

export async function fetchSubscribeConfig(address?: string, fresh = false): Promise<SubscribeConfig> {
  let url = address ? `/api/subscribe/config?address=${encodeURIComponent(address)}` : "/api/subscribe/config";
  if (fresh) url += `${url.includes("?") ? "&" : "?"}check=${Date.now()}`;
  return fetchSharedConfig<SubscribeConfig>(url, "认购配置暂时无法读取", false);
}
export async function fetchSubscribeOrders(): Promise<SubscribeOrderView[]> {
  const response = await fetch("/api/subscribe/orders", { cache: "no-store" });
  if (response.status === 401) return [];
  if (!response.ok) throw new Error("认购记录暂时无法读取");
  const body = await response.json() as { orders?: SubscribeOrderView[] };
  return Array.isArray(body.orders) ? body.orders : [];
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
    const sync = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("cabi-operational-settings-updated", sync);
    window.addEventListener("storage", sync);
    return () => {
      cancel(); window.clearInterval(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("cabi-operational-settings-updated", sync);
      window.removeEventListener("storage", sync);
    };
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
  const sequence = useRef(0);
  const refresh = useCallback(() => {
    const request = ++sequence.current;
    if (!enabled) { setResult(undefined); return; }
    void fetchPromotionStats().then(value => { if (request !== sequence.current) return; setResult(value); setError(value ? "" : "请先免费签名登录"); }, cause => { if (request === sequence.current) setError(cause instanceof Error ? cause.message : "推广统计暂时无法读取"); });
  }, [enabled]);
  useEffect(() => {
    sequence.current += 1;
    const timer = window.setTimeout(refresh, 0);
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("cabi-referral-updated", refresh);
    return () => { sequence.current += 1; window.clearTimeout(timer); window.clearInterval(interval); window.removeEventListener("cabi-referral-updated", refresh); };
  }, [refresh]);
  return { stats: result?.stats, branches: result?.branches || [], error, refresh };
}
export function useSubscribeOrders(enabled: boolean) {
  const [orders, setOrders] = useState<SubscribeOrderView[]>([]);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const refresh = useCallback(() => {
    const request = ++sequence.current;
    if (!enabled) { setOrders([]); return; }
    void fetchSubscribeOrders().then(value => { if (request !== sequence.current) return; setOrders(value); setError(""); }, cause => { if (request === sequence.current) setError(cause instanceof Error ? cause.message : "认购记录暂时无法读取"); });
  }, [enabled]);
  useEffect(() => {
    sequence.current += 1;
    const timer = window.setTimeout(refresh, 0);
    window.addEventListener("cabi-referral-updated", refresh);
    return () => { sequence.current += 1; window.clearTimeout(timer); window.removeEventListener("cabi-referral-updated", refresh); };
  }, [refresh]);
  return { orders, error, refresh };
}
