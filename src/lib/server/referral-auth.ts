import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { verifyMessage, type Address, type Hex } from "viem";
import { chainConfig } from "../chain-config";
import { AdminRequestError } from "./admin-session";
import { referralAddress, referralDatabase, bindReferral } from "./referral-db";
import { parseInvitation } from "../referral";
import { secureCookie } from "./cookie-security";
const COOKIE = "cabi_referral_wallet";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const originOf = (request: Request) => process.env.APP_ORIGIN || new URL(request.url).origin;
export function createReferralChallenge(request: Request, input: unknown, codeInput?: unknown) {
  const address = referralAddress(input), db = referralDatabase(), now = Date.now(), origin = originOf(request);
  // 可选邀请码：随签名一并绑定；格式先校验，存在性在 verify 绑定时校验
  const code = typeof codeInput === "string" && codeInput.trim() ? parseInvitation(codeInput) : undefined;
  if (codeInput !== undefined && String(codeInput).trim() && !code) throw new AdminRequestError("请输入有效的 8 位邀请码",400);
  db.prepare("DELETE FROM referral_challenges WHERE expires_at<=?").run(now);
  const recent = db.prepare("SELECT COUNT(*) AS count FROM referral_challenges WHERE address=? AND created_at>?").get(address,now-60_000);
  if (Number(recent?.count) >= 5) throw new AdminRequestError("签名请求过于频繁，请稍后重试",429);
  const id = randomBytes(24).toString("hex"), expiresAt=now+5*60_000;
  // 展示层极简（Axie 风格）：仅邀请码 + 短编号；防重放依赖服务端存储的完整挑战记录
  const serial = randomBytes(4).toString("hex").toUpperCase();
  const message = code ? `CaBi 绑定邀请码 ${code}\n编号 ${serial}` : `CaBi 登录\n编号 ${serial}`;
  db.prepare("INSERT INTO referral_challenges(id,address,chain_id,origin,message,code,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)").run(id,address,chainConfig.id,origin,message,code??null,now,expiresAt);
  return { id,message,address,chainId:chainConfig.id,expiresAt };
}
export async function verifyReferralChallenge(request: Request, id: unknown, signature: unknown) {
  if (typeof id !== "string" || !/^[a-f0-9]{48}$/.test(id) || typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new AdminRequestError("签名格式有误",400);
  const db = referralDatabase(), row = db.prepare("SELECT * FROM referral_challenges WHERE id=?").get(id);
  if (!row || Number(row.expires_at)<=Date.now() || row.origin!==originOf(request) || Number(row.chain_id)!==chainConfig.id) throw new AdminRequestError("登录请求已失效，请重试",401);
  let valid = false;
  try { valid = await verifyMessage({ address: String(row.address) as Address, message:String(row.message), signature:signature as Hex }); } catch { /* Fail closed. */ }
  if (!valid) throw new AdminRequestError("钱包身份签名验证失败",401);
  const consumed = db.prepare("DELETE FROM referral_challenges WHERE id=? AND expires_at>?").run(id,Date.now()) as {changes:number};
  if (!consumed.changes) throw new AdminRequestError("登录请求已使用或过期",401);
  // 挑战携带邀请码时，签名一次同时完成绑定；绑定失败则不建立会话
  if (typeof row.code === "string" && row.code) bindReferral(String(row.address), row.code);
  const token=randomBytes(32).toString("hex"),expiresAt=Date.now()+8*60*60_000;
  db.prepare("DELETE FROM referral_sessions WHERE expires_at<=?").run(Date.now());
  db.prepare("INSERT INTO referral_sessions(token_hash,address,chain_id,expires_at) VALUES(?,?,?,?)").run(hash(token),String(row.address),chainConfig.id,expiresAt);
  (await cookies()).set(COOKIE,token,{httpOnly:true,secure:secureCookie(),sameSite:"strict",path:"/",maxAge:8*60*60});
  return {address:String(row.address),chainId:chainConfig.id,expiresAt};
}
export async function currentReferralWallet() {
  await connection();
  const token=(await cookies()).get(COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row=referralDatabase().prepare("SELECT address,chain_id,expires_at FROM referral_sessions WHERE token_hash=? AND expires_at>?").get(hash(token),Date.now());
  return row && Number(row.chain_id)===chainConfig.id ? {address:String(row.address),chainId:chainConfig.id,expiresAt:Number(row.expires_at)} : null;
}
export async function requireReferralWallet() {
  const session=await currentReferralWallet();
  if (!session) throw new AdminRequestError("请先免费签名登录",401);
  return session;
}
export async function logoutReferralWallet() {
  const jar=await cookies(),token=jar.get(COOKIE)?.value;
  if(token)referralDatabase().prepare("DELETE FROM referral_sessions WHERE token_hash=?").run(hash(token));
  jar.set(COOKIE,"",{httpOnly:true,secure:secureCookie(),sameSite:"strict",path:"/",maxAge:0});
}
