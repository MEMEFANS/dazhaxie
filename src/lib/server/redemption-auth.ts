import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { getAddress, isAddress, verifyMessage, type Hex } from "viem";
import { chainConfig } from "../chain-config";
import { AdminRequestError } from "./admin-session";
import { redemptionDatabase, redemptionSecret } from "./redemption-db";
import { secureCookie } from "./cookie-security";
const COOKIE = "cabi_redemption_wallet";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function expectedOrigin(request: Request) { return process.env.APP_ORIGIN || new URL(request.url).origin; }
export function createWalletChallenge(request: Request, addressInput: unknown) {
  redemptionSecret();
  if (typeof addressInput !== "string" || !isAddress(addressInput, { strict: false })) throw new AdminRequestError("钱包地址无效", 400);
  const address = getAddress(addressInput.toLowerCase()), db = redemptionDatabase(), now = Date.now(), origin = expectedOrigin(request);
  db.prepare("DELETE FROM wallet_challenges WHERE expires_at<=?").run(now);
  const recent = db.prepare("SELECT COUNT(*) AS count FROM wallet_challenges WHERE address=? AND created_at>?").get(address.toLowerCase(), now - 60_000);
  if (Number(recent?.count) >= 5) throw new AdminRequestError("签名请求过于频繁，请稍后重试", 429);
  const id = randomBytes(24).toString("hex"), expiresAt = now + 5 * 60_000;
  const message = `${new URL(origin).host} requests a CaBi shipping-account sign in.\n\nWallet: ${address}\nURI: ${origin}\nChain ID: ${chainConfig.id}\nNonce: ${id}\nIssued At: ${new Date(now).toISOString()}\nExpiration Time: ${new Date(expiresAt).toISOString()}\n\nThis signature only grants access to your private redemption orders. It does not authorize token transfers.`;
  db.prepare("INSERT INTO wallet_challenges(id,address,chain_id,origin,message,expires_at,created_at) VALUES(?,?,?,?,?,?,?)").run(id, address.toLowerCase(), chainConfig.id, origin, message, expiresAt, now);
  return { id, message, chainId: chainConfig.id, address, expiresAt };
}
export async function verifyWalletChallenge(request: Request, id: unknown, signature: unknown) {
  redemptionSecret();
  if (typeof id !== "string" || !/^[a-f0-9]{48}$/.test(id) || typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new AdminRequestError("签名格式有误", 400);
  const db = redemptionDatabase(), row = db.prepare("SELECT * FROM wallet_challenges WHERE id=?").get(id);
  if (!row || Number(row.expires_at) <= Date.now() || row.origin !== expectedOrigin(request) || Number(row.chain_id) !== chainConfig.id) throw new AdminRequestError("签名请求已失效，请重新签名", 401);
  let valid = false;
  try { valid = await verifyMessage({ address: String(row.address) as Hex, message: String(row.message), signature: signature as Hex }); } catch { /* Invalid signatures never establish sessions. */ }
  if (!valid) throw new AdminRequestError("钱包签名验证失败", 401);
  const consumed = db.prepare("DELETE FROM wallet_challenges WHERE id=? AND expires_at>?").run(id, Date.now()) as {changes:number};
  if (!consumed.changes) throw new AdminRequestError("签名请求已使用或失效", 401);
  const token = randomBytes(32).toString("hex"), expiresAt = Date.now() + 8 * 60 * 60_000;
  db.prepare("DELETE FROM wallet_sessions WHERE expires_at<=?").run(Date.now());
  db.prepare("INSERT INTO wallet_sessions(token_hash,address,chain_id,expires_at) VALUES(?,?,?,?)").run(hash(token), String(row.address), chainConfig.id, expiresAt);
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: secureCookie(), sameSite: "strict", path: "/", maxAge: 8 * 60 * 60 });
  return { address: String(row.address), chainId: chainConfig.id, expiresAt };
}
export async function currentRedemptionWallet() {
  await connection();
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = redemptionDatabase().prepare("SELECT address,chain_id,expires_at FROM wallet_sessions WHERE token_hash=? AND expires_at>?").get(hash(token), Date.now());
  return row && Number(row.chain_id) === chainConfig.id ? { address: String(row.address), chainId: Number(row.chain_id), expiresAt: Number(row.expires_at) } : null;
}
export async function requireRedemptionWallet() {
  const session = await currentRedemptionWallet();
  if (!session) throw new AdminRequestError("请先使用当前钱包签名登录兑换服务", 401);
  return session;
}
export async function logoutRedemptionWallet() {
  const jar = await cookies(), token = jar.get(COOKIE)?.value;
  if (token) redemptionDatabase().prepare("DELETE FROM wallet_sessions WHERE token_hash=?").run(hash(token));
  jar.set(COOKIE, "", { httpOnly: true, secure: secureCookie(), sameSite: "strict", path: "/", maxAge: 0 });
}
