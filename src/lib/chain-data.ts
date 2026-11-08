"use client";

import { useMemo, useSyncExternalStore } from "react";
import { createPublicClient, fallback, getAddress, http, isAddress, parseAbi, type Address } from "viem";
import { appChain, chainConfig, chainConfigurationValid, contracts, tradingMode } from "./chain-config";

export const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function owner() view returns (address)",
  "function maxWalletAmount() view returns (uint256)",
  "function walletLimitEnabled() pure returns (bool)",
  "function isMaxWalletExempt(address) view returns (bool)",
  "function tradingGateway() view returns (address)",
  "function setMaxWalletAmount(uint256)",
  "function setMaxWalletExempt(address,bool)",
]);

export const gatewayAbi = parseAbi([
  "function owner() view returns (address)",
  "function token() view returns (address)",
  "function usdt() view returns (address)",
  "function pair() view returns (address)",
  "function dividendReceiver1() view returns (address)",
  "function dividendReceiver2() view returns (address)",
  "function dividendRate1Bps() view returns (uint256)",
  "function dividendRate2Bps() view returns (uint256)",
  "function setDividendReceivers(address,address)",
  "function setDividendRates(uint256,uint256)",
  "function transferOwnership(address)",
]);

const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const POLL_MS = 30_000;
class ChainReadError extends Error {}

export interface TokenData {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  maxWalletAmount: bigint;
  walletLimitEnabled?: boolean;
  owner: Address;
  burned: bigint;
  balance?: bigint;
  isExempt?: boolean;
}

export interface GatewayData {
  owner: Address;
  token: Address;
  usdt: Address;
  pair: Address;
  receiver1: Address;
  receiver2: Address;
  rate1Bps: bigint;
  rate2Bps: bigint;
}

export type ChainDataStatus = "unconfigured" | "loading" | "ready" | "error";
type Snapshot<T> = {
  status: ChainDataStatus;
  data?: T;
  error?: string;
  updatedAt?: number;
};
export type ChainDataResult<T> = Snapshot<T> & { refresh: () => void };

const client = createPublicClient({
  chain: appChain,
  transport: fallback(chainConfig.rpcUrls.map(url => http(url, { timeout: 8_000, retryCount: 0 })), {
    rank: false,
    retryCount: 0,
  }),
});

async function checkedBlock(address: Address) {
  if (!chainConfigurationValid) throw new ChainReadError("网络配置无效，请检查应用的链 ID。");
  if (await client.getChainId() !== chainConfig.id) throw new ChainReadError("RPC 网络与应用配置不一致，请更换节点后重试。");
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const code = await client.getCode({ address, blockNumber });
  if (!code || code === "0x") throw new ChainReadError(`当前 ${chainConfig.shortName} 上未找到配置的合约。`);
  return blockNumber;
}

async function loadTokenData(account?: Address): Promise<TokenData> {
  if (!contracts.token) throw new ChainReadError("代币合约尚未配置。");
  const blockNumber = await checkedBlock(contracts.token);
  const contract = { address: contracts.token, abi: tokenAbi, blockNumber };
  const [name, symbol, decimals, totalSupply, maxWalletAmount, owner, burned, balance, isExempt, walletLimitEnabled] = await Promise.all([
    client.readContract({ ...contract, functionName: "name" }),
    client.readContract({ ...contract, functionName: "symbol" }),
    client.readContract({ ...contract, functionName: "decimals" }),
    client.readContract({ ...contract, functionName: "totalSupply" }),
    client.readContract({ ...contract, functionName: "maxWalletAmount" }),
    client.readContract({ ...contract, functionName: "owner" }),
    client.readContract({ ...contract, functionName: "balanceOf", args: [BURN_ADDRESS] }),
    account ? client.readContract({ ...contract, functionName: "balanceOf", args: [account] }) : undefined,
    account ? client.readContract({ ...contract, functionName: "isMaxWalletExempt", args: [account] }) : undefined,
    // Historical deployments do not expose this immutable capability flag.
    client.readContract({ ...contract, functionName: "walletLimitEnabled" }).catch(() => undefined),
  ]);
  return { name, symbol, decimals, totalSupply, maxWalletAmount, owner, burned, balance, isExempt, walletLimitEnabled };
}

async function loadGatewayData(): Promise<GatewayData> {
  if (!contracts.gateway) throw new ChainReadError("交易网关尚未配置。");
  const blockNumber = await checkedBlock(contracts.gateway);
  const contract = { address: contracts.gateway, abi: gatewayAbi, blockNumber };
  const [owner, token, usdt, pair, receiver1, receiver2, rate1Bps, rate2Bps] = await Promise.all([
    client.readContract({ ...contract, functionName: "owner" }),
    client.readContract({ ...contract, functionName: "token" }),
    client.readContract({ ...contract, functionName: "usdt" }),
    client.readContract({ ...contract, functionName: "pair" }),
    client.readContract({ ...contract, functionName: "dividendReceiver1" }),
    client.readContract({ ...contract, functionName: "dividendReceiver2" }),
    client.readContract({ ...contract, functionName: "dividendRate1Bps" }),
    client.readContract({ ...contract, functionName: "dividendRate2Bps" }),
  ]);
  if (contracts.token && token.toLowerCase() !== contracts.token.toLowerCase()) {
    throw new ChainReadError("交易网关的代币地址与应用配置不一致。");
  }
  if (contracts.usdt && usdt.toLowerCase() !== contracts.usdt.toLowerCase()) {
    throw new ChainReadError("交易网关的 USDT 地址与应用配置不一致。");
  }
  if (rate1Bps + rate2Bps !== BigInt(300)) throw new ChainReadError("交易网关返回了不一致的买入分账比例。");
  return { owner, token, usdt, pair, receiver1, receiver2, rate1Bps, rate2Bps };
}

type Listener = () => void;
type Entry<T> = {
  snapshot: Snapshot<T>;
  initial: Snapshot<T>;
  listeners: Set<Listener>;
  loading: boolean;
  timer?: ReturnType<typeof setInterval>;
  load: () => Promise<T>;
  refresh: () => void;
  subscribe: (listener: Listener) => () => void;
};
const tokenEntries = new Map<string, Entry<TokenData>>();
const gatewayEntries = new Map<string, Entry<GatewayData>>();

function makeEntry<T>(configured: boolean, load: () => Promise<T>, invalidAccount = false): Entry<T> {
  const initial: Snapshot<T> = invalidAccount
    ? { status: "error", error: "钱包地址无效，请重新连接钱包。" }
    : { status: configured ? "loading" : "unconfigured" };
  const entry: Entry<T> = {
    snapshot: initial,
    initial,
    listeners: new Set(),
    loading: false,
    load,
    refresh: () => {},
    subscribe: () => () => {},
  };
  const publish = (snapshot: Snapshot<T>) => {
    entry.snapshot = snapshot;
    entry.listeners.forEach(listener => listener());
  };
  entry.refresh = () => {
    if (!configured || invalidAccount || entry.loading) return;
    entry.loading = true;
    publish({ status: "loading", updatedAt: entry.snapshot.updatedAt });
    void load().then(
      data => publish({ status: "ready", data, updatedAt: Date.now() }),
      error => publish({
        status: "error",
        error: error instanceof ChainReadError ? error.message : "链上查询暂时失败，请检查网络后重试。",
        updatedAt: entry.snapshot.updatedAt,
      }),
    ).finally(() => { entry.loading = false; });
  };
  entry.subscribe = listener => {
    entry.listeners.add(listener);
    if (entry.listeners.size === 1 && configured && !invalidAccount) {
      const age = entry.snapshot.updatedAt ? Date.now() - entry.snapshot.updatedAt : Infinity;
      if (age >= POLL_MS || entry.snapshot.status !== "ready") entry.refresh();
      entry.timer = setInterval(entry.refresh, POLL_MS);
      if (typeof window !== "undefined") window.addEventListener("cabi-chain-updated", entry.refresh);
    }
    return () => {
      entry.listeners.delete(listener);
      if (!entry.listeners.size && entry.timer) {
        clearInterval(entry.timer);
        entry.timer = undefined;
        if (typeof window !== "undefined") window.removeEventListener("cabi-chain-updated", entry.refresh);
      }
    };
  };
  return entry;
}

function tokenEntry(address?: string): Entry<TokenData> {
  const validAccount = !address || isAddress(address, { strict: false });
  const account = address && validAccount ? getAddress(address.toLowerCase()) : undefined;
  const key = `${chainConfig.id}:${contracts.token ?? "unconfigured"}:${address?.toLowerCase() ?? "public"}`;
  let entry = tokenEntries.get(key);
  if (!entry) {
    entry = makeEntry(Boolean(contracts.token), () => loadTokenData(account), !validAccount);
    tokenEntries.set(key, entry);
  }
  return entry;
}

export function useTokenData(address?: string): ChainDataResult<TokenData> {
  const entry = useMemo(() => tokenEntry(address), [address]);
  const snapshot = useSyncExternalStore(entry.subscribe, () => entry.snapshot, () => entry.initial);
  return { ...snapshot, refresh: entry.refresh };
}

export function useGatewayData(): ChainDataResult<GatewayData> {
  const entry = useMemo(() => {
    const key = `${chainConfig.id}:${contracts.gateway ?? "unconfigured"}`;
    let current = gatewayEntries.get(key);
    if (!current) {
      current = makeEntry(tradingMode === "gateway" && Boolean(contracts.gateway), loadGatewayData);
      gatewayEntries.set(key, current);
    }
    return current;
  }, []);
  const snapshot = useSyncExternalStore(entry.subscribe, () => entry.snapshot, () => entry.initial);
  return { ...snapshot, refresh: entry.refresh };
}
