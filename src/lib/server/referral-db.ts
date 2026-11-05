import "server-only";
import { randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAddress, isAddress, zeroAddress } from "viem";
import { chainConfig, contracts } from "../chain-config";
import { parseInvitation, type ReferralBinding, type ReferralData } from "../referral";
import { adminDataDirectory } from "./admin-db";
import { AdminRequestError } from "./admin-session";

type Row = { address: string; code: string; parent: string | null; root: number };
const cache = globalThis as typeof globalThis & { cabiReferralDb?: { file: string; db: DatabaseSync } };
export function referralDatabase() {
  const file = path.join(adminDataDirectory(), "referrals.sqlite");
  if (cache.cabiReferralDb?.file === file) return cache.cabiReferralDb.db;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS referral_members (
      chain_id INTEGER NOT NULL, address TEXT NOT NULL, code TEXT NOT NULL, parent TEXT,
      root INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, bound_at INTEGER,
      PRIMARY KEY(chain_id,address), UNIQUE(chain_id,code)
    );
    CREATE TABLE IF NOT EXISTS referral_challenges (id TEXT PRIMARY KEY,address TEXT NOT NULL,chain_id INTEGER NOT NULL,origin TEXT NOT NULL,message TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS referral_challenge_account ON referral_challenges(address,created_at);
    CREATE TABLE IF NOT EXISTS referral_sessions (token_hash TEXT PRIMARY KEY,address TEXT NOT NULL,chain_id INTEGER NOT NULL,expires_at INTEGER NOT NULL);
  `);
  // 挑战可携带待绑定邀请码：签名一次同时完成登录与绑定；旧库补列。
  try { db.exec("ALTER TABLE referral_challenges ADD COLUMN code TEXT"); } catch { /* 列已存在 */ }
  cache.cabiReferralDb = { file, db };
  return db;
}
export function referralAddress(input: unknown) {
  if (typeof input !== "string" || !isAddress(input, { strict: false })) throw new AdminRequestError("钱包身份无效", 400);
  const address = input.toLowerCase();
  const forbidden = [zeroAddress, "0x000000000000000000000000000000000000dead", ...Object.values(contracts)].filter(Boolean);
  if (forbidden.some(value => value!.toLowerCase() === address)) throw new AdminRequestError("系统地址不能注册邀请码", 400);
  return address;
}
function rowFor(address: string): Row | undefined {
  return referralDatabase().prepare("SELECT address,code,parent,root FROM referral_members WHERE chain_id=? AND address=?").get(chainConfig.id,address) as Row | undefined;
}
function serialize(row: Row): ReferralData {
  return { account: getAddress(row.address), code: row.code, referrerCode: row.parent ? rowFor(row.parent)?.code || null : null,
    referrer: row.parent ? getAddress(row.parent) : null, bound: Boolean(row.parent || row.root), root: row.root === 1 };
}
function ensureMember(address: string) {
  const db = referralDatabase();
  for (let attempt=0; attempt<10; attempt++) {
    const existing = rowFor(address); if (existing) return existing;
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const code = Array.from({length:8}, () => alphabet[randomInt(alphabet.length)]).join("");
    db.prepare("INSERT OR IGNORE INTO referral_members(chain_id,address,code,created_at) VALUES(?,?,?,?)").run(chainConfig.id,address,code,Date.now());
  }
  const row = rowFor(address);
  if (!row) throw new AdminRequestError("邀请码生成失败，请重试",503);
  return row;
}
export function readReferral(input: unknown): ReferralData { return serialize(ensureMember(referralAddress(input))); }
/** Read existing membership only; checking an address must not register it. */
export function readReferralBinding(input: unknown): ReferralBinding {
  const account = referralAddress(input), row = rowFor(account);
  return { account, chainId: chainConfig.id, bound: Boolean(row?.parent || row?.root) };
}
export function bindReferral(input: unknown, codeInput: unknown): ReferralData {
  const address = referralAddress(input);
  const code = typeof codeInput === "string" ? parseInvitation(codeInput) : undefined;
  if (!code) throw new AdminRequestError("请输入有效的 8 位邀请码",400);
  const db = referralDatabase(); db.exec("BEGIN IMMEDIATE");
  try {
    const member = ensureMember(address);
    const inviter = db.prepare("SELECT address,code,parent,root FROM referral_members WHERE chain_id=? AND code=?").get(chainConfig.id,code) as Row | undefined;
    if (!inviter || (!inviter.parent && !inviter.root)) throw new AdminRequestError("邀请码不存在或尚未启用，请向邀请人核对",400);
    if (inviter.address === address) throw new AdminRequestError("不能绑定自己的邀请码",400);
    if (member.root || member.parent) {
      if (member.parent === inviter.address) { db.exec("COMMIT"); return serialize(member); }
      throw new AdminRequestError("推荐关系已绑定，不能更换",409);
    }
    const seen = new Set([address]); let cursor: Row | undefined = inviter;
    while (cursor) {
      if (seen.has(cursor.address)) throw new AdminRequestError("不能形成循环邀请关系",409);
      seen.add(cursor.address); cursor = cursor.parent ? rowFor(cursor.parent) : undefined;
    }
    db.prepare("UPDATE referral_members SET parent=?,bound_at=? WHERE chain_id=? AND address=? AND parent IS NULL AND root=0").run(inviter.address,Date.now(),chainConfig.id,address);
    const result = serialize(rowFor(address)!); db.exec("COMMIT"); return result;
  } catch(error) { db.exec("ROLLBACK"); throw error; }
}
/** Only an authenticated administrator may bootstrap real project invitation roots. */
export function createReferralRoot(input: unknown): ReferralData {
  const address = referralAddress(input), db = referralDatabase(); db.exec("BEGIN IMMEDIATE");
  try {
    const row = ensureMember(address);
    if (row.parent) throw new AdminRequestError("已有推荐人的钱包不能改为初始邀请人",409);
    db.prepare("UPDATE referral_members SET root=1,bound_at=? WHERE chain_id=? AND address=?").run(Date.now(),chainConfig.id,address);
    const result = serialize(rowFor(address)!); db.exec("COMMIT"); return result;
  } catch(error) { db.exec("ROLLBACK"); throw error; }
}
// 用户明细视图的地址集合：链上没有地址枚举能力，只能汇总服务端已登记的钱包。
export function referralAddresses(): string[] {
  return referralDatabase().prepare("SELECT address FROM referral_members WHERE chain_id=?").all(chainConfig.id).map(row => String(row.address));
}
// 团队名单生成所需的原始关系边；不做任何业绩或奖励计算，算法仍在前端复用 team-tree。
export function referralTreeRows(): Array<{ address: string; parent: string | null; root: boolean }> {
  return referralDatabase().prepare("SELECT address,parent,root FROM referral_members WHERE chain_id=?").all(chainConfig.id)
    .map(row => ({ address: String(row.address), parent: row.parent ? String(row.parent) : null, root: Number(row.root) === 1 }));
}
