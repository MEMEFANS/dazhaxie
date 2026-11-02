import "server-only";
import { createPublicClient, decodeEventLog, encodeFunctionData, fallback, http, isAddress, parseAbi, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { appChain, chainConfig, chainConfigurationValid, contracts } from "../chain-config";
import { AdminRequestError } from "./admin-session";
import {
  countAuthorizationsSince, entitlementTokens, getClaimAuthorization, latestOpenAuthorization, listClaimEntitlements,
  localClaimedTokens, markAuthorizationClaimed, nextAuthorizationNonce, saveClaimAuthorization,
} from "./subscription-db";

/**
 * 签名领取服务。
 * CLAIM_SIGNER_PRIVATE_KEY 只用于签发 EIP-712 领取授权：
 * - 不是 owner，不能转走池内资金；
 * - 不打印、不写入日志、不回传给前端；
 * - 缺失或格式非法时视为「未配置签名服务」，接口返回 503，前端据此禁用领取按钮。
 */
const CLAIM_TYPES = {
  Claim: [
    { name: "user", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "mode", type: "uint8" },
  ],
} as const;
const DOMAIN_NAME = "CaBiSignedClaimPool", DOMAIN_VERSION = "1";
const DEFAULT_TTL_SECONDS = 600, DEFAULT_RATE_LIMIT = 5;

export const claimPoolAbi = parseAbi([
  "function token() view returns (address)",
  "function signer() view returns (address)",
  "function owner() view returns (address)",
  "function usdt() view returns (address)",
  "function usdtDecimals() view returns (uint8)",
  "function lpReceiver() view returns (address)",
  "function directRatio() view returns (uint256)",
  "function lpRatio() view returns (uint256)",
  "function lpTokenRatio() view returns (uint256)",
  "function lpUsdtRatio() view returns (uint256)",
  "function claimedOf(address) view returns (uint256)",
  "function claimLimitOf(address) view returns (uint256)",
  "function poolBalance() view returns (uint256)",
  "function totalClaimed() view returns (uint256)",
  "function totalBurned() view returns (uint256)",
  "function allocatedUnclaimed() view returns (uint256)",
  "function unusedBalance() view returns (uint256)",
  "event Claimed(address indexed user, uint256 amount, uint8 indexed mode, uint256 nonce, uint256 payout, uint256 burnAmount, uint256 lpTokens, uint256 usdtCharged)",
]);

export const claimPoolClient = createPublicClient({
  chain: appChain,
  transport: fallback(chainConfig.rpcUrls.map(url => http(url, { timeout: 10_000, retryCount: 0 })), { retryCount: 0 }),
});

const cache = globalThis as typeof globalThis & { cabiClaimSigner?: { key: string; account: ReturnType<typeof privateKeyToAccount> } };
function signerPrivateKey() {
  const raw = (process.env.CLAIM_SIGNER_PRIVATE_KEY || "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw) || /^0x0{64}$/.test(raw)) return null;
  return raw;
}
/** 只返回账号对象，私钥不离开本模块。 */
export function claimSigner() {
  const key = signerPrivateKey();
  if (!key) return null;
  if (cache.cabiClaimSigner?.key !== key) cache.cabiClaimSigner = { key, account: privateKeyToAccount(key as Hex) };
  return cache.cabiClaimSigner.account;
}
function ttlSeconds() {
  const value = Number(process.env.CLAIM_AUTH_TTL_SECONDS || DEFAULT_TTL_SECONDS);
  return Number.isFinite(value) && value >= 60 && value <= 3600 ? Math.floor(value) : DEFAULT_TTL_SECONDS;
}
function rateLimitPerMinute() {
  const value = Number(process.env.CLAIM_AUTH_RATE_LIMIT || DEFAULT_RATE_LIMIT);
  return Number.isFinite(value) && value >= 1 && value <= 60 ? Math.floor(value) : DEFAULT_RATE_LIMIT;
}

export function claimSigningStatus() {
  const account = claimSigner();
  return {
    configured: Boolean(account),
    signer: account?.address ?? null,
    claimPool: contracts.claimPool ?? null,
    chainId: chainConfig.id,
    ttlSeconds: ttlSeconds(),
    rateLimitPerMinute: rateLimitPerMinute(),
  };
}

export interface ClaimEntitlement {
  entitlement: bigint; chainClaimed: bigint; localClaimed: bigint; used: bigint; outstanding: bigint; chainSigner: Address;
}

async function ensurePool() {
  const pool = contracts.claimPool;
  if (!pool || !chainConfigurationValid) throw new AdminRequestError("领取池尚未配置，暂不能领取", 503);
  const code = await claimPoolClient.getCode({ address: pool }).catch(() => undefined);
  if (!code || code === "0x") throw new AdminRequestError("领取池尚未部署，暂不能领取", 503);
  return pool;
}

/** 链上已领 + 本地已登记，取较大值；链上读取失败一律 fail closed。 */
export async function claimEntitlement(address: string): Promise<ClaimEntitlement> {
  const pool = await ensurePool();
  let chainClaimed = 0n, chainSigner = "" as Address;
  try {
    [chainClaimed, chainSigner] = await Promise.all([
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "claimedOf", args: [address as Address] }) as Promise<bigint>,
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "signer" }) as Promise<Address>,
    ]);
  } catch {
    throw new AdminRequestError("暂时无法读取链上领取状态，请稍后重试", 503);
  }
  const entitlement = entitlementTokens(address), localClaimed = localClaimedTokens(address);
  const used = chainClaimed > localClaimed ? chainClaimed : localClaimed;
  return {
    entitlement,
    chainClaimed,
    localClaimed,
    used,
    outstanding: entitlement > used ? entitlement - used : 0n,
    chainSigner,
  };
}

function domainOf(pool: Address) {
  return { name: DOMAIN_NAME, version: DOMAIN_VERSION, chainId: chainConfig.id, verifyingContract: pool } as const;
}

export interface ClaimAuthorizationResponse {
  amount: string; nonce: string; deadline: number; mode: number; signature: string;
  claimPool: Address; chainId: number; signer: Address;
  domain: { name: string; version: string };
}

/** 签发（或复用）一张领取授权；同一额度同一 mode 的重复请求返回同一张未使用签名。 */
export async function issueClaimAuthorization(address: string, modeInput?: unknown): Promise<ClaimAuthorizationResponse> {
  const pool = await ensurePool();
  const account = claimSigner();
  if (!account) throw new AdminRequestError("未配置签名服务，暂不能领取", 503);
  const mode = modeInput === undefined || modeInput === null ? 0 : Number(modeInput);
  if (mode !== 0 && mode !== 1) throw new AdminRequestError("领取方式无效", 400);
  if (countAuthorizationsSince(address, Date.now() - 60_000) >= rateLimitPerMinute()) {
    throw new AdminRequestError("签名请求过于频繁，请稍后再试", 429);
  }

  const state = await claimEntitlement(address);
  if (state.chainSigner.toLowerCase() !== account.address.toLowerCase()) {
    throw new AdminRequestError("签名服务与链上 signer 不一致，请联系管理员", 503);
  }
  if (state.outstanding === 0n) throw new AdminRequestError("当前没有可领取额度", 400);

  const deadline = Math.floor(Date.now() / 1000) + ttlSeconds(), now = Math.floor(Date.now() / 1000);
  const reuse = latestOpenAuthorization(address);
  if (reuse && reuse.mode === mode && reuse.amount === state.outstanding.toString() && reuse.deadline > now + 60) {
    // 换过 signer 后旧记录仍可能留在库里：只有当前私钥能复现的签名才允许复用。
    const recovered = await recoverTypedDataAddress({
      domain: domainOf(pool), types: CLAIM_TYPES, primaryType: "Claim",
      message: { user: address as Address, amount: BigInt(reuse.amount), nonce: BigInt(reuse.nonce), deadline: BigInt(reuse.deadline), mode: reuse.mode },
      signature: reuse.signature as Hex,
    }).catch(() => null);
    if (recovered && recovered.toLowerCase() === account.address.toLowerCase()) {
      return {
        amount: reuse.amount, nonce: reuse.nonce, deadline: reuse.deadline, mode: reuse.mode, signature: reuse.signature,
        claimPool: pool, chainId: chainConfig.id, signer: account.address, domain: domainOf(pool),
      };
    }
  }

  const nonce = nextAuthorizationNonce(address);
  const message = {
    user: address as Address, amount: state.outstanding, nonce: BigInt(nonce), deadline: BigInt(deadline), mode,
  };
  const signature = await account.signTypedData({ domain: domainOf(pool), types: CLAIM_TYPES, primaryType: "Claim", message });
  saveClaimAuthorization({ address, nonce, amount: state.outstanding, mode, deadline, signature });
  return {
    amount: state.outstanding.toString(), nonce, deadline, mode, signature,
    claimPool: pool, chainId: chainConfig.id, signer: account.address, domain: domainOf(pool),
  };
}

/** 领取成功后登记回执：校验链上 Claimed 事件后才计入本地已领，重复回执幂等。 */
export async function recordClaimReceipt(address: string, nonceInput: unknown, hashInput: unknown) {
  const nonce = typeof nonceInput === "string" || typeof nonceInput === "number" ? String(nonceInput) : "";
  const txHash = typeof hashInput === "string" && /^0x[0-9a-fA-F]{64}$/.test(hashInput) ? hashInput : "";
  if (!/^\d{1,78}$/.test(nonce) || !txHash) throw new AdminRequestError("回执参数无效", 400);
  if (!getClaimAuthorization(address, nonce)) throw new AdminRequestError("授权记录不存在", 404);
  const pool = await ensurePool();
  const receipt = await claimPoolClient.getTransactionReceipt({ hash: txHash as Hex }).catch(() => null);
  if (!receipt || receipt.status !== "success") throw new AdminRequestError("链上交易尚未成功，回执未登记", 400);
  const matched = receipt.logs.some(log => {
    if (log.address.toLowerCase() !== pool.toLowerCase()) return false;
    try {
      const event = decodeEventLog({ abi: claimPoolAbi, eventName: "Claimed", data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      return (event.args.user as Address).toLowerCase() === address.toLowerCase() && String(event.args.nonce) === nonce;
    } catch { return false; }
  });
  if (!matched) throw new AdminRequestError("交易中没有对应的领取记录", 400);
  return markAuthorizationClaimed(address, nonce, txHash);
}

// ---------------------------------------------------------------- 后台总览
export interface ClaimPoolOverview {
  mode: "signed" | "legacy" | "unconfigured" | "error";
  pool: Address | null;
  error?: string;
  chain?: {
    owner: Address; signer: Address; usdt: Address; lpReceiver: Address; usdtDecimals: number;
    poolBalance: string; totalClaimed: string; totalBurned: string; allocatedUnclaimed: string; unusedBalance: string;
    directRatio: string; lpRatio: string; lpTokenRatio: string; lpUsdtRatio: string;
  };
  signing: ReturnType<typeof claimSigningStatus> & { signerMatches?: boolean };
  entitlements: { total: string; outstanding: string; addresses: number; rows: { address: string; tokens: string; chainClaimed: string; outstanding: string; reason: string[] }[] };
}

/** 后台领取池页：链上状态 + 签名服务配置 + 「待领额度」自动聚合列表（最多 200 行）。 */
export async function claimPoolOverview(): Promise<ClaimPoolOverview> {
  const signing = claimSigningStatus(), pool = contracts.claimPool;
  const rows = listClaimEntitlements();
  const total = rows.reduce((sum, row) => sum + BigInt(row.tokens), 0n);
  if (!pool) return { mode: "unconfigured", pool: null, signing, entitlements: { total: total.toString(), outstanding: "0", addresses: rows.length, rows: [] } };
  const code = await claimPoolClient.getCode({ address: pool }).catch(() => undefined);
  if (!code || code === "0x") return { mode: "error", pool, error: "领取池地址上还没有合约代码", signing, entitlements: { total: total.toString(), outstanding: "0", addresses: rows.length, rows: [] } };
  try { await claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "signer" }); }
  catch { return { mode: "legacy", pool, signing, entitlements: { total: total.toString(), outstanding: "0", addresses: rows.length, rows: [] } }; }

  const visible = rows.slice(0, 200);
  try {
    const chain = await Promise.all([
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "owner" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "signer" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "usdt" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "lpReceiver" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "usdtDecimals" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "poolBalance" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "totalClaimed" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "totalBurned" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "allocatedUnclaimed" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "unusedBalance" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "directRatio" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "lpRatio" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "lpTokenRatio" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "lpUsdtRatio" }),
    ]) as [Address, Address, Address, Address, number, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
    const [owner, chainSigner, usdt, lpReceiver, usdtDecimals, poolBalance, totalClaimed, totalBurned, allocatedUnclaimed, unusedBalance, directRatio, lpRatio, lpTokenRatio, lpUsdtRatio] = chain;
    const claimedAmounts = await Promise.all(visible.map(row =>
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "claimedOf", args: [row.address as Address] }).catch(() => 0n) as Promise<bigint>
    ));
    let outstanding = 0n;
    const detail = visible.map((row, index) => {
      const entitlement = BigInt(row.tokens), chainClaimed = claimedAmounts[index] || 0n;
      const remaining = entitlement > chainClaimed ? entitlement - chainClaimed : 0n;
      outstanding += remaining;
      return { address: row.address, tokens: row.tokens, chainClaimed: chainClaimed.toString(), outstanding: remaining.toString(), reason: row.reason };
    });
    return {
      mode: "signed", pool,
      chain: {
        owner, signer: chainSigner, usdt, lpReceiver, usdtDecimals: Number(usdtDecimals),
        poolBalance: String(poolBalance), totalClaimed: String(totalClaimed), totalBurned: String(totalBurned),
        allocatedUnclaimed: String(allocatedUnclaimed), unusedBalance: String(unusedBalance),
        directRatio: String(directRatio), lpRatio: String(lpRatio), lpTokenRatio: String(lpTokenRatio), lpUsdtRatio: String(lpUsdtRatio),
      },
      signing: { ...signing, signerMatches: signing.signer?.toLowerCase() === String(chainSigner).toLowerCase() },
      entitlements: { total: total.toString(), outstanding: outstanding.toString(), addresses: rows.length, rows: detail },
    };
  } catch {
    return { mode: "error", pool, error: "暂时无法读取领取池状态", signing, entitlements: { total: total.toString(), outstanding: "0", addresses: rows.length, rows: [] } };
  }
}

/** 权限交接：不在 Web 服务内持 owner 私钥，只生成 calldata 与操作指引并写审计。 */
export function prepareSignerHandover(next: unknown) {
  if (typeof next !== "string" || !isAddress(next, { strict: false }) || next.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    throw new AdminRequestError("请填写有效的非零 signer 地址", 400);
  }
  const data = encodeFunctionData({ abi: parseAbi(["function setSigner(address)"]), args: [next] });
  return {
    signer: next,
    calldata: data,
    instruction: "由当前 owner 钱包在 BscScan / 硬件钱包对领取池合约调用 setSigner(新地址)；切换后旧 signer 的未领取签名立即失效，需同步更新服务器 CLAIM_SIGNER_PRIVATE_KEY 并重启。",
  };
}
