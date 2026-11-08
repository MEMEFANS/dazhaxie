"use client";

import { createPublicClient, erc20Abi, fallback, http, parseAbi, zeroAddress } from "viem";
import { appChain, chainConfig, chainConfigurationValid, contracts } from "./chain-config";

export const SEED_TOKEN_AMOUNT = 70_000n * 10n ** 18n;
export const seedPoolAbi = parseAbi([
  "function token() view returns(address)", "function usdt() view returns(address)",
  "function tradingPair() view returns(address)", "function seedProvider() view returns(address)",
  "function setSeedProvider(address provider)",
  "function previewSeed(uint256 tokenAmount) view returns(uint256 usdtRequired,uint256 estimatedLiquidity)",
  "function seedLiquidity(uint256 tokenAmount,uint256 usdtAmount,uint256 minLiquidity,uint256 deadline)",
]);
const tokenAbi = parseAbi([
  "function owner() view returns(address)", "function launchPool() view returns(address)",
  "function liquidityEnabled() view returns(bool)", "function isTradingOpen() view returns(bool)",
  "function tradingPair() view returns(address)",
]);
const pairAbi = parseAbi(["function token0() view returns(address)", "function token1() view returns(address)"]);
const client = createPublicClient({ chain: appChain, transport: fallback(chainConfig.rpcUrls.map(url => http(url, {timeout: 10_000, retryCount: 0, batch: { wait: 12, batchSize: 30 } })), { retryCount: 0 }) });
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export async function fetchSeedLiquidityData() {
  const token = contracts.token, pool = contracts.claimPool, usdt = contracts.usdt;
  if (!token || !pool || !usdt) throw new Error("新合约尚未配置，请等待部署完成。");
  if (!chainConfigurationValid || await client.getChainId() !== chainConfig.id) throw new Error("网络与项目配置不一致。");
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const p = { address: pool, abi: seedPoolAbi, blockNumber }, t = { address: token, abi: tokenAbi, blockNumber };
  const [actualToken, actualUsdt, pair, seedProvider, owner, launchPool, liquidityEnabled, tradingOpen, tokenPair, decimals, block] = await Promise.all([
    client.readContract({ ...p, functionName: "token" }), client.readContract({ ...p, functionName: "usdt" }),
    client.readContract({ ...p, functionName: "tradingPair" }), client.readContract({ ...p, functionName: "seedProvider" }),
    client.readContract({ ...t, functionName: "owner" }), client.readContract({ ...t, functionName: "launchPool" }),
    client.readContract({ ...t, functionName: "liquidityEnabled" }), client.readContract({ ...t, functionName: "isTradingOpen" }),
    client.readContract({ ...t, functionName: "tradingPair" }),
    client.readContract({ address: usdt, abi: erc20Abi, functionName: "decimals", blockNumber }), client.getBlock({ blockNumber }),
  ]);
  if (!same(actualToken, token) || !same(actualUsdt, usdt) || !same(launchPool, pool) || !same(pair, tokenPair) || pair === zeroAddress || decimals > 18) throw new Error("新池与网站配置不一致，请联系管理员核对。");
  const [first, second, supply, tokenBalance, usdtBalance, tokenAllowance, usdtAllowance, lpBalance, ownerTokenBalance] = await Promise.all([
    client.readContract({ address: pair, abi: pairAbi, functionName: "token0", blockNumber }),
    client.readContract({ address: pair, abi: pairAbi, functionName: "token1", blockNumber }),
    client.readContract({ address: pair, abi: erc20Abi, functionName: "totalSupply", blockNumber }),
    ...([token, usdt] as const).map(address => seedProvider !== zeroAddress ? client.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [seedProvider], blockNumber }) : 0n),
    ...([token, usdt] as const).map(address => seedProvider !== zeroAddress ? client.readContract({ address, abi: erc20Abi, functionName: "allowance", args: [seedProvider, pool], blockNumber }) : 0n),
    seedProvider !== zeroAddress ? client.readContract({ address: pair, abi: erc20Abi, functionName: "balanceOf", args: [seedProvider], blockNumber }) : 0n,
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner], blockNumber }),
  ]);
  if (!((same(first, token) && same(second, usdt)) || (same(first, usdt) && same(second, token)))) throw new Error("交易对资产不匹配。");
  const usdtAmount = 100n * 10n ** BigInt(decimals);
  const preview = supply === 0n ? await client.readContract({ ...p, functionName: "previewSeed", args: [SEED_TOKEN_AMOUNT] }) : [usdtAmount, 0n] as const;
  if (preview[0] !== usdtAmount || (supply === 0n && preview[1] === 0n)) throw new Error("初始加池比例尚未就绪。");
  return { token, pool, usdt, pair, owner, seedProvider, liquidityEnabled, tradingOpen, decimals, seeded: supply > 0n,
    tokenBalance, usdtBalance, tokenAllowance, usdtAllowance, lpBalance, ownerTokenBalance,
    tokenAmount: SEED_TOKEN_AMOUNT, usdtAmount, minimumLp: preview[1] * 99n / 100n, now: block.timestamp };
}

export type SeedLiquidityData = Awaited<ReturnType<typeof fetchSeedLiquidityData>>;
