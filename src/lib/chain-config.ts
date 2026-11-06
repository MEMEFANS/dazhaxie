import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { bsc, bscTestnet } from "viem/chains";

export const CHAIN_PRESETS = {
  56: {
    id: 56,
    name: "BNB Smart Chain",
    shortName: "BSC 主网",
    isTestnet: false,
    rpcUrls: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org"],
    explorerUrl: "https://bscscan.com",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  },
  97: {
    id: 97,
    name: "BNB Smart Chain Testnet",
    shortName: "BSC 测试网",
    isTestnet: true,
    rpcUrls: ["https://bsc-testnet-rpc.publicnode.com", "https://bsc-testnet-dataseed.bnbchain.org"],
    explorerUrl: "https://testnet.bscscan.com",
    nativeCurrency: { name: "Test BNB", symbol: "tBNB", decimals: 18 },
  },
} as const;

export const configIssues: string[] = [];
const configuredChainId = process.env.NEXT_PUBLIC_CHAIN_ID?.trim() || "56";
export const chainConfigurationValid = configuredChainId === "56" || configuredChainId === "97";
if (!chainConfigurationValid) configIssues.push("NEXT_PUBLIC_CHAIN_ID 仅支持 BSC 主网 56 或测试网 97。");
const chainId = configuredChainId === "97" ? 97 : 56;
const preset = CHAIN_PRESETS[chainId];
const customRpc = process.env.NEXT_PUBLIC_RPC_URL?.trim();
let rpcOverride: string | undefined;
if (customRpc) {
  try {
    const url = new URL(customRpc);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
    rpcOverride = url.toString();
  } catch {
    configIssues.push("NEXT_PUBLIC_RPC_URL 必须是有效的 HTTP 或 HTTPS RPC 地址。");
  }
}

export const chainConfig = {
  ...preset,
  rpcUrls: Array.from(new Set([...(rpcOverride ? [rpcOverride] : []), ...preset.rpcUrls])),
};
export const appChain = chainId === 97 ? bscTestnet : bsc;

function contractAddress(value: string | undefined, label: string): Address | undefined {
  const address = value?.trim();
  if (!address) return undefined;
  if (!isAddress(address, { strict: false }) || address.toLowerCase() === zeroAddress) {
    configIssues.push(`${label} 未填写有效的非零合约地址。`);
    return undefined;
  }
  return getAddress(address.toLowerCase());
}

// These are public deployment addresses. No private key is read by this module.
// Leave absent contracts unconfigured rather than substituting a historical deployment.
export const contracts = {
  token: contractAddress(process.env.NEXT_PUBLIC_TOKEN_ADDRESS, "NEXT_PUBLIC_TOKEN_ADDRESS"),
  gateway: contractAddress(process.env.NEXT_PUBLIC_GATEWAY_ADDRESS, "NEXT_PUBLIC_GATEWAY_ADDRESS"),
  usdt: contractAddress(process.env.NEXT_PUBLIC_USDT_ADDRESS, "NEXT_PUBLIC_USDT_ADDRESS"),
  claimPool: contractAddress(process.env.NEXT_PUBLIC_CLAIM_POOL_ADDRESS, "NEXT_PUBLIC_CLAIM_POOL_ADDRESS"),
  rewardPool: contractAddress(process.env.NEXT_PUBLIC_REWARD_POOL_ADDRESS, "NEXT_PUBLIC_REWARD_POOL_ADDRESS"),
};

// Pancake mode uses the token's transfer-tax implementation, without a gateway.
export const tradingMode = process.env.NEXT_PUBLIC_TRADING_MODE === "gateway" ? "gateway" : "pancake";
export const tokenLaunchMode = process.env.NEXT_PUBLIC_TOKEN_LAUNCH_MODE === "staged";
export function getSwapUrl(): string | undefined {
  if (tradingMode !== "pancake" || !contracts.token || chainConfig.isTestnet) return undefined;
  const configured = process.env.NEXT_PUBLIC_SWAP_URL?.trim();
  try {
    const url = new URL(configured || "https://pancakeswap.finance/swap");
    if (url.protocol !== "https:" || !["pancakeswap.finance", "www.pancakeswap.finance"].includes(url.hostname) || url.username || url.password) return undefined;
    url.searchParams.set("chain", "bsc");
    url.searchParams.set("outputCurrency", contracts.token);
    if (contracts.usdt) url.searchParams.set("inputCurrency", contracts.usdt);
    return url.toString();
  } catch { return undefined; }
}

export function getExplorerAddressUrl(address: string): string {
  return isAddress(address, { strict: false }) ? `${chainConfig.explorerUrl}/address/${getAddress(address.toLowerCase())}` : "";
}

export function getExplorerTxUrl(hash: string): string {
  return /^0x[0-9a-fA-F]{64}$/.test(hash) ? `${chainConfig.explorerUrl}/tx/${hash}` : "";
}
