import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { adminDataDirectory } from "./admin-db";
import { AdminRequestError } from "./admin-session";
import type { RedemptionOrder, RedemptionShipping } from "../redemption";

type Row = Record<string, unknown>;
const cache = globalThis as typeof globalThis & { cabiRedemptionDb?: { file: string; db: DatabaseSync } };
export function redemptionSecret() {
  const secret = process.env.REDEMPTION_DATA_SECRET || process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new AdminRequestError("兑换服务尚未配置加密密钥", 503);
  return secret;
}
function encryptionKey() { return createHash("sha256").update(`cabi-redemption-shipping-v1:${redemptionSecret()}`).digest(); }
function encrypt(shipping: RedemptionShipping, id: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(id));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(shipping), "utf8"), cipher.final()]);
  return `${iv.toString("hex")}.${cipher.getAuthTag().toString("hex")}.${encrypted.toString("hex")}`;
}
function decrypt(value: string, id: string): RedemptionShipping {
  const [iv, tag, encrypted] = value.split("."), decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "hex"));
  decipher.setAAD(Buffer.from(id)); decipher.setAuthTag(Buffer.from(tag, "hex"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, "hex")), decipher.final()]).toString("utf8"));
}
export function redemptionDatabase() {
  const file = path.join(adminDataDirectory(), "redemption.sqlite");
  if (cache.cabiRedemptionDb?.file === file) return cache.cabiRedemptionDb.db;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS wallet_challenges (id TEXT PRIMARY KEY,address TEXT NOT NULL,chain_id INTEGER NOT NULL,origin TEXT NOT NULL,message TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS wallet_sessions (token_hash TEXT PRIMARY KEY,address TEXT NOT NULL,chain_id INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS redemption_orders (id TEXT PRIMARY KEY,address TEXT NOT NULL,chain_id INTEGER NOT NULL,contract TEXT NOT NULL,payee TEXT NOT NULL DEFAULT '',note TEXT,quantity INTEGER NOT NULL,amount TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,paid_at INTEGER,tx_hash TEXT UNIQUE,shipping TEXT NOT NULL,carrier TEXT,tracking_number TEXT,shipped_at INTEGER);
    CREATE INDEX IF NOT EXISTS redemption_owner_idx ON redemption_orders(address,chain_id,created_at);
  `);
  // 旧库补齐「下单时锁定的收款地址」与后台备注；历史行的收款地址回填自原合约字段。
  try { db.exec("ALTER TABLE redemption_orders ADD COLUMN payee TEXT NOT NULL DEFAULT ''"); } catch { /* 列已存在 */ }
  try { db.exec("ALTER TABLE redemption_orders ADD COLUMN note TEXT"); } catch { /* 列已存在 */ }
  db.prepare("UPDATE redemption_orders SET payee = contract WHERE payee = ''").run();
  cache.cabiRedemptionDb = { file, db }; return db;
}
function order(row: Row): RedemptionOrder {
  return { id: String(row.id), address: String(row.address), chainId: Number(row.chain_id), payee: String(row.payee || row.contract || ""),
    quantity: Number(row.quantity), amount: String(row.amount), status: row.status as RedemptionOrder["status"], createdAt: Number(row.created_at),
    ...(row.paid_at ? { paidAt: Number(row.paid_at) } : {}), ...(row.tx_hash ? { transactionHash: String(row.tx_hash) as `0x${string}` } : {}),
    shipping: decrypt(String(row.shipping), String(row.id)), ...(row.carrier ? { carrier: String(row.carrier) } : {}),
    ...(row.tracking_number ? { trackingNumber: String(row.tracking_number) } : {}), ...(row.shipped_at ? { shippedAt: Number(row.shipped_at) } : {}),
    ...(row.note ? { note: String(row.note) } : {}) };
}
export function readRedemptionOrder(id: string, address?: string) {
  const row = address ? redemptionDatabase().prepare("SELECT * FROM redemption_orders WHERE id=? AND address=?").get(id, address.toLowerCase())
    : redemptionDatabase().prepare("SELECT * FROM redemption_orders WHERE id=?").get(id);
  return row ? order(row) : null;
}
export function listRedemptionOrders(address?: string, chainId?: number) {
  const db = redemptionDatabase();
  const rows = address ? db.prepare("SELECT * FROM redemption_orders WHERE address=? AND chain_id=? AND status!='draft' ORDER BY created_at DESC LIMIT 100").all(address.toLowerCase(), chainId!)
    : db.prepare("SELECT * FROM redemption_orders WHERE status!='draft' ORDER BY created_at DESC LIMIT 200").all();
  return rows.map(order);
}
// 转账已核验后才落单，订单直接进入「待发货」；同一笔转账只能绑定一张兑换单。
export function createRedemptionOrder(input: {
  address: string; chainId: number; payee: string; quantity: number; amount: string; transactionHash: string; shipping: RedemptionShipping;
}) {
  const db = redemptionDatabase(), now = Date.now();
  const recent = db.prepare("SELECT COUNT(*) AS count FROM redemption_orders WHERE address=? AND created_at>?").get(input.address.toLowerCase(), now - 60_000);
  if (Number(recent?.count) >= 5) throw new AdminRequestError("创建订单过于频繁，请稍后重试", 429);
  const id = `${input.address.toLowerCase()}${randomBytes(12).toString("hex")}`;
  try {
    db.prepare("INSERT INTO redemption_orders(id,address,chain_id,contract,payee,quantity,amount,status,created_at,paid_at,tx_hash,shipping) VALUES(?,?,?,?,?,?,?, 'paid',?,?,?,?)")
      .run(id, input.address.toLowerCase(), input.chainId, input.payee.toLowerCase(), input.payee, input.quantity, input.amount, now, now, input.transactionHash.toLowerCase(), encrypt(input.shipping, id));
  } catch {
    throw new AdminRequestError("该笔转账已提交过兑换单，请勿重复提交", 409);
  }
  return readRedemptionOrder(id, input.address)!;
}
export function updateRedemptionNote(id: string, note: string) {
  const result = redemptionDatabase().prepare("UPDATE redemption_orders SET note=? WHERE id=?").run(note || null, id) as { changes: number };
  if (!result.changes) throw new AdminRequestError("兑换单不存在", 404);
  return readRedemptionOrder(id)!;
}
export function shipRedemptionOrder(id: string, carrier: string, trackingNumber: string) {
  const result = redemptionDatabase().prepare("UPDATE redemption_orders SET status='shipped',carrier=?,tracking_number=?,shipped_at=? WHERE id=? AND status='paid'").run(carrier, trackingNumber, Date.now(), id) as {changes:number};
  if (!result.changes) throw new AdminRequestError("仅已确认付款且未发货的订单可发货", 409);
  return readRedemptionOrder(id)!;
}
export function deliverRedemptionOrder(id: string, address: string) {
  const result = redemptionDatabase().prepare("UPDATE redemption_orders SET status='delivered' WHERE id=? AND address=? AND status='shipped'").run(id, address.toLowerCase()) as {changes:number};
  if (!result.changes) throw new AdminRequestError("只有本人已发货订单可确认收货", 409);
  return readRedemptionOrder(id, address)!;
}
export function redemptionAddresses(): string[] {
  return redemptionDatabase().prepare("SELECT DISTINCT address FROM redemption_orders WHERE status!='draft'").all().map(row => String(row.address));
}
// 后台订单检索：地址 / 状态 / 下单时间范围 + 分页。状态机保持简单：待发货→已发货→已完结，待发货→已取消。
export function searchRedemptionOrders(options: { q?: string; status?: string; from?: number; to?: number; page?: number; pageSize?: number } = {}) {
  const db = redemptionDatabase(), page = Math.max(1, Math.floor(options.page || 1)), pageSize = Math.min(500, Math.max(1, Math.floor(options.pageSize || 20)));
  const clauses = ["status!='draft'"], params: Array<string | number> = [];
  if (options.status && ["paid", "shipped", "delivered", "cancelled"].includes(options.status)) { clauses.push("status=?"); params.push(options.status); }
  const q = options.q?.trim().toLowerCase();
  if (q) { clauses.push("(address LIKE ? OR id LIKE ? OR shipping LIKE ? OR note LIKE ?)"); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  if (options.from) { clauses.push("created_at>=?"); params.push(options.from); }
  if (options.to) { clauses.push("created_at<=?"); params.push(options.to); }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM redemption_orders ${where}`).get(...params)?.count || 0);
  const rows = db.prepare(`SELECT * FROM redemption_orders ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  return { items: rows.map(order), total, page, pageSize };
}
// 仅未发货订单允许取消（退款线下处理），取消原因与操作者写入备注与审计。
export function cancelRedemptionOrder(id: string, reason: string) {
  const result = redemptionDatabase().prepare("UPDATE redemption_orders SET status='cancelled', note=? WHERE id=? AND status='paid'").run(reason.trim().slice(0, 200) || null, id) as { changes: number };
  if (!result.changes) throw new AdminRequestError("仅待发货订单可取消", 409);
  return readRedemptionOrder(id)!;
}
