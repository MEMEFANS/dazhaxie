import "server-only";
import { createPublicClient, fallback, http, parseAbi } from "viem";
import { appChain, chainConfig, chainConfigurationValid, contracts } from "../chain-config";
import type { LiquidityAccessStatus } from "../liquidity-access";
import { readLiquidityAccess } from "./admin-db";
import { AdminRequestError } from "./admin-session";

const client = createPublicClient({ chain: appChain, cacheTime: 0, transport: fallback(chainConfig.rpcUrls.map(url => http(url, { timeout: 8_000, retryCount: 0, batch: { wait: 20 } })), { retryCount: 0 }) });
const tokenAbi = parseAbi([
  "function liquidityEnabled() view returns(bool)", "function isClaimOpen() view returns(bool)", "function isTradingOpen() view returns(bool)",
  "function claimStartsAt() view returns(uint64)", "function tradingStartsAt() view returns(uint64)", "function launchPool() view returns(address)",
]);
const poolAbi = parseAbi(["function token() view returns(address)", "function usdt() view returns(address)"]);
export function liquidityScope() { return [chainConfig.id, contracts.token?.toLowerCase() || "unset", contracts.claimPool?.toLowerCase() || "unset"].join(":"); }
export function liquiditySettings() { return readLiquidityAccess(liquidityScope()); }
export function authorizationTtlSeconds() {
  const value = Number(process.env.CLAIM_AUTH_TTL_SECONDS || 600);
  return Number.isFinite(value) && value >= 60 && value <= 3600 ? Math.floor(value) : 600;
}
export function assertLiquidityWebsiteOpen(expectedRevision?: number) {
  const settings = liquiditySettings();
  if (!settings.enabled) throw new AdminRequestError("组 LP 已暂停，请等待重新开放；已组 LP 的领取不受影响", 409);
  if (expectedRevision !== undefined && settings.revision !== expectedRevision) throw new AdminRequestError("组 LP 设置已变化，请刷新后重新申请", 409);
  return settings;
}
export async function liquidityAccessStatus(): Promise<LiquidityAccessStatus> {
  const result: LiquidityAccessStatus = { settings: liquiditySettings(), chainId: chainConfig.id, token: contracts.token || null, pool: contracts.claimPool || null,
    chain: null, available: false, reason: "组 LP 合约尚未配置", checkedAt: Date.now(), maxAuthorizationSeconds: authorizationTtlSeconds() };
  if (!contracts.token || !contracts.claimPool || !contracts.usdt || !chainConfigurationValid) return result;
  try {
    if (await client.getChainId() !== chainConfig.id) throw new Error("wrong chain");
    const block = await client.getBlock({ blockTag: "latest" });
    if (block.number === null || Math.abs(Date.now() / 1000 - Number(block.timestamp)) > 180) throw new Error("stale block");
    const token = { address: contracts.token, abi: tokenAbi, blockNumber: block.number }, pool = { address: contracts.claimPool, abi: poolAbi, blockNumber: block.number };
    const [liquidityEnabled, claimOpen, tradingOpen, claimAt, tradingAt, launchPool, actualToken, usdt] = await Promise.all([
      client.readContract({ ...token, functionName: "liquidityEnabled" }), client.readContract({ ...token, functionName: "isClaimOpen" }),
      client.readContract({ ...token, functionName: "isTradingOpen" }), client.readContract({ ...token, functionName: "claimStartsAt" }),
      client.readContract({ ...token, functionName: "tradingStartsAt" }), client.readContract({ ...token, functionName: "launchPool" }),
      client.readContract({ ...pool, functionName: "token" }), client.readContract({ ...pool, functionName: "usdt" }),
    ]);
    if (launchPool.toLowerCase() !== contracts.claimPool.toLowerCase() || actualToken.toLowerCase() !== contracts.token.toLowerCase() || usdt.toLowerCase() !== contracts.usdt.toLowerCase()
      || claimOpen !== (liquidityEnabled && block.timestamp >= claimAt) || tradingOpen !== (liquidityEnabled && block.timestamp >= tradingAt)) throw new Error("pool mismatch");
    const canPrepare = liquidityEnabled && !tradingOpen;
    result.chain = { liquidityEnabled, claimOpen, tradingOpen, claimStartsAt: Number(claimAt), tradingStartsAt: Number(tradingAt), canPrepare };
    result.settings = liquiditySettings(); // Never return the pre-RPC switch state after a concurrent pause.
    result.available = canPrepare && result.settings.enabled;
    result.reason = tradingOpen ? "交易已开放，当前合约的固定比例组 LP 阶段已结束" : !liquidityEnabled ? "合约尚未开启组 LP 阶段" : !result.settings.enabled ? "组 LP 已暂停，请等待重新开放" : "组 LP 申请开放中";
  } catch { result.settings = liquiditySettings(); result.reason = "暂时无法核对链上组 LP 状态，请稍后刷新"; }
  result.checkedAt = Date.now();
  return result;
}
export async function assertLiquidityPreparationOpen() {
  const settings = assertLiquidityWebsiteOpen();
  const state = await liquidityAccessStatus();
  assertLiquidityWebsiteOpen(settings.revision);
  if (!state.available) throw new AdminRequestError(state.reason, state.chain ? 409 : 503);
  return settings;
}
