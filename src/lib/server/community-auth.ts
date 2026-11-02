import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { getAddress, isAddress, verifyMessage, type Address, type Hex } from "viem";
import { chainConfig } from "../chain-config";
import { AdminRequestError } from "./admin-session";
import { communityDatabase, ensureMember } from "./community-db";
import { currentReferralWallet } from "./referral-auth";
import { secureCookie } from "./cookie-security";

const COOKIE = "cabi_community_wallet";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const originOf = (request: Request) => process.env.APP_ORIGIN || new URL(request.url).origin;

function issueSession(address: string) {
  const db = communityDatabase();
  const token = randomBytes(32).toString("hex"), expiresAt = Date.now() + 8 * 60 * 60_000;
  db.prepare("DELETE FROM community_sessions WHERE expires_at<=?").run(Date.now());
  db.prepare("INSERT INTO community_sessions(token_hash,address,chain_id,expires_at) VALUES(?,?,?,?)").run(hash(token), address, chainConfig.id, expiresAt);
  ensureMember(address);
  return { token, payload: { address, chainId: chainConfig.id, expiresAt } };
}

/** 免签名入群：邀请门禁已通过签名验证钱包身份，直接复用其会话发放社群会话。 */
export async function grantCommunitySessionFromReferral() {
  const referral = await currentReferralWallet();
  if (!referral) return null;
  const { token, payload } = issueSession(referral.address);
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: secureCookie(), sameSite: "strict", path: "/", maxAge: 8 * 60 * 60 });
  return payload;
}

export function createCommunityChallenge(request: Request, addressInput: unknown) {
  if (typeof addressInput !== "string" || !isAddress(addressInput, { strict: false })) throw new AdminRequestError("钱包地址无效", 400);
  const address = getAddress(addressInput.toLowerCase()).toLowerCase(), db = communityDatabase(), now = Date.now(), origin = originOf(request);
  db.prepare("DELETE FROM community_challenges WHERE expires_at<=?").run(now);
  const recent = db.prepare("SELECT COUNT(*) AS count FROM community_challenges WHERE address=? AND created_at>?").get(address, now - 60_000);
  if (Number(recent?.count || 0) >= 5) throw new AdminRequestError("签名请求过于频繁，请稍后重试", 429);
  const id = randomBytes(24).toString("hex"), expiresAt = now + 5 * 60_000;
  const message = `${new URL(origin).host} requests a CaBi community sign in.\n\nWallet: ${address}\nURI: ${origin}\nChain ID: ${chainConfig.id}\nNonce: ${id}\nIssued At: ${new Date(now).toISOString()}\nExpiration Time: ${new Date(expiresAt).toISOString()}\n\nSign in to read and post in the CaBi community and to submit support tickets. This is a free message signature, not a blockchain transaction.`;
  db.prepare("INSERT INTO community_challenges(id,address,chain_id,origin,message,created_at,expires_at) VALUES(?,?,?,?,?,?,?)")
    .run(id, address, chainConfig.id, origin, message, now, expiresAt);
  return { id, message, address, chainId: chainConfig.id, expiresAt };
}

export async function verifyCommunityChallenge(request: Request, id: unknown, signature: unknown) {
  if (typeof id !== "string" || !/^[a-f0-9]{48}$/.test(id) || typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new AdminRequestError("签名格式有误", 400);
  const db = communityDatabase(), row = db.prepare("SELECT * FROM community_challenges WHERE id=?").get(id);
  if (!row || Number(row.expires_at) <= Date.now() || row.origin !== originOf(request) || Number(row.chain_id) !== chainConfig.id) throw new AdminRequestError("登录请求已失效，请重试", 401);
  let valid = false;
  try { valid = await verifyMessage({ address: String(row.address) as Address, message: String(row.message), signature: signature as Hex }); } catch { /* Fail closed. */ }
  if (!valid) throw new AdminRequestError("钱包身份签名验证失败", 401);
  const consumed = db.prepare("DELETE FROM community_challenges WHERE id=? AND expires_at>?").run(id, Date.now()) as { changes: number };
  if (!consumed.changes) throw new AdminRequestError("登录请求已使用或过期", 401);
  const token = randomBytes(32).toString("hex"), expiresAt = Date.now() + 8 * 60 * 60_000;
  db.prepare("DELETE FROM community_sessions WHERE expires_at<=?").run(Date.now());
  db.prepare("INSERT INTO community_sessions(token_hash,address,chain_id,expires_at) VALUES(?,?,?,?)").run(hash(token), String(row.address), chainConfig.id, expiresAt);
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: secureCookie(), sameSite: "strict", path: "/", maxAge: 8 * 60 * 60 });
  ensureMember(String(row.address));
  return { address: String(row.address), chainId: chainConfig.id, expiresAt };
}

export async function currentCommunityWallet() {
  await connection();
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = communityDatabase().prepare("SELECT address,chain_id,expires_at FROM community_sessions WHERE token_hash=? AND expires_at>?").get(hash(token), Date.now());
  return row && Number(row.chain_id) === chainConfig.id ? { address: String(row.address), chainId: chainConfig.id, expiresAt: Number(row.expires_at) } : null;
}

export async function requireCommunityWallet() {
  const session = await currentCommunityWallet();
  if (!session) throw new AdminRequestError("请先登录社群", 401);
  return session;
}
