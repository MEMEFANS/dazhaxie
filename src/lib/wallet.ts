"use client";

// 真实钱包连接器（移植自 AXIX wallet-connector.js）：
// 只负责连接/恢复/断开、链切换、连接状态订阅，走 EIP-1193 注入钱包（window.ethereum）。
// 本模块不内置任何签名/授权逻辑。

import { CHAIN_PRESETS } from "./chain-config";

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isBraveWallet?: boolean;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export interface WalletConnection {
  address: string;
  label: string;
  provider: Eip1193Provider;
  chainId: number;
}

type Listener = (conn: WalletConnection | null) => void;

const listeners = new Set<Listener>();
let currentProvider: Eip1193Provider | null = null;
let currentAddress = "";
let currentChainId = 0;
let lastEmittedAddress: string | null = null;
let accountRevision = 0;
let chainRevision = 0;

function requestWithTimeout(provider: Eip1193Provider, args: { method: string; params?: unknown[] }, timeoutMs: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    provider.request(args),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("钱包确认超时，请检查钱包扩展后重试")), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function providerLabel(provider: Eip1193Provider | null): string {
  if (provider?.isMetaMask) return "MetaMask";
  if (provider?.isCoinbaseWallet) return "Coinbase Wallet";
  if (provider?.isBraveWallet) return "Brave Wallet";
  return "浏览器钱包";
}

function injectedProvider(): Eip1193Provider | null {
  const provider = typeof window !== "undefined" ? window.ethereum : undefined;
  return provider?.request ? provider : null;
}

function connection(): WalletConnection | null {
  return currentProvider && currentAddress
    ? {
        address: currentAddress,
        label: providerLabel(currentProvider),
        provider: currentProvider,
        chainId: currentChainId,
      }
    : null;
}

function emit() {
  const key = `${currentAddress.toLowerCase()}:${currentChainId}`;
  if (key === lastEmittedAddress) return;
  lastEmittedAddress = key;
  const value = connection();
  listeners.forEach((listener) => listener(value));
}

function setAddress(address: string) {
  ++accountRevision;
  currentAddress = String(address || "");
  emit();
}

function handleAccountsChanged(accounts: unknown) {
  setAddress(Array.isArray(accounts) ? (accounts[0] as string) : "");
}

function handleDisconnect() {
  ++chainRevision;
  currentChainId = 0;
  setAddress("");
}

function parseChainId(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new Error("钱包返回了无效的网络 ID");
  }
  const id = Number(BigInt(value));
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("钱包返回了无效的网络 ID");
  return id;
}

function handleChainChanged(value: unknown) {
  ++chainRevision;
  try { currentChainId = parseChainId(value); }
  catch { currentChainId = 0; }
  emit();
}

async function readChainId(provider: Eip1193Provider): Promise<number> {
  return parseChainId(await requestWithTimeout(provider, { method: "eth_chainId" }, 5000));
}

function bindProvider(provider: Eip1193Provider | null) {
  if (currentProvider === provider) return;
  if (currentProvider?.removeListener) {
    currentProvider.removeListener("accountsChanged", handleAccountsChanged);
    currentProvider.removeListener("disconnect", handleDisconnect);
    currentProvider.removeListener("chainChanged", handleChainChanged);
  }
  currentProvider = provider;
  currentChainId = 0;
  ++chainRevision;
  lastEmittedAddress = null;
  provider?.on?.("accountsChanged", handleAccountsChanged);
  provider?.on?.("disconnect", handleDisconnect);
  provider?.on?.("chainChanged", handleChainChanged);
}

/** 主动连接：拉起钱包扩展请求授权（eth_requestAccounts） */
export async function connect(): Promise<WalletConnection> {
  const provider = injectedProvider();
  if (!provider) throw new Error("未检测到浏览器钱包，请先安装或启用钱包扩展（如 MetaMask）");
  bindProvider(provider);
  const accounts = (await requestWithTimeout(provider, { method: "eth_requestAccounts" }, 60000)) as string[];
  const revision = chainRevision;
  const addressRevision = accountRevision;
  const chainId = await readChainId(provider).catch(() => 0);
  if (provider !== currentProvider) throw new Error("钱包连接已变更，请重试");
  if (provider === currentProvider && revision === chainRevision) currentChainId = chainId;
  if (addressRevision === accountRevision) setAddress(Array.isArray(accounts) ? accounts[0] : "");
  if (!currentAddress) throw new Error("钱包未返回可用账户");
  return connection()!;
}

/** 静默恢复：页面刷新后尝试恢复已授权账户（eth_accounts，不弹窗） */
export async function restore(): Promise<WalletConnection | null> {
  const provider = injectedProvider();
  if (!provider) return null;
  bindProvider(provider);
  const revision = accountRevision;
  const networkRevision = chainRevision;
  const [accounts, chainId] = await Promise.all([
    requestWithTimeout(provider, { method: "eth_accounts" }, 1200).catch(() => null) as Promise<string[] | null>,
    requestWithTimeout(provider, { method: "eth_chainId" }, 1200).then(parseChainId).catch(() => 0),
  ]);
  if (!accounts || revision !== accountRevision || provider !== currentProvider) return connection();
  if (networkRevision === chainRevision) currentChainId = chainId;
  setAddress(Array.isArray(accounts) ? accounts[0] : "");
  return connection();
}

/** 本地断开（钱包侧授权保留，下次连接不再弹窗） */
export async function disconnect(): Promise<void> {
  setAddress("");
  bindProvider(null);
}

/** 读取当前链 ID */
export async function getChainId(): Promise<number> {
  const value = connection();
  if (!value) throw new Error("请先连接钱包");
  const revision = chainRevision;
  const id = await readChainId(value.provider);
  if (value.provider !== currentProvider) throw new Error("钱包连接已变更，请重试");
  if (revision !== chainRevision) {
    if (!currentChainId) throw new Error("钱包网络已变更，请重试");
    return currentChainId;
  }
  currentChainId = id;
  emit();
  return id;
}

const CHAIN_DEFAULTS: Record<number, {
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorerUrls: string[];
}> = {
  56: { chainName: CHAIN_PRESETS[56].name, rpcUrls: [...CHAIN_PRESETS[56].rpcUrls], nativeCurrency: CHAIN_PRESETS[56].nativeCurrency, blockExplorerUrls: [CHAIN_PRESETS[56].explorerUrl] },
  97: { chainName: CHAIN_PRESETS[97].name, rpcUrls: [...CHAIN_PRESETS[97].rpcUrls], nativeCurrency: CHAIN_PRESETS[97].nativeCurrency, blockExplorerUrls: [CHAIN_PRESETS[97].explorerUrl] },
};

function toHex(num: number | bigint): string {
  if (typeof num === "bigint") return `0x${num.toString(16)}`;
  const n = Number(num);
  if (!Number.isFinite(n)) throw new Error("无效的 chainId");
  return `0x${n.toString(16)}`;
}

/** 切换链：先探测当前链，失败后 switch，未添加(4902 等)自动 addChain 再切（BSC 预置） */
export async function switchChain(targetChainId: number, options: Partial<{ chainName: string; rpcUrls: string[]; nativeCurrency: { name: string; symbol: string; decimals: number }; blockExplorerUrls: string[] }> = {}): Promise<number> {
  const value = connection();
  if (!value) throw new Error("请先连接钱包");
  const id = Number(targetChainId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("目标链 ID 无效");
  const chainIdHex = toHex(id);
  const preset = CHAIN_DEFAULTS[id] || {};
  const chainName = options.chainName || preset.chainName || `Chain ${id}`;
  const rpcUrls = (Array.isArray(options.rpcUrls) && options.rpcUrls.length ? options.rpcUrls : preset.rpcUrls) || [];
  const nativeCurrency = options.nativeCurrency || preset.nativeCurrency || { name: "ETH", symbol: "ETH", decimals: 18 };
  const blockExplorerUrls = (Array.isArray(options.blockExplorerUrls) && options.blockExplorerUrls.length ? options.blockExplorerUrls : preset.blockExplorerUrls) || [];
  const confirmNetwork = (confirmedId: number): number => {
    if (value.provider !== currentProvider || !currentAddress) throw new Error("钱包连接已变更，请重试");
    if (confirmedId !== id) throw new Error(`尚未切换至 ${chainName}，请在钱包中确认网络`);
    if (currentChainId !== confirmedId) {
      ++chainRevision;
      currentChainId = confirmedId;
      emit();
    }
    return confirmedId;
  };
  // 移动端钱包大多已在 BSC：签名前避免多余的切换弹窗
  try {
    if (parseChainId(await requestWithTimeout(value.provider, { method: "eth_chainId" }, 1500)) === id) return confirmNetwork(id);
  } catch {
    // 探测失败则走正常切换流程
  }
  if (value.provider !== currentProvider || !currentAddress) throw new Error("钱包连接已变更，请重试");
  try {
    await value.provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
    // 部分钱包异步更新 chainId，稍等再读
    for (let i = 0; i < 10; i++) {
      try {
        const current = await readChainId(value.provider);
        if (current === id) return confirmNetwork(current);
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    return confirmNetwork(await readChainId(value.provider));
  } catch (err) {
    // code=4902 表示 MetaMask 尚未添加该网络；-32603 是某些钱包通用内部错误，也尝试 addChain
    const code = Number((err as { code?: number })?.code ?? 0);
    const msg = String((err as Error)?.message || "").toLowerCase();
    if (code === 4902 || code === -32603 || msg.includes("unrecognized") || msg.includes("was not found") || msg.includes("add ethereum chain")) {
      if (!rpcUrls.length) throw new Error(`钱包未添加 ${chainName}，且未提供 RPC URL 以供自动添加`);
      const addParams = [{
        chainId: chainIdHex,
        chainName,
        rpcUrls,
        nativeCurrency,
        blockExplorerUrls,
      }];
      try {
        await value.provider.request({ method: "wallet_addEthereumChain", params: addParams });
      } catch (addErr) {
        throw new Error(`添加 ${chainName} 失败：${(addErr as Error)?.message || String(addErr)}`);
      }
      // 添加成功后，部分钱包会自动切，有些需要再调一次 switch
      for (let i = 0; i < 10; i++) {
        try {
          const current = await readChainId(value.provider);
          if (current === id) return confirmNetwork(current);
        } catch {}
        try {
          await value.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
        } catch {}
        await new Promise((r) => setTimeout(r, 250));
      }
      const current = await readChainId(value.provider);
      if (current !== id) throw new Error(`已添加 ${chainName} 但仍未切换，请手动切换`);
      return confirmNetwork(current);
    }
    throw err;
  }
}

export function getConnection(): WalletConnection | null {
  return connection();
}

/** 订阅连接状态变化（账户、网络切换 / 扩展内断开） */
export function onChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function destroy(): void {
  setAddress("");
  bindProvider(null);
}
