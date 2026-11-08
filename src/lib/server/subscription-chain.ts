import "server-only";
import { createPublicClient, decodeEventLog, decodeFunctionData, erc20Abi, fallback, getAddress, http, parseUnits, type Address, type Hash } from "viem";
import { appChain, chainConfig, chainConfigurationValid, contracts } from "../chain-config";
import { HARD_CAP, MAX_SHARES, MIN_SHARES, SOFT_CAP, SUBSCRIPTION_PRICE_TIERS, TOKENS_PER_SHARE, subscriptionUnitPrice } from "../constants";
import { normalizePayee, readOperationalSettings, paymentStartBlock } from "./admin-db";
import { AdminRequestError } from "./admin-session";
import { globalSold, purchasedOf } from "./subscription-db";

const client = createPublicClient({ chain: appChain, transport: fallback(chainConfig.rpcUrls.map(url => http(url, { timeout: 10_000, retryCount: 0 })), { retryCount: 0 }) });
const cache = globalThis as typeof globalThis & { cabiSubscribeChainCache?: { key: string; expiresAt: number; decimals: number } };

async function usdtDecimals(): Promise<number> {
  const usdt = contracts.usdt;
  if (!usdt) throw new AdminRequestError("USDT 地址尚未配置", 503);
  const key = usdt.toLowerCase();
  const hit = cache.cabiSubscribeChainCache;
  if (hit && hit.key === key && hit.expiresAt > Date.now()) return hit.decimals;
  const decimals = await client.readContract({ address: usdt, abi: erc20Abi, functionName: "decimals" });
  cache.cabiSubscribeChainCache = { key, expiresAt: Date.now() + 60_000, decimals };
  return decimals;
}

export interface SubscribeConfig {
  configured: boolean; enabled: boolean; locked: boolean; message?: string;
  payee?: Address; usdt?: Address; token?: Address; chainId: number;
  unitPrice: number; priceTiers: readonly { until: number; price: number }[]; tokensPerShare: number; minShares: number; maxShares: number; hardCap: number; softCap: number;
  globalSold: number; remainingGlobal: number; purchased: number; remainingPersonal: number;
  tokenDecimals: number; usdtDecimals: number;
}

export async function readSubscribeConfig(address?: string): Promise<SubscribeConfig> {
  const settings = readOperationalSettings();
  let payee: Address | undefined;
  try { payee = settings.subscribePayee ? getAddress(normalizePayee(settings.subscribePayee)) : undefined; } catch { payee = undefined; }
  const sold = globalSold(), purchased = address ? purchasedOf(address) : 0;
  const hardCap = HARD_CAP, remainingGlobal = Math.max(0, hardCap - sold);
  const remainingPersonal = Math.max(0, MAX_SHARES - purchased);
  let decimals = 18;
  // BSC's official USDT has fixed 18 decimals. Public sale information should
  // not wait for a node; payment verification still checks the live contract.
  const standardUsdt = chainConfig.id === 56 && contracts.usdt?.toLowerCase() === "0x55d398326f99059ff775485246999027b3197955";
  try { if (contracts.usdt && !standardUsdt) decimals = await usdtDecimals(); } catch { /* 提交时重新校验 */ }
  let message: string | undefined;
  if (!chainConfigurationValid) message = "当前网络配置无效";
  else if (!contracts.usdt) message = "等待配置 USDT 地址";
  else if (!contracts.token) message = "等待配置 CaBi 代币地址";
  else if (!payee) message = "认购暂未开放";
  else if (settings.subscribeLocked) message = "认购暂时关闭";
  else if (remainingGlobal <= 0) message = "认购已达硬顶";
  return {
    configured: Boolean(contracts.usdt && contracts.token && payee),
    enabled: Boolean(contracts.usdt && contracts.token && payee && !settings.subscribeLocked && remainingGlobal > 0),
    locked: settings.subscribeLocked,
    ...(message ? { message } : {}),
    ...(payee ? { payee } : {}),
    ...(contracts.usdt ? { usdt: contracts.usdt } : {}),
    ...(contracts.token ? { token: contracts.token } : {}),
    chainId: chainConfig.id, unitPrice: subscriptionUnitPrice(sold), priceTiers: SUBSCRIPTION_PRICE_TIERS, tokensPerShare: TOKENS_PER_SHARE,
    minShares: MIN_SHARES, maxShares: MAX_SHARES, hardCap, softCap: SOFT_CAP,
    globalSold: sold, remainingGlobal, purchased, remainingPersonal,
    tokenDecimals: 18, usdtDecimals: decimals,
  };
}

export function assertSharesAllowed(shares: unknown): number {
  if (!Number.isInteger(shares) || (shares as number) < MIN_SHARES || (shares as number) > MAX_SHARES) throw new AdminRequestError(`认购份数必须为 ${MIN_SHARES}–${MAX_SHARES} 的整数`, 400);
  return shares as number;
}

/**
 * 核验用户确实向后台配置的认购收款地址转过足额 USDT。
 * 与实物兑换核验同口径：交易成功、≥2 确认、from=用户、tx.to=USDT 合约、
 * transfer(to=收款地址, value=应付金额)，且 Transfer 事件一致。
 */
export async function verifySubscriptionTransfer(input: { address: string; hash: unknown; shares: number }) {
  const settings = readOperationalSettings();
  if (!settings.subscribePayee) throw new AdminRequestError("后台尚未设置认购收款地址", 503);
  const payee = getAddress(normalizePayee(settings.subscribePayee));
  const usdt = contracts.usdt;
  if (!usdt) throw new AdminRequestError("USDT 地址尚未配置", 503);
  if (typeof input.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(input.hash)) throw new AdminRequestError("交易哈希无效", 400);
  // Price is resolved again from the current global sold count. The browser's
  // quote is display-only and cannot be used to underpay after a tier changes.
  const currentPrice = subscriptionUnitPrice(globalSold());
  const amount = parseUnits(String(input.shares * currentPrice), await usdtDecimals());
  const hash = input.hash as Hash;
  let receipt;
  try { receipt = await client.getTransactionReceipt({ hash }); }
  catch { throw new AdminRequestError("转账仍待确认，请稍后重试；请勿重复转账", 202); }
  const currentBlock = await client.getBlockNumber({ cacheTime: 0 });
  if (currentBlock < receipt.blockNumber + 1n) throw new AdminRequestError("等待至少两次区块确认，请稍后重试", 202);
  if (receipt.status !== "success") throw new AdminRequestError("转账交易未成功，请勿重复提交", 409);
  if (receipt.blockNumber < paymentStartBlock(chainConfig.id)) throw new AdminRequestError("该付款属于重置前的旧记录，不能计入本次认购", 409);
  const transaction = await client.getTransaction({ hash });
  if (transaction.from.toLowerCase() !== input.address.toLowerCase()) throw new AdminRequestError("转账钱包与当前账户不一致", 400);
  if (transaction.to?.toLowerCase() !== usdt.toLowerCase() || transaction.value !== 0n) throw new AdminRequestError("该交易不是 USDT 转账", 400);
  let decoded;
  try { decoded = decodeFunctionData({ abi: erc20Abi, data: transaction.input }); }
  catch { throw new AdminRequestError("无法解析转账参数", 400); }
  if (decoded.functionName !== "transfer") throw new AdminRequestError("该交易不是 USDT 转账", 400);
  const [to, value] = decoded.args;
  if (to.toLowerCase() !== payee.toLowerCase() || value !== amount) throw new AdminRequestError("转账收款地址或金额与认购份数不一致", 400);
  const matched = receipt.logs.filter(log => log.address.toLowerCase() === usdt.toLowerCase()).some(log => {
    try {
      const event = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
      return event.eventName === "Transfer" && event.args.from.toLowerCase() === input.address.toLowerCase()
        && event.args.to.toLowerCase() === payee.toLowerCase() && event.args.value === amount;
    } catch { return false; }
  });
  if (!matched) throw new AdminRequestError("未找到与认购单一致的转账记录", 400);
  return amount;
}
/** 服务端只做认购转账核验；领取不再需要服务器签名或读取旧领取池状态。 */
