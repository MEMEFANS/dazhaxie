import "server-only";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import path from "node:path";
import { getAddress, isAddress, zeroAddress } from "viem";
import { BURN_ADDRESS } from "../constants";
import type { AdminAuditEntry, OperationalSettings } from "../admin-settings";
import type { LiquidityAccessSettings } from "../liquidity-access";

type SqlValue = string | number | null;
interface SqlStatement {
  get(...values: SqlValue[]): Record<string, unknown> | undefined;
  all(...values: SqlValue[]): Record<string, unknown>[];
  run(...values: SqlValue[]): unknown;
}
interface SqlDatabase { exec(sql: string): void; prepare(sql: string): SqlStatement; }
const databaseCache = globalThis as typeof globalThis & { cabiAdminDatabase?: { file: string; db: SqlDatabase } };

export function adminDataDirectory() {
  return process.env.CABI_DATA_DIR ? path.resolve(process.env.CABI_DATA_DIR)
    : process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "CaBi", "admin")
      : path.join(homedir(), ".local", "share", "cabi-admin");
}
function database(): SqlDatabase {
  const file = path.join(adminDataDirectory(), "operations.sqlite");
  if (databaseCache.cabiAdminDatabase?.file === file) return databaseCache.cabiAdminDatabase.db;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // Node 24 provides SQLite; the driver and database remain server-side.
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), subscribe_locked INTEGER NOT NULL, exchange_enabled INTEGER NOT NULL, sensitive_words TEXT NOT NULL, exchange_payee TEXT NOT NULL, subscribe_payee TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS liquidity_access (scope TEXT PRIMARY KEY, enabled INTEGER NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS payment_epochs (chain_id INTEGER PRIMARY KEY, min_block TEXT NOT NULL, reset_at INTEGER NOT NULL);
  `);
  // 旧库缺少收款地址列时补齐；空值统一回落到黑洞地址，避免历史库没有默认收款人。
  try { db.exec("ALTER TABLE settings ADD COLUMN exchange_payee TEXT NOT NULL DEFAULT ''"); } catch { /* 列已存在 */ }
  // 认购改为 USDT 直转后，服务器需要独立保存认购收款地址；旧库补齐空列。
  try { db.exec("ALTER TABLE settings ADD COLUMN subscribe_payee TEXT NOT NULL DEFAULT ''"); } catch { /* 列已存在 */ }
  // 旧库缺少会话创建时间列时补齐，供后台会话列表展示。
  try { db.exec("ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0"); } catch { /* 列已存在 */ }
  db.prepare("INSERT OR IGNORE INTO settings (id, subscribe_locked, exchange_enabled, sensitive_words, exchange_payee, updated_at) VALUES (1, 1, 0, '[]', ?, ?)").run(BURN_ADDRESS, Date.now());
  db.prepare("UPDATE settings SET exchange_payee = ? WHERE id = 1 AND exchange_payee = ''").run(BURN_ADDRESS);
  databaseCache.cabiAdminDatabase = { file, db };
  return db;
}
export function readOperationalSettings(): OperationalSettings {
  const row = database().prepare("SELECT * FROM settings WHERE id = 1").get()!;
  return { subscribeLocked: row.subscribe_locked === 1, exchangeEnabled: row.exchange_enabled === 1,
    sensitiveWords: JSON.parse(String(row.sensitive_words)) as string[], exchangePayee: String(row.exchange_payee),
    subscribePayee: String(row.subscribe_payee || ""),
    updatedAt: Number(row.updated_at) };
}
export function paymentStartBlock(chainId: number): bigint {
  const row = database().prepare("SELECT min_block FROM payment_epochs WHERE chain_id=?").get(chainId);
  if (!row) return 0n;
  const value = String(row.min_block);
  if (!/^\d+$/.test(value)) throw new Error("Payment epoch configuration is invalid");
  return BigInt(value);
}
// Bind each switch to its chain/token/pool. Missing rows preserve the existing
// website policy; chain launch rules still decide whether preparation is possible.
export function readLiquidityAccess(scope: string): LiquidityAccessSettings {
  const row = database().prepare("SELECT * FROM liquidity_access WHERE scope=?").get(scope);
  return row ? { scope, enabled: row.enabled === 1, revision: Number(row.revision), updatedAt: Number(row.updated_at) }
    : { scope, enabled: true, revision: 0, updatedAt: 0 };
}
export function saveLiquidityAccess(scope: string, enabled: boolean, revision: number, actor: string): LiquidityAccessSettings | null {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = readLiquidityAccess(scope);
    if (current.revision !== revision) { db.exec("ROLLBACK"); return null; }
    const updatedAt = Date.now();
    db.prepare("INSERT INTO liquidity_access(scope,enabled,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(scope) DO UPDATE SET enabled=excluded.enabled,revision=excluded.revision,updated_at=excluded.updated_at")
      .run(scope, Number(enabled), revision + 1, updatedAt);
    addAuditEntry(actor, enabled ? "开放网站组 LP" : "暂停网站组 LP", JSON.stringify({ scope, before: current.enabled, after: enabled }));
    db.exec("COMMIT");
    return { scope, enabled, revision: revision + 1, updatedAt };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
export function addAuditEntry(actor: string, action: string, detail: string) {
  database().prepare("INSERT INTO audit (id, actor, action, detail, at) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), actor, action, detail, Date.now());
}
export function readAuditEntries(): AdminAuditEntry[] {
  return database().prepare("SELECT id, actor, action, detail, at FROM audit ORDER BY at DESC, rowid DESC LIMIT 100").all()
    .map(row => ({ id: String(row.id), actor: String(row.actor), action: String(row.action), detail: String(row.detail), at: Number(row.at) }));
}
// 审计日志分页与筛选（操作者 / 动作 / 明细关键字）。
export function readAuditEntriesPage(options: { page?: number; pageSize?: number; q?: string; action?: string } = {}) {
  const db = database(), page = Math.max(1, Math.floor(options.page || 1)), pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize || 20)));
  const clauses: string[] = [], params: Array<string | number> = [];
  const q = options.q?.trim();
  if (q) { clauses.push("(actor LIKE ? OR action LIKE ? OR detail LIKE ?)"); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (options.action?.trim()) { clauses.push("action=?"); params.push(options.action.trim()); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM audit ${where}`).get(...params)?.count || 0);
  const rows = db.prepare(`SELECT id, actor, action, detail, at FROM audit ${where} ORDER BY at DESC, rowid DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  return {
    items: rows.map(row => ({ id: String(row.id), actor: String(row.actor), action: String(row.action), detail: String(row.detail), at: Number(row.at) })), total, page, pageSize,
  };
}
export function listAuditActions(): string[] {
  return database().prepare("SELECT DISTINCT action FROM audit ORDER BY action").all().map(row => String(row.action));
}
// 兑换收款地址必须是合法的非零地址；服务端统一转成校验和格式落库。
export function normalizePayee(value: string): string {
  if (!isAddress(value, { strict: false })) throw new Error("收款地址格式不正确");
  const normalized = getAddress(value.toLowerCase());
  if (normalized.toLowerCase() === zeroAddress) throw new Error("收款地址不能是零地址");
  return normalized;
}

export function saveOperationalSettings(
  settings: Omit<OperationalSettings, "updatedAt" | "exchangePayee" | "subscribePayee"> & { exchangePayee?: string; subscribePayee?: string },
  actor: string,
) {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const before = readOperationalSettings();
    const payee = settings.exchangePayee === undefined ? before.exchangePayee : normalizePayee(settings.exchangePayee);
    const subscribePayee = settings.subscribePayee === undefined ? before.subscribePayee : (settings.subscribePayee.trim() ? normalizePayee(settings.subscribePayee) : "");
    db.prepare("UPDATE settings SET subscribe_locked = ?, exchange_enabled = ?, sensitive_words = ?, exchange_payee = ?, subscribe_payee = ?, updated_at = ? WHERE id = 1")
      .run(Number(settings.subscribeLocked), Number(settings.exchangeEnabled), JSON.stringify(settings.sensitiveWords), payee, subscribePayee, Date.now());
    addAuditEntry(actor, "更新运营设置", JSON.stringify({ subscribeLocked: { before: before.subscribeLocked, after: settings.subscribeLocked },
      exchangeEnabled: { before: before.exchangeEnabled, after: settings.exchangeEnabled }, sensitiveWords: { before: before.sensitiveWords.length, after: settings.sensitiveWords.length } }));
    if (payee !== before.exchangePayee) {
      addAuditEntry(actor, "更新兑换收款地址", JSON.stringify({ before: before.exchangePayee, after: payee }));
    }
    if (subscribePayee !== before.subscribePayee) {
      addAuditEntry(actor, "更新认购收款地址", JSON.stringify({ before: before.subscribePayee || "未设置", after: subscribePayee || "未设置" }));
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return readOperationalSettings();
}
export function createStoredSession(tokenHash: string, account: string, expiresAt: number) {
  const db = database();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  db.prepare("INSERT INTO sessions (token_hash, account, expires_at, created_at) VALUES (?, ?, ?, ?)").run(tokenHash, account, expiresAt, Date.now());
}
export function readStoredSession(tokenHash: string): { account: string; expiresAt: number } | null {
  const row = database().prepare("SELECT account, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?").get(tokenHash, Date.now());
  return row ? { account: String(row.account), expiresAt: Number(row.expires_at) } : null;
}
export function deleteStoredSession(tokenHash: string) { database().prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash); }
// 后台会话列表：仅返回哈希前缀作为可操作 ID，不暴露原始令牌。
export function listStoredSessions() {
  return database().prepare("SELECT token_hash, account, expires_at, created_at FROM sessions WHERE expires_at > ? ORDER BY created_at DESC").all(Date.now())
    .map(row => ({ id: String(row.token_hash).slice(0, 16), account: String(row.account), createdAt: Number(row.created_at), expiresAt: Number(row.expires_at) }));
}
export function deleteStoredSessionById(id: string) {
  const result = database().prepare("DELETE FROM sessions WHERE substr(token_hash, 1, 16) = ?").run(id) as { changes: number };
  return result.changes > 0;
}
