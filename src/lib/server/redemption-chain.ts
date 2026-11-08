import "server-only";
import { createPublicClient, decodeEventLog, decodeFunctionData, erc20Abi, fallback, getAddress, http, parseUnits, type Address, type Hash } from "viem";
import { appChain, chainConfig, chainConfigurationValid, contracts } from "../chain-config";
import { EXCHANGE_COST, MAX_EXCHANGE_PER_TIME } from "../constants";
import type { RedemptionConfig } from "../redemption";
import { normalizePayee, readOperationalSettings, paymentStartBlock } from "./admin-db";
import { AdminRequestError } from "./admin-session";
import { redemptionSecret } from "./redemption-db";

const client = createPublicClient({ chain: appChain, transport: fallback(chainConfig.rpcUrls.map(url => http(url, { timeout: 10_000, retryCount: 0 })), { retryCount: 0 }) });

// 兑换配置由前端每 30 秒轮询，但一次读取要打 2 次 RPC。这里做进程内缓存：
// 命中直接返回；未命中时同一 key 的并发请求共用一次探测；RPC 失败不写入缓存。
const CONFIG_CACHE_DEFAULT_MS = 60_000;
const CONFIG_CACHE_MAX_MS = 300_000;
type CacheableConfig = { config: RedemptionConfig; cacheable: boolean };
type ConfigCache = {
  generation: number;
  entry?: { key: string; config: RedemptionConfig; expiresAt: number };
  inflight: Map<string, Promise<CacheableConfig>>;
};
const configCacheStore = globalThis as typeof globalThis & { cabiRedemptionConfigCache?: ConfigCache };

function configCacheTtlMs() {
  const raw = process.env.REDEMPTION_CONFIG_CACHE_MS?.trim();
  if (!raw) return CONFIG_CACHE_DEFAULT_MS;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 && value <= CONFIG_CACHE_MAX_MS ? value : CONFIG_CACHE_DEFAULT_MS;
}
function configCache(): ConfigCache {
  if (!configCacheStore.cabiRedemptionConfigCache) {
    configCacheStore.cabiRedemptionConfigCache = { generation: 0, inflight: new Map() };
  }
  return configCacheStore.cabiRedemptionConfigCache;
}
// 后台修改收款地址/兑换开关后调用；代币地址属于 NEXT_PUBLIC_ 构建期常量，不会在运行中变化。
export function invalidateRedemptionConfigCache() {
  const cache = configCache();
  cache.generation += 1;
  cache.entry = undefined;
  cache.inflight.clear();
}

function buildBaseConfig(settings: ReturnType<typeof readOperationalSettings>, payee: Address | undefined, token: Address | undefined): RedemptionConfig {
  return {
    configured: false,
    enabled: false,
    exchangeEnabled: settings.exchangeEnabled,
    chainId: chainConfig.id,
    unitPrice: parseUnits(String(EXCHANGE_COST), 18).toString(),
    maxPerTransaction: MAX_EXCHANGE_PER_TIME,
    ...(token ? { token } : {}),
    ...(payee ? { payee } : {}),
  };
}

async function probeConfig(base: RedemptionConfig, settings: ReturnType<typeof readOperationalSettings>, token: Address | undefined, payee: Address | undefined): Promise<CacheableConfig> {
  if (!chainConfigurationValid) return { config: { ...base, message: "当前网络配置无效" }, cacheable: true };
  if (!token) return { config: { ...base, message: "等待配置正式代币地址" }, cacheable: true };
  if (!payee) return { config: { ...base, message: "等待后台设置兑换收款地址" }, cacheable: true };
  try {
    redemptionSecret();
    if (await client.getChainId() !== chainConfig.id) return { config: { ...base, message: "RPC 网络配置不一致" }, cacheable: false };
    const decimals = await client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" });
    if (decimals !== 18) return { config: { ...base, message: "代币精度不是 18 位，暂不支持实物兑换" }, cacheable: true };
    if (!settings.exchangeEnabled) return { config: { ...base, configured: true, message: "兑换暂时关闭" }, cacheable: true };
    return { config: { ...base, configured: true, enabled: true, tokenDecimals: decimals }, cacheable: true };
  } catch {
    return { config: { ...base, message: "链上服务暂不可用，请稍后重试" }, cacheable: false };
  }
}

export type RedemptionConfigSnapshot = { config: RedemptionConfig; cache: "hit" | "miss" };

// 实物兑换没有兑换合约：配置只依赖「代币地址 + 后台收款地址 + 订单加密密钥」。
export async function readRedemptionConfigSnapshot(): Promise<RedemptionConfigSnapshot> {
  const settings = readOperationalSettings();
  let payee: Address | undefined;
  try { payee = getAddress(normalizePayee(settings.exchangePayee)) as Address; } catch { payee = undefined; }
  const token = contracts.token;
  const base = buildBaseConfig(settings, payee, token);
  const key = [chainConfig.id, token ?? "unconfigured", payee ?? "unconfigured", settings.exchangeEnabled ? 1 : 0].join(":");
  const ttl = configCacheTtlMs();
  const cache = configCache();
  if (ttl > 0 && cache.entry && cache.entry.key === key && cache.entry.expiresAt > Date.now()) {
    return { config: cache.entry.config, cache: "hit" };
  }
  const generation = cache.generation;
  let pending = cache.inflight.get(key);
  if (!pending) {
    const created = probeConfig(base, settings, token, payee).then(result => {
      if (result.cacheable && ttl > 0 && cache.generation === generation) {
        cache.entry = { key, config: result.config, expiresAt: Date.now() + ttl };
      }
      return result;
    });
    cache.inflight.set(key, created);
    void created.finally(() => {
      if (cache.inflight.get(key) === created) cache.inflight.delete(key);
    }).catch(() => { /* probeConfig 已收敛异常，此处只兜底避免未处理的 rejection */ });
    pending = created;
  }
  const result = await pending;
  return { config: result.config, cache: "miss" };
}

export async function readRedemptionConfig(): Promise<RedemptionConfig> {
  return (await readRedemptionConfigSnapshot()).config;
}

// 核验用户确实向指定收款地址转过足额代币。
// 校验项：交易成功、发送方 = 用户、调用对象 = 代币合约、Transfer 事件 from/to/value 与订单一致。
export async function verifyRedemptionTransfer(input: { address: string; hash: unknown; payee: string; amount: bigint }) {
  const { address, hash: hashInput, payee, amount } = input;
  if (typeof hashInput !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hashInput)) throw new AdminRequestError("交易哈希无效", 400);
  const token = contracts.token;
  if (!token) throw new AdminRequestError("代币地址尚未配置", 503);
  const hash = hashInput as Hash;
  let receipt;
  try { receipt = await client.getTransactionReceipt({ hash }); }
  catch { throw new AdminRequestError("转账仍待确认，请稍后重试；请勿重复转账", 202); }
  const currentBlock = await client.getBlockNumber({ cacheTime: 0 });
  if (currentBlock < receipt.blockNumber + 1n) throw new AdminRequestError("等待至少两次区块确认，请稍后重试", 202);
  if (receipt.status !== "success") throw new AdminRequestError("转账交易未成功，请勿重复提交", 409);
  if (receipt.blockNumber < paymentStartBlock(chainConfig.id)) throw new AdminRequestError("该付款属于重置前的旧记录，不能用于本次兑换", 409);
  const transaction = await client.getTransaction({ hash });
  if (transaction.from.toLowerCase() !== address.toLowerCase()) throw new AdminRequestError("转账钱包与当前账户不一致", 400);
  if (transaction.to?.toLowerCase() !== token.toLowerCase() || transaction.value !== 0n) throw new AdminRequestError("该交易不是代币转账", 400);
  let decoded;
  try { decoded = decodeFunctionData({ abi: erc20Abi, data: transaction.input }); }
  catch { throw new AdminRequestError("无法解析转账参数", 400); }
  if (decoded.functionName !== "transfer") throw new AdminRequestError("该交易不是代币转账", 400);
  const [to, value] = decoded.args;
  if (to.toLowerCase() !== payee.toLowerCase() || value !== amount) throw new AdminRequestError("转账收款地址或金额与兑换单不一致", 400);
  const matched = receipt.logs.filter(log => log.address.toLowerCase() === token.toLowerCase()).some(log => {
    try {
      const event = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
      return event.eventName === "Transfer" && event.args.from.toLowerCase() === address.toLowerCase()
        && event.args.to.toLowerCase() === payee.toLowerCase() && event.args.value === amount;
    } catch { return false; }
  });
  if (!matched) throw new AdminRequestError("未找到与兑换单一致的转账记录", 400);
  return hash;
}
