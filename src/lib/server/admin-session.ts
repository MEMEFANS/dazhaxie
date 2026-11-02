import "server-only";
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { addAuditEntry, createStoredSession, deleteStoredSession, readStoredSession } from "./admin-db";
import { secureCookie } from "./cookie-security";

const deriveKey = promisify(scrypt);
const COOKIE = "cabi_admin_session";
const SESSION_SECONDS = 8 * 60 * 60;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
function configuration() {
  const account = process.env.ADMIN_USERNAME?.trim(), passwordHash = process.env.ADMIN_PASSWORD_HASH, secret = process.env.ADMIN_SESSION_SECRET;
  if (!account || !passwordHash || !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(passwordHash) || !secret || secret.length < 32) return null;
  return { account, passwordHash, secret };
}
export function isAdminConfigured() { return configuration() !== null; }
export class AdminRequestError extends Error { constructor(message: string, public status: number) { super(message); } }
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin"), expected = process.env.APP_ORIGIN || new URL(request.url).origin;
  if (!origin || origin !== expected) throw new AdminRequestError("请从本站页面提交操作", 403);
}
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 20_000) throw new AdminRequestError("提交内容过长", 400);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new AdminRequestError("提交内容格式有误", 400); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AdminRequestError("提交内容格式有误", 400);
  return value as Record<string, unknown>;
}
function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
function signature(token: string, secret: string) { return createHmac("sha256", secret).update(token).digest("base64url"); }
function validatedToken(cookie: string | undefined, secret: string): string | null {
  if (!cookie) return null;
  const [token, signed, extra] = cookie.split(".");
  if (!token || !signed || extra || !/^[a-f0-9]{64}$/.test(token)) return null;
  const expected = Buffer.from(signature(token, secret)), actual = Buffer.from(signed);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? token : null;
}
export async function getCurrentAdmin(): Promise<{ account: string; expiresAt: number } | null> {
  // A synchronous SQLite session check is request-specific and must not run in
  // the static shell when Cache Components prerenders the admin routes.
  await connection();
  const cookieValue = (await cookies()).get(COOKIE)?.value;
  const config = configuration();
  if (!config) return null;
  const token = validatedToken(cookieValue, config.secret);
  if (!token) return null;
  const session = readStoredSession(tokenHash(token));
  return session?.account === config.account ? session : null;
}
export async function requireCurrentAdmin() {
  const session = await getCurrentAdmin();
  if (!session) throw new AdminRequestError("登录已失效，请重新登录", 401);
  return session;
}
function checkLoginLimit(request: Request) {
  const key = createHash("sha256").update(request.headers.get("x-forwarded-for") || "local").digest("hex"), now = Date.now();
  for (const [address, entry] of loginAttempts) if (entry.resetAt <= now) loginAttempts.delete(address);
  const entry = loginAttempts.get(key) || { count: 0, resetAt: now + 60_000 };
  if (++entry.count > 10) throw new AdminRequestError("操作过于频繁，请稍后重试", 429);
  loginAttempts.set(key, entry);
}
export async function createAdminSession(request: Request, account: string, password: string) {
  const config = configuration();
  if (!config) throw new AdminRequestError("管理员尚未配置，请先完成服务器初始化", 503);
  checkLoginLimit(request);
  const [, salt, encodedKey] = config.passwordHash.split("$");
  const candidate = await deriveKey(password, Buffer.from(salt, "hex"), 64) as Buffer;
  if (account !== config.account || !timingSafeEqual(candidate, Buffer.from(encodedKey, "hex"))) throw new AdminRequestError("账号或密码错误", 401);
  const token = randomBytes(32).toString("hex"), expiresAt = Date.now() + SESSION_SECONDS * 1000;
  createStoredSession(tokenHash(token), config.account, expiresAt);
  (await cookies()).set(COOKIE, `${token}.${signature(token, config.secret)}`, { httpOnly: true, secure: secureCookie(), sameSite: "lax", path: "/", maxAge: SESSION_SECONDS });
  addAuditEntry(config.account, "登录后台", "已建立管理员会话");
  return { account: config.account, expiresAt };
}
export async function endAdminSession() {
  const config = configuration(), jar = await cookies(), token = config && validatedToken(jar.get(COOKIE)?.value, config.secret);
  if (token) { const session = readStoredSession(tokenHash(token)); deleteStoredSession(tokenHash(token)); if (session) addAuditEntry(session.account, "退出后台", "已结束管理员会话"); }
  jar.set(COOKIE, "", { httpOnly: true, secure: secureCookie(), sameSite: "lax", path: "/", maxAge: 0 });
}
export function adminErrorResponse(error: unknown) {
  return Response.json({ error: error instanceof AdminRequestError ? error.message : "服务暂时不可用，请稍后重试" }, { status: error instanceof AdminRequestError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
}
