import "server-only";
import { createPublicClient, encodeFunctionData, fallback, http, isAddress, parseAbi, type Address, type Hex } from "viem";
import { appChain, chainConfig, contracts } from "../chain-config";
import { AdminRequestError } from "./admin-session";
import {
  claimRootBatchByRoot, claimRootItem, listClaimEntitlements,
} from "./subscription-db";

/**
 * Merkle 领取证明服务。
 * 服务端不持有任何私钥：只读取 owner 已发布的链上 root，并从后台生成的批次中取出对应 proof。
 * 领取交易完全由用户自己的钱包发起。
 */
export const claimPoolAbi = parseAbi([
  "function token() view returns (address)",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function usdt() view returns (address)",
  "function usdtDecimals() view returns (uint8)",
  "function lpReceiver() view returns (address)",
  "function merkleRoot() view returns (bytes32)",
  "function epoch() view returns (uint256)",
  "function claimedOf(address) view returns (uint256)",
  "function poolBalance() view returns (uint256)",
  "function totalClaimed() view returns (uint256)",
  "function totalLpTokens() view returns (uint256)",
  "function totalUsdtCharged() view returns (uint256)",
]);

export const claimPoolClient = createPublicClient({
  chain: appChain,
  transport: fallback(chainConfig.rpcUrls.map(url => http(url, { timeout: 10_000, retryCount: 0 })), { retryCount: 0 }),
});

const ZERO = "0x0000000000000000000000000000000000000000";

export interface ClaimProofState {
  configured: boolean;
  claimPool: Address | null;
  chainId: number;
  authenticated: boolean;
  needSignIn?: boolean;
  address?: Address;
  root: Hex | null;
  epoch: number;
  /** 当前批次中该地址的累计应得额度（CaBi 最小单位） */
  amount: string;
  /** 链上累计已领 */
  chainClaimed: string;
  /** 本次可领差额 */
  claimable: string;
  proof: Hex[];
  lpReady: boolean;
  error?: string;
}

/** 领取卡初始化：读取链上 root/epoch，返回当前批次的累计额度与 proof。 */
export async function claimProof(addressInput?: string): Promise<ClaimProofState> {
  const pool = contracts.claimPool ?? null;
  const base: ClaimProofState = {
    configured: Boolean(pool), claimPool: pool, chainId: chainConfig.id, authenticated: false,
    root: null, epoch: 0, amount: "0", chainClaimed: "0", claimable: "0", proof: [], lpReady: false,
  };
  if (!pool) return { ...base, error: "领取池尚未配置，暂不能领取" };

  let chainRoot: Hex, chainEpoch: bigint, lpReceiver: Address, usdt: Address;
  try {
    [chainRoot, chainEpoch, lpReceiver, usdt] = await Promise.all([
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "merkleRoot" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "epoch" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "lpReceiver" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "usdt" }),
    ]) as [Hex, bigint, Address, Address];
  } catch {
    return { ...base, error: "暂时无法读取领取批次，请稍后重试" };
  }
  const lpReady = Boolean(
    lpReceiver && lpReceiver.toLowerCase() !== ZERO && usdt && usdt.toLowerCase() !== ZERO,
  );
  const published = { ...base, root: chainRoot, epoch: Number(chainEpoch), lpReady };

  if (!chainRoot || chainRoot === "0x") {
    return { ...published, error: "管理员尚未发布领取批次，暂不能领取" };
  }
  if (!addressInput) return { ...published, needSignIn: true, error: "请先登录钱包后再领取" };

  const batch = claimRootBatchByRoot(chainRoot, Number(chainEpoch));
  if (!batch) return { ...published, error: "链上领取批次与后台记录不一致，请联系管理员" };
  const item = claimRootItem(batch.id, addressInput);
  const address = addressInput as Address;
  if (!item) {
    return { ...published, authenticated: true, address, error: "当前没有可领取额度" };
  }

  let chainClaimed = 0n;
  try {
    chainClaimed = await claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "claimedOf", args: [address] }) as bigint;
  } catch {
    return { ...published, authenticated: true, address, error: "暂时无法读取链上领取状态，请稍后重试" };
  }

  const amount = BigInt(item.amount), remaining = amount > chainClaimed ? amount - chainClaimed : 0n;
  let error: string | undefined;
  if (!lpReady) error = "LP 接收地址或 USDT 尚未配置，暂不能领取";
  else if (remaining === 0n) error = "本次额度已全部领取";
  return {
    ...published,
    authenticated: true, address,
    amount: amount.toString(), chainClaimed: chainClaimed.toString(), claimable: remaining.toString(),
    proof: item.proof as Hex[], ...(error ? { error } : {}),
  };
}

// ---------------------------------------------------------------- 后台总览
export interface ClaimPoolOverview {
  mode: "merkle" | "unconfigured" | "error";
  pool: Address | null;
  error?: string;
  chain?: {
    owner: Address; pendingOwner: Address; usdt: Address; lpReceiver: Address; usdtDecimals: number;
    merkleRoot: Hex; epoch: number; lpReady: boolean;
    poolBalance: string; totalClaimed: string; totalLpTokens: string; totalUsdtCharged: string;
  };
  batch: {
    id: string; epoch: number; root: string; status: string; addresses: number; total: string;
    txHash: string | null; createdAt: number; appliedAt: number | null; matchesChain: boolean;
  } | null;
  entitlements: {
    total: string; outstanding: string; addresses: number;
    rows: { address: string; tokens: string; chainClaimed: string; outstanding: string; reason: string[] }[];
  };
}

/** 后台领取池页：链上状态、当前 root 批次与「待领额度」聚合列表（展示前 200 行）。 */
export async function claimPoolOverview(): Promise<ClaimPoolOverview> {
  const pool = contracts.claimPool ?? null;
  const rows = listClaimEntitlements();
  const total = rows.reduce((sum, row) => sum + BigInt(row.tokens), 0n);
  const base = { entitlements: { total: total.toString(), outstanding: "0", addresses: rows.length, rows: [] }, batch: null };
  if (!pool) return { mode: "unconfigured", pool: null, ...base };
  const code = await claimPoolClient.getCode({ address: pool }).catch(() => undefined);
  if (!code || code === "0x") return { mode: "error", pool, error: "领取池地址上还没有合约代码", ...base };

  const visible = rows.slice(0, 200);
  try {
    const chain = await Promise.all([
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "owner" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "pendingOwner" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "usdt" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "lpReceiver" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "usdtDecimals" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "merkleRoot" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "epoch" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "poolBalance" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "totalClaimed" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "totalLpTokens" }),
      claimPoolClient.readContract({ address: pool, abi: claimPoolAbi, functionName: "totalUsdtCharged" }),
    ]) as [Address, Address, Address, Address, number, Hex, bigint, bigint, bigint, bigint, bigint];
    const [owner, pendingOwner, usdt, lpReceiver, usdtDecimals, merkleRoot, epoch, poolBalance, totalClaimed, totalLpTokens, totalUsdtCharged] = chain;
    const lpReady = Boolean(lpReceiver && lpReceiver.toLowerCase() !== ZERO && usdt && usdt.toLowerCase() !== ZERO);
    const stored = merkleRoot && merkleRoot !== "0x" ? claimRootBatchByRoot(merkleRoot, Number(epoch)) : null;

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
      mode: "merkle", pool,
      chain: {
        owner, pendingOwner, usdt, lpReceiver, usdtDecimals: Number(usdtDecimals),
        merkleRoot, epoch: Number(epoch), lpReady,
        poolBalance: String(poolBalance), totalClaimed: String(totalClaimed),
        totalLpTokens: String(totalLpTokens), totalUsdtCharged: String(totalUsdtCharged),
      },
      batch: stored ? {
        id: stored.id, epoch: stored.epoch, root: stored.root, status: stored.status, addresses: stored.addresses,
        total: stored.total, txHash: stored.txHash, createdAt: stored.createdAt, appliedAt: stored.appliedAt,
        matchesChain: stored.root.toLowerCase() === merkleRoot.toLowerCase() && stored.epoch === Number(epoch),
      } : null,
      entitlements: { total: total.toString(), outstanding: outstanding.toString(), addresses: rows.length, rows: detail },
    };
  } catch {
    return { mode: "error", pool, error: "暂时无法读取领取池状态", ...base };
  }
}

/** 后台生成 owner 上链所需的 setMerkleRoot calldata；私钥不进入 Web 服务。 */
export function prepareRootPublish(root: unknown, epoch: unknown) {
  if (typeof root !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(root)) throw new AdminRequestError("请填写有效的 Merkle root", 400);
  if (!Number.isInteger(epoch) || (epoch as number) <= 0) throw new AdminRequestError("epoch 必须为正整数", 400);
  if (!isAddress(contracts.claimPool ?? "", { strict: false })) throw new AdminRequestError("领取池尚未配置", 503);
  const data = encodeFunctionData({ abi: parseAbi(["function setMerkleRoot(bytes32,uint256)"]), args: [root as Hex, BigInt(epoch as number)] });
  return {
    claimPool: contracts.claimPool,
    calldata: data,
    instruction: "由当前 owner 钱包在 BscScan / 硬件钱包对领取池合约调用 setMerkleRoot(root, epoch)。发布后旧批次 proof 立即失效。",
  };
}
