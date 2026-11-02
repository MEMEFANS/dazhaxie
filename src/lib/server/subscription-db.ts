import "server-only";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAddress } from "viem";
import { HARD_CAP, TOKENS_PER_SHARE, floorShares, round2, teamDifferential, teamRate, teamTierIndex, teamTierLabel } from "../constants";
import { differentialOf, teamSharesOf, type TeamNode } from "../team-tree";
import { chainConfig } from "../chain-config";
import { adminDataDirectory } from "./admin-db";
import { AdminRequestError } from "./admin-session";
import { referralTreeRows } from "./referral-db";

type Row = Record<string, unknown>;
const cache = globalThis as typeof globalThis & { cabiSubscriptionDb?: { file: string; db: DatabaseSync } };

export function subscriptionDatabase() {
  const file = path.join(adminDataDirectory(), "subscriptions.sqlite");
  if (cache.cabiSubscriptionDb?.file === file) return cache.cabiSubscriptionDb.db;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS subscription_orders (
      id TEXT PRIMARY KEY, chain_id INTEGER NOT NULL, address TEXT NOT NULL, shares INTEGER NOT NULL,
      amount TEXT NOT NULL, tx_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed', created_at INTEGER NOT NULL,
      UNIQUE(chain_id, tx_hash)
    );
    CREATE INDEX IF NOT EXISTS subscription_orders_address ON subscription_orders(chain_id, address, created_at DESC);
    CREATE TABLE IF NOT EXISTS claim_batches (
      id TEXT PRIMARY KEY, chain_id INTEGER NOT NULL, status TEXT NOT NULL, addresses INTEGER NOT NULL,
      total TEXT NOT NULL, tx_hash TEXT, note TEXT, created_at INTEGER NOT NULL, applied_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS claim_batch_items (
      batch_id TEXT NOT NULL, address TEXT NOT NULL, amount TEXT NOT NULL,
      PRIMARY KEY(batch_id, address)
    );
    CREATE INDEX IF NOT EXISTS claim_batch_items_address ON claim_batch_items(address);
    CREATE TABLE IF NOT EXISTS claim_authorizations (
      id TEXT PRIMARY KEY, chain_id INTEGER NOT NULL, address TEXT NOT NULL, nonce TEXT NOT NULL,
      amount TEXT NOT NULL, mode INTEGER NOT NULL, deadline INTEGER NOT NULL, signature TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'signed', tx_hash TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(chain_id, address, nonce)
    );
    CREATE INDEX IF NOT EXISTS claim_authorizations_address ON claim_authorizations(chain_id, address, status, created_at DESC);
  `);
  cache.cabiSubscriptionDb = { file, db };
  return db;
}

export interface SubscriptionOrder {
  id: string; address: string; shares: number; amount: string; txHash: string; status: string; createdAt: number;
}
function serialize(row: Row): SubscriptionOrder {
  return {
    id: String(row.id), address: String(row.address), shares: Number(row.shares), amount: String(row.amount),
    txHash: String(row.tx_hash), status: String(row.status), createdAt: Number(row.created_at),
  };
}

export function globalSold(chainId = chainConfig.id): number {
  const row = subscriptionDatabase().prepare("SELECT COALESCE(SUM(shares), 0) AS sold FROM subscription_orders WHERE chain_id=? AND status='confirmed'").get(chainId);
  return Number(row?.sold || 0);
}

export function purchasedOf(address: string, chainId = chainConfig.id): number {
  const row = subscriptionDatabase().prepare("SELECT COALESCE(SUM(shares), 0) AS shares FROM subscription_orders WHERE chain_id=? AND status='confirmed' AND address=?").get(chainId, address.toLowerCase());
  return Number(row?.shares || 0);
}

export function subscriptionOrderByHash(txHash: string, chainId = chainConfig.id) {
  const row = subscriptionDatabase().prepare("SELECT * FROM subscription_orders WHERE chain_id=? AND tx_hash=?").get(chainId, txHash.toLowerCase());
  return row ? serialize(row) : null;
}

/**
 * 同一哈希只允许登记一次；硬顶在同一个写事务内复核，避免并发请求把总量推过上限。
 */
export function createSubscriptionOrder(input: { address: string; shares: number; amount: bigint; txHash: string }) {
  const db = subscriptionDatabase(), address = input.address.toLowerCase(), txHash = input.txHash.toLowerCase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const duplicate = db.prepare("SELECT id FROM subscription_orders WHERE chain_id=? AND tx_hash=?").get(chainConfig.id, txHash);
    if (duplicate) throw new AdminRequestError("该交易哈希已登记过认购，请勿重复提交", 409);
    const sold = globalSold();
    if (sold + input.shares > HARD_CAP) throw new AdminRequestError("认购将超过全局硬顶，本笔未登记", 409);
    const id = randomUUID();
    db.prepare("INSERT INTO subscription_orders (id, chain_id, address, shares, amount, tx_hash, status, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, chainConfig.id, address, input.shares, input.amount.toString(), txHash, "confirmed", Date.now());
    db.exec("COMMIT");
    return { id, address, shares: input.shares, amount: input.amount.toString(), txHash, status: "confirmed", createdAt: Date.now() } as SubscriptionOrder;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function listAddressSubscriptions(address: string, chainId = chainConfig.id): SubscriptionOrder[] {
  return subscriptionDatabase().prepare("SELECT * FROM subscription_orders WHERE chain_id=? AND address=? ORDER BY created_at DESC, rowid DESC").all(chainId, address.toLowerCase()).map(serialize);
}

export function searchSubscriptions(options: { page?: number; pageSize?: number; q?: string; status?: string } = {}) {
  const db = subscriptionDatabase(), chainId = chainConfig.id;
  const page = Math.max(1, Math.floor(options.page || 1)), pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize || 20)));
  const clauses: string[] = ["chain_id=?"], params: Array<string | number> = [chainId];
  const q = options.q?.trim().toLowerCase();
  if (q) { clauses.push("(address LIKE ? OR tx_hash LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }
  if (options.status?.trim()) { clauses.push("status=?"); params.push(options.status.trim()); }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM subscription_orders ${where}`).get(...params)?.count || 0);
  const rows = db.prepare(`SELECT * FROM subscription_orders ${where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  return { items: rows.map(serialize), total, page, pageSize, globalSold: globalSold(), hardCap: HARD_CAP };
}

export function allSubscriptionShares(): Map<string, number> {
  const rows = subscriptionDatabase().prepare("SELECT address, SUM(shares) AS shares FROM subscription_orders WHERE chain_id=? AND status='confirmed' GROUP BY address").all(chainConfig.id);
  return new Map(rows.map(row => [String(row.address).toLowerCase(), Number(row.shares)]));
}

// ---------------------------------------------------------------- 额度批次
export interface ClaimBatch {
  id: string; status: string; addresses: number; total: string; txHash: string | null; note: string | null;
  createdAt: number; appliedAt: number | null;
}
function serializeBatch(row: Row): ClaimBatch {
  return {
    id: String(row.id), status: String(row.status), addresses: Number(row.addresses), total: String(row.total),
    txHash: row.tx_hash ? String(row.tx_hash) : null, note: row.note ? String(row.note) : null,
    createdAt: Number(row.created_at), appliedAt: row.applied_at ? Number(row.applied_at) : null,
  };
}
function writtenAmounts(): Map<string, bigint> {
  // pending 与 applied 都计入已写入，防止重复生成同一份额度；failed 视为未写，可重新生成。
  const rows = subscriptionDatabase().prepare(`
    SELECT i.address AS address, i.amount AS amount
    FROM claim_batch_items i JOIN claim_batches b ON b.id=i.batch_id
    WHERE b.chain_id=? AND b.status IN ('pending','applied')
  `).all(chainConfig.id);
  const result = new Map<string, bigint>();
  for (const row of rows) {
    try {
      const address = String(row.address).toLowerCase();
      result.set(address, (result.get(address) || 0n) + BigInt(String(row.amount)));
    } catch { /* 忽略损坏的旧记录 */ }
  }
  return result;
}

function buildTeamNodes(shares: Map<string, number>): TeamNode[] {
  const nodes = new Map<string, TeamNode>();
  for (const row of referralTreeRows()) {
    const address = String(row.address).toLowerCase();
    nodes.set(address, { id: address, name: "", address: getAddress(address), selfShares: shares.get(address) || 0, children: [] });
  }
  for (const [address, selfShares] of shares) {
    if (!nodes.has(address)) nodes.set(address, { id: address, name: "", address: getAddress(address), selfShares, children: [] });
  }
  const roots: TeamNode[] = [];
  const parents = new Map(referralTreeRows().map(row => [String(row.address).toLowerCase(), row.parent ? String(row.parent).toLowerCase() : null]));
  for (const node of nodes.values()) {
    const parent = parents.get(node.id);
    if (parent && parent !== node.id && nodes.has(parent)) nodes.get(parent)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export interface ClaimTarget { address: string; shares: number; tokens: bigint; reason: string[] }
/**
 * 按认购单 + 直推奖励（每 3 份直推 = 1 份）+ 团队极差（逐人向下取整）计算累计应得额度。
 * 返回的是累计目标，不是本次增量；生成批次时再减去已写入金额。
 */
export function computeClaimTargets(): ClaimTarget[] {
  const shares = allSubscriptionShares();
  const roots = buildTeamNodes(shares);
  const result: ClaimTarget[] = [];
  const walk = (node: TeamNode) => {
    const directShares = node.children.reduce((sum, child) => sum + child.selfShares, 0);
    const directReward = Math.floor(directShares / 3);
    const differential = floorShares(differentialOf(node));
    const totalShares = node.selfShares + directReward + differential;
    if (totalShares > 0 && node.address) {
      result.push({
        address: node.address, shares: totalShares,
        tokens: BigInt(totalShares) * BigInt(TOKENS_PER_SHARE) * 10n ** 18n,
        reason: [`认购 ${node.selfShares} 份`, `直推 ${directReward} 份`, `极差 ${differential} 份`],
      });
    }
    node.children.forEach(walk);
  };
  roots.forEach(walk);
  return result.sort((a, b) => a.address.localeCompare(b.address));
}

export interface PromotionStats {
  purchased: number; directCount: number; directShares: number; directRewardShares: number;
  teamCount: number; teamShares: number; differentialShares: number; globalSold: number;
}
/** 由认购单与邀请关系树派生，不使用任何前端模拟数值。 */
export function promotionStats(address: string): PromotionStats {
  const target = address.toLowerCase(), shares = allSubscriptionShares(), roots = buildTeamNodes(shares);
  const find = (node: TeamNode): TeamNode | undefined => {
    if (node.id === target) return node;
    for (const child of node.children) { const found = find(child); if (found) return found; }
    return undefined;
  };
  let node: TeamNode | undefined;
  for (const root of roots) { node = find(root); if (node) break; }
  if (!node) return { purchased: shares.get(target) || 0, directCount: 0, directShares: 0, directRewardShares: 0, teamCount: 0, teamShares: 0, differentialShares: 0, globalSold: globalSold() };
  const directShares = node.children.reduce((sum, child) => sum + child.selfShares, 0);
  let teamCount = 0, teamShares = 0;
  const walk = (current: TeamNode) => { for (const child of current.children) { teamCount += 1; teamShares += child.selfShares; walk(child); } };
  walk(node);
  return {
    purchased: node.selfShares, directCount: node.children.length, directShares,
    directRewardShares: Math.floor(directShares / 3), teamCount, teamShares,
    differentialShares: floorShares(differentialOf(node)), globalSold: globalSold(),
  };
}

export interface PromotionBranch {
  address: string; name: string; selfShares: number; teamShares: number; tierIndex: number; tierLabel: string;
  diffRate: number; reward: number; selfReward: number;
}
export function promotionBranches(address: string): PromotionBranch[] {
  const target = address.toLowerCase(), shares = allSubscriptionShares(), roots = buildTeamNodes(shares);
  const find = (node: TeamNode): TeamNode | undefined => {
    if (node.id === target) return node;
    for (const child of node.children) { const found = find(child); if (found) return found; }
    return undefined;
  };
  let node: TeamNode | undefined;
  for (const root of roots) { node = find(root); if (node) break; }
  if (!node) return [];
  const ownRate = teamRate(teamSharesOf(node));
  return node.children.map(child => {
    const childTeamShares = teamSharesOf(child);
    const childRate = teamRate(childTeamShares);
    return {
      address: child.address, name: child.name || child.address, selfShares: child.selfShares,
      teamShares: childTeamShares, tierIndex: teamTierIndex(childTeamShares), tierLabel: teamTierLabel(childTeamShares),
      diffRate: Math.max(0, ownRate - childRate),
      reward: teamDifferential(teamSharesOf(node), [{ selfShares: child.selfShares, teamShares: childTeamShares }]),
      selfReward: round2(ownRate * child.selfShares),
    };
  });
}

/**
 * 生成增量批次；已领取地址（由调用方传入）跳过；已写入金额（pending/applied）不重复计入。
 */
function buildClaimItems(skipClaimed: Set<string>) {
  const written = writtenAmounts(), items: Array<{ address: string; amount: bigint }> = [], skipped: string[] = [];
  for (const target of computeClaimTargets()) {
    if (skipClaimed.has(target.address.toLowerCase())) { skipped.push(target.address); continue; }
    const already = written.get(target.address.toLowerCase()) || 0n;
    const delta = target.tokens - already;
    if (delta <= 0n) continue;
    items.push({ address: target.address, amount: delta });
  }
  return { items, skipped, total: items.reduce((sum, item) => sum + item.amount, 0n) };
}

export function previewClaimBatch(options: { skipClaimed?: Set<string> } = {}) {
  return buildClaimItems(options.skipClaimed || new Set<string>());
}

export function createClaimBatch(options: { skipClaimed?: Set<string>; note?: string } = {}) {
  const db = subscriptionDatabase();
  const { items, skipped, total } = buildClaimItems(options.skipClaimed || new Set<string>());
  if (!items.length) throw new AdminRequestError("没有需要新增的可领额度；请先确认认购单或已领取状态", 409);
  const id = `batch-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO claim_batches (id, chain_id, status, addresses, total, note, created_at) VALUES (?,?,?,?,?,?,?)")
      .run(id, chainConfig.id, "pending", items.length, total.toString(), options.note || null, Date.now());
    const insert = db.prepare("INSERT INTO claim_batch_items (batch_id, address, amount) VALUES (?,?,?)");
    for (const item of items) insert.run(id, item.address.toLowerCase(), item.amount.toString());
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return { batch: getClaimBatch(id)!, items, skipped, total };
}

export function getClaimBatch(id: string): ClaimBatch | null {
  const row = subscriptionDatabase().prepare("SELECT * FROM claim_batches WHERE chain_id=? AND id=?").get(chainConfig.id, id);
  return row ? serializeBatch(row) : null;
}

export function listClaimBatchItems(id: string) {
  return subscriptionDatabase().prepare("SELECT address, amount FROM claim_batch_items WHERE batch_id=? ORDER BY address").all(id)
    .map(row => ({ address: String(row.address), amount: String(row.amount) }));
}

export function listClaimBatches(options: { page?: number; pageSize?: number } = {}) {
  const db = subscriptionDatabase();
  const page = Math.max(1, Math.floor(options.page || 1)), pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize || 20)));
  const total = Number(db.prepare("SELECT COUNT(*) AS count FROM claim_batches WHERE chain_id=?").get(chainConfig.id)?.count || 0);
  const rows = db.prepare("SELECT * FROM claim_batches WHERE chain_id=? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?").all(chainConfig.id, pageSize, (page - 1) * pageSize);
  return { items: rows.map(serializeBatch), total, page, pageSize };
}

/** 登记批次链上结果；已 applied 的批次重复导入不产生任何发放（幂等）。 */
export function markClaimBatch(id: string, status: "applied" | "failed", txHash?: string) {
  const batch = getClaimBatch(id);
  if (!batch) throw new AdminRequestError("批次不存在", 404);
  if (batch.status === "applied") return batch; // 幂等：重复登记不改变任何额度
  if (status === "applied") {
    if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new AdminRequestError("请填写有效的交易哈希", 400);
    subscriptionDatabase().prepare("UPDATE claim_batches SET status='applied', tx_hash=?, applied_at=? WHERE chain_id=? AND id=?")
      .run(txHash, Date.now(), chainConfig.id, id);
  } else {
    subscriptionDatabase().prepare("UPDATE claim_batches SET status='failed' WHERE chain_id=? AND id=?").run(chainConfig.id, id);
  }
  return getClaimBatch(id)!;
}

// --------------------------------------------------------- 签名领取授权
export interface ClaimAuthorization {
  id: string; address: string; nonce: string; amount: string; mode: number; deadline: number;
  signature: string; status: string; txHash: string | null; createdAt: number; updatedAt: number;
}
function serializeAuthorization(row: Row): ClaimAuthorization {
  return {
    id: String(row.id), address: String(row.address), nonce: String(row.nonce), amount: String(row.amount),
    mode: Number(row.mode), deadline: Number(row.deadline), signature: String(row.signature), status: String(row.status),
    txHash: row.tx_hash ? String(row.tx_hash) : null, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
}

export function getClaimAuthorization(address: string, nonce: string, chainId = chainConfig.id): ClaimAuthorization | null {
  const row = subscriptionDatabase().prepare("SELECT * FROM claim_authorizations WHERE chain_id=? AND address=? AND nonce=?").get(chainId, address.toLowerCase(), String(nonce));
  return row ? serializeAuthorization(row) : null;
}

/** 最近一张仍可复用（未领取、未过期）的授权；用于「重复请求返回同一签名」。 */
export function latestOpenAuthorization(address: string, chainId = chainConfig.id): ClaimAuthorization | null {
  const row = subscriptionDatabase().prepare(
    "SELECT * FROM claim_authorizations WHERE chain_id=? AND address=? AND status='signed' ORDER BY created_at DESC, rowid DESC LIMIT 1",
  ).get(chainId, address.toLowerCase());
  return row ? serializeAuthorization(row) : null;
}

/** nonce 单调递增：取该地址历史最大 nonce + 1。 */
export function nextAuthorizationNonce(address: string, chainId = chainConfig.id): string {
  const row = subscriptionDatabase().prepare(
    "SELECT MAX(CAST(nonce AS INTEGER)) AS value FROM claim_authorizations WHERE chain_id=? AND address=?",
  ).get(chainId, address.toLowerCase());
  return String((BigInt(Number(row?.value || 0))) + 1n);
}

export function countAuthorizationsSince(address: string, since: number, chainId = chainConfig.id): number {
  return Number(subscriptionDatabase().prepare(
    "SELECT COUNT(*) AS count FROM claim_authorizations WHERE chain_id=? AND address=? AND created_at>?",
  ).get(chainId, address.toLowerCase(), since)?.count || 0);
}

/** 本地已登记的领取总额；与链上 claimedOf 取较大值，防止并发导致超发。 */
export function localClaimedTokens(address: string, chainId = chainConfig.id): bigint {
  const rows = subscriptionDatabase().prepare(
    "SELECT amount FROM claim_authorizations WHERE chain_id=? AND address=? AND status='claimed'",
  ).all(chainId, address.toLowerCase());
  let total = 0n;
  for (const row of rows) { try { total += BigInt(String(row.amount)); } catch { /* 忽略损坏记录 */ } }
  return total;
}

/**
 * 落库一张新授权：先把该地址仍待领取的旧授权标记为 superseded，再写入新 nonce。
 * 同一 (地址, nonce) 有唯一约束，重复插入会抛错而不会产生两张同 nonce 的授权。
 */
export function saveClaimAuthorization(input: {
  address: string; nonce: string; amount: bigint; mode: number; deadline: number; signature: string;
}) {
  const db = subscriptionDatabase(), address = input.address.toLowerCase(), now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE claim_authorizations SET status='superseded', updated_at=? WHERE chain_id=? AND address=? AND status='signed'")
      .run(now, chainConfig.id, address);
    db.prepare(`INSERT INTO claim_authorizations (id, chain_id, address, nonce, amount, mode, deadline, signature, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), chainConfig.id, address, String(input.nonce), input.amount.toString(), input.mode, input.deadline, input.signature, "signed", now, now);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return getClaimAuthorization(address, input.nonce)!;
}

/** 领取成功后登记本地回执：同一 nonce 只登记一次，重复调用不重复计数。 */
export function markAuthorizationClaimed(address: string, nonce: string, txHash: string) {
  const record = getClaimAuthorization(address, nonce);
  if (!record) throw new AdminRequestError("授权记录不存在", 404);
  if (record.status === "claimed") return { ...record, idempotent: true };
  subscriptionDatabase().prepare("UPDATE claim_authorizations SET status='claimed', tx_hash=?, updated_at=? WHERE chain_id=? AND address=? AND nonce=?")
    .run(txHash.toLowerCase(), Date.now(), chainConfig.id, address.toLowerCase(), String(nonce));
  return { ...getClaimAuthorization(address, nonce)!, idempotent: false };
}

/** 服务器聚合出的单人累计应得额度（CaBi 最小单位）。 */
export function entitlementTokens(address: string): bigint {
  const target = computeClaimTargets().find(item => item.address.toLowerCase() === address.toLowerCase());
  return target ? target.tokens : 0n;
}

export interface ClaimEntitlementRow {
  address: string; shares: number; tokens: string; reason: string[];
}
export function listClaimEntitlements(): ClaimEntitlementRow[] {
  return computeClaimTargets().map(target => ({ address: target.address, shares: target.shares, tokens: target.tokens.toString(), reason: target.reason }));
}
