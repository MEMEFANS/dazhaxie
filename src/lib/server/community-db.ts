import "server-only";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readOperationalSettings } from "./admin-db";
import { adminDataDirectory } from "./admin-db";
import { AdminRequestError } from "./admin-session";
import { SUPPORT_CATEGORIES } from "../support";

type Row = Record<string, unknown>;
interface Statement {
  get(...values: Array<string | number | null>): Row | undefined;
  all(...values: Array<string | number | null>): Row[];
  run(...values: Array<string | number | null>): unknown;
}
interface Database { exec(sql: string): void; prepare(sql: string): Statement }

const cache = globalThis as typeof globalThis & { cabiCommunityDb?: { file: string; db: Database } };

export function communityDatabase() {
  const file = path.join(adminDataDirectory(), "community.sqlite");
  if (cache.cabiCommunityDb?.file === file) return cache.cabiCommunityDb.db;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS community_members (
      address TEXT PRIMARY KEY, name TEXT NOT NULL, joined_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', official INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS community_admins (
      address TEXT PRIMARY KEY, name TEXT NOT NULL, appointed_at INTEGER NOT NULL, appointed_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS community_kicks (
      id TEXT PRIMARY KEY, address TEXT NOT NULL, name TEXT NOT NULL, joined_at INTEGER NOT NULL,
      at INTEGER NOT NULL, operator TEXT NOT NULL, by TEXT NOT NULL, reason TEXT
    );
    CREATE INDEX IF NOT EXISTS community_kicks_address ON community_kicks(address, at DESC);
    CREATE TABLE IF NOT EXISTS community_logs (
      id TEXT PRIMARY KEY, action TEXT NOT NULL, operator TEXT NOT NULL,
      target TEXT NOT NULL, target_name TEXT NOT NULL, at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS community_logs_at ON community_logs(at DESC);
    CREATE TABLE IF NOT EXISTS community_messages (
      id TEXT PRIMARY KEY, address TEXT NOT NULL, name TEXT NOT NULL,
      text TEXT NOT NULL, blocked INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS community_messages_at ON community_messages(at DESC);
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY, address TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL,
      content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tickets_owner ON tickets(address, created_at DESC);
    CREATE INDEX IF NOT EXISTS tickets_status ON tickets(status, updated_at DESC);
    CREATE TABLE IF NOT EXISTS ticket_replies (
      id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, author TEXT NOT NULL,
      role TEXT NOT NULL, content TEXT NOT NULL, at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ticket_replies_ticket ON ticket_replies(ticket_id, at ASC);
    CREATE TABLE IF NOT EXISTS community_challenges (
      id TEXT PRIMARY KEY, address TEXT NOT NULL, chain_id INTEGER NOT NULL, origin TEXT NOT NULL,
      message TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS community_sessions (
      token_hash TEXT PRIMARY KEY, address TEXT NOT NULL, chain_id INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
  `);
  cache.cabiCommunityDb = { file, db };
  seedCommunity(db);
  return db;
}

// 仅在库为空时导入可选种子（CABI_COMMUNITY_SEED / CABI_OFFICIAL_ADDRESS）。
// 支持两种格式：成员数组，或 { official, admins, members } 对象；仅演示用，不写入真实用户。
function seedCommunity(db: Database) {
  const members = Number(db.prepare("SELECT COUNT(*) AS count FROM community_members").get()?.count || 0);
  const admins = Number(db.prepare("SELECT COUNT(*) AS count FROM community_admins").get()?.count || 0);
  if (members > 0 && admins > 0) return;
  const now = Date.now();
  let official = process.env.CABI_OFFICIAL_ADDRESS?.trim().toLowerCase() || "";
  let memberEntries: Array<{ address?: string; name?: string; official?: boolean }> = [];
  let adminEntries: Array<{ address?: string; name?: string }> = [];
  const raw = process.env.CABI_COMMUNITY_SEED?.trim();
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        memberEntries = parsed as Array<{ address?: string; name?: string; official?: boolean }>;
      } else if (parsed && typeof parsed === "object") {
        const object = parsed as Record<string, unknown>;
        if (Array.isArray(object.members)) memberEntries = object.members as Array<{ address?: string; name?: string; official?: boolean }>;
        if (Array.isArray(object.admins)) adminEntries = object.admins as Array<{ address?: string; name?: string }>;
        if (typeof object.official === "string") official = object.official.trim().toLowerCase();
      }
    } catch {
      // 种子格式错误时保持空库，不影响真实服务。
    }
  }
  const insertMember = db.prepare("INSERT OR IGNORE INTO community_members(address,name,joined_at,status,official,created_at) VALUES(?,?,?, 'active',?,?)");
  if (members === 0) {
    if (/^0x[0-9a-f]{40}$/.test(official)) insertMember.run(official, `官方 ${official.slice(0, 6)}…${official.slice(-4)}`, now, 1, now);
    for (const entry of memberEntries) {
      const address = entry.address?.toLowerCase() || "";
      if (!/^0x[0-9a-f]{40}$/.test(address)) continue;
      const name = (entry.name || `成员 ${address.slice(0, 6)}…${address.slice(-4)}`).slice(0, 32);
      insertMember.run(address, name, now, entry.official ? 1 : 0, now);
    }
  }
  if (admins === 0) {
    const insertAdmin = db.prepare("INSERT OR IGNORE INTO community_admins(address,name,appointed_at,appointed_by) VALUES(?,?,?, 'seed')");
    for (const entry of adminEntries) {
      const address = entry.address?.toLowerCase() || "";
      if (!/^0x[0-9a-f]{40}$/.test(address)) continue;
      const name = (entry.name || `管理员 ${address.slice(0, 6)}…${address.slice(-4)}`).slice(0, 32);
      insertMember.run(address, name, now, address === official ? 1 : 0, now);
      insertAdmin.run(address, name, now);
    }
  }
}

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/* ---------- 成员 ---------- */

export interface MemberRecord {
  address: string; name: string; joinedAt: number; status: "active" | "kicked"; official: boolean; isAdmin: boolean;
}
function mapMember(row: Row, adminSet: Set<string>): MemberRecord {
  return {
    address: String(row.address), name: String(row.name), joinedAt: Number(row.joined_at),
    status: row.status === "kicked" ? "kicked" : "active", official: row.official === 1,
    isAdmin: adminSet.has(String(row.address)),
  };
}
function adminAddresses(): Set<string> {
  return new Set(communityDatabase().prepare("SELECT address FROM community_admins").all().map(row => String(row.address)));
}
export function findMember(address: string) {
  const row = communityDatabase().prepare("SELECT * FROM community_members WHERE address=?").get(address.toLowerCase());
  return row ? mapMember(row, adminAddresses()) : null;
}
export function memberStatus(address: string): "active" | "kicked" | "none" {
  const row = communityDatabase().prepare("SELECT status FROM community_members WHERE address=?").get(address.toLowerCase());
  return row ? (row.status === "kicked" ? "kicked" : "active") : "none";
}
/** 钱包首次签名登录时登记为社群成员；已被移出的地址保持禁言状态，不自动恢复。 */
export function ensureMember(address: string) {
  const key = address.toLowerCase();
  const db = communityDatabase();
  db.prepare("INSERT OR IGNORE INTO community_members(address,name,joined_at,status,official,created_at) VALUES(?,?,?, 'active',0,?)")
    .run(key, short(key), Date.now(), Date.now());
  return findMember(key)!;
}
export function setMemberName(address: string, name: string) {
  const value = name.trim().slice(0, 32);
  if (!value) throw new AdminRequestError("昵称不能为空", 400);
  const db = communityDatabase(), key = address.toLowerCase();
  const result = db.prepare("UPDATE community_members SET name=? WHERE address=?").run(value, key);
  if (!(result as { changes: number }).changes) throw new AdminRequestError("成员不存在", 404);
  db.prepare("UPDATE community_admins SET name=? WHERE address=?").run(value, key);
}
export function listMembers(options: { q?: string; status?: "active" | "kicked"; page?: number; pageSize?: number } = {}) {
  const db = communityDatabase(), adminSet = adminAddresses();
  const page = Math.max(1, Math.floor(options.page || 1)), pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize || 20)));
  const clauses = ["status = ?"], params: Array<string | number> = [options.status || "active"];
  const q = options.q?.trim().toLowerCase();
  if (q) { clauses.push("(address LIKE ? OR name LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }
  const where = clauses.join(" AND ");
  const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM community_members WHERE ${where}`).get(...params)?.count || 0);
  const rows = db.prepare(`SELECT * FROM community_members WHERE ${where} ORDER BY joined_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  return { items: rows.map(row => mapMember(row, adminSet)), total, page, pageSize };
}
export function listAdmins() {
  return communityDatabase().prepare("SELECT * FROM community_admins ORDER BY appointed_at DESC").all()
    .map(row => ({ address: String(row.address), name: String(row.name), at: Number(row.appointed_at), by: String(row.appointed_by) }));
}
export function listKicked() {
  return communityDatabase().prepare("SELECT * FROM community_kicks ORDER BY at DESC LIMIT 100").all()
    .map(row => ({
      id: String(row.id), address: String(row.address), name: String(row.name), joinedAt: Number(row.joined_at),
      at: Number(row.at), operator: String(row.operator), by: String(row.by), reason: row.reason ? String(row.reason) : "",
    }));
}
export function communityStats() {
  const db = communityDatabase();
  const active = Number(db.prepare("SELECT COUNT(*) AS count FROM community_members WHERE status='active'").get()?.count || 0);
  const kicked = Number(db.prepare("SELECT COUNT(*) AS count FROM community_members WHERE status='kicked'").get()?.count || 0);
  const admins = Number(db.prepare("SELECT COUNT(*) AS count FROM community_admins").get()?.count || 0);
  const tickets = Number(db.prepare("SELECT COUNT(*) AS count FROM tickets WHERE status='pending'").get()?.count || 0);
  return { active, kicked, admins, pendingTickets: tickets };
}
export function memberAddresses(): string[] {
  return communityDatabase().prepare("SELECT address FROM community_members").all().map(row => String(row.address));
}

/* ---------- 日志 ---------- */

export type ModAction = "appoint" | "revoke" | "kick" | "restore";
function writeLog(action: ModAction, operator: string, target: string, targetName: string) {
  communityDatabase().prepare("INSERT INTO community_logs(id,action,operator,target,target_name,at) VALUES(?,?,?,?,?,?)")
    .run(randomUUID(), action, operator, target.toLowerCase(), targetName, Date.now());
}
export function listLogs(options: { page?: number; pageSize?: number; action?: string } = {}) {
  const db = communityDatabase(), page = Math.max(1, Math.floor(options.page || 1)), pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize || 20)));
  const action = options.action && ["appoint", "revoke", "kick", "restore"].includes(options.action) ? options.action : "";
  const where = action ? "WHERE action=?" : "", params = action ? [action] : [];
  const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM community_logs ${where}`).get(...params)?.count || 0);
  const rows = db.prepare(`SELECT * FROM community_logs ${where} ORDER BY at DESC, rowid DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  return {
    items: rows.map(row => ({ id: String(row.id), action: String(row.action) as ModAction, operator: String(row.operator), target: String(row.target), targetName: String(row.target_name), at: Number(row.at) })), total, page, pageSize,
  };
}

/* ---------- 管理动作 ---------- */

export function appointAdmin(address: string, operator: string) {
  const member = findMember(address);
  if (!member) throw new AdminRequestError("该地址不是社群成员", 404);
  if (member.official) throw new AdminRequestError("官方账号默认具备管理能力，无需设置", 400);
  if (member.status !== "active") throw new AdminRequestError("该成员已被移出社群，请先恢复", 409);
  if (member.isAdmin) throw new AdminRequestError("该成员已是群管理员", 409);
  communityDatabase().prepare("INSERT INTO community_admins(address,name,appointed_at,appointed_by) VALUES(?,?,?,?)")
    .run(member.address, member.name, Date.now(), operator);
  writeLog("appoint", operator, member.address, member.name);
  return findMember(member.address)!;
}
export function revokeAdmin(address: string, operator: string) {
  const member = findMember(address);
  if (!member?.isAdmin) throw new AdminRequestError("该地址不是群管理员", 404);
  communityDatabase().prepare("DELETE FROM community_admins WHERE address=?").run(member.address);
  writeLog("revoke", operator, member.address, member.name);
  return findMember(member.address)!;
}
export function kickMemberByPanel(address: string, operator: string, reason = "") {
  const member = findMember(address);
  if (!member) throw new AdminRequestError("该地址不是社群成员", 404);
  if (member.official) throw new AdminRequestError("官方账号不可移出", 403);
  if (member.status !== "active") throw new AdminRequestError("该成员已被移出社群", 409);
  const db = communityDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE community_members SET status='kicked' WHERE address=?").run(member.address);
    db.prepare("DELETE FROM community_admins WHERE address=?").run(member.address);
    db.prepare("INSERT INTO community_kicks(id,address,name,joined_at,at,operator,by,reason) VALUES(?,?,?,?,?,?, 'admin-panel',?)")
      .run(randomUUID(), member.address, member.name, member.joinedAt, Date.now(), operator, reason.trim().slice(0, 200) || null);
    writeLog("kick", operator, member.address, member.name);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return findMember(member.address)!;
}
export function kickMemberByGroup(address: string, actor: string) {
  const member = findMember(address), admin = findMember(actor);
  if (!member) throw new AdminRequestError("该用户已不在社群成员列表中", 404);
  if (member.official) throw new AdminRequestError("官方账号不可移出", 403);
  if (member.status !== "active") throw new AdminRequestError("该成员已被移出社群", 409);
  if (!admin?.isAdmin || admin.status !== "active") throw new AdminRequestError("仅群管理员可移出成员", 403);
  if (member.address === admin.address) throw new AdminRequestError("不能移出自己", 403);
  if (member.isAdmin) throw new AdminRequestError("不能移出其他群管理员，请先在后台撤销其权限", 403);
  const db = communityDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE community_members SET status='kicked' WHERE address=?").run(member.address);
    db.prepare("INSERT INTO community_kicks(id,address,name,joined_at,at,operator,by,reason) VALUES(?,?,?,?,?,?, 'group-admin',NULL)")
      .run(randomUUID(), member.address, member.name, member.joinedAt, Date.now(), `群管理员 ${short(admin.address)}`);
    writeLog("kick", `群管理员 ${short(admin.address)}`, member.address, member.name);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return findMember(member.address)!;
}
export function restoreMember(address: string, operator: string) {
  const member = findMember(address);
  if (!member) throw new AdminRequestError("该地址不是社群成员", 404);
  if (member.status !== "kicked") throw new AdminRequestError("该成员当前未被移出", 409);
  communityDatabase().prepare("UPDATE community_members SET status='active' WHERE address=?").run(member.address);
  writeLog("restore", operator, member.address, member.name);
  return findMember(member.address)!;
}

/* ---------- 社群消息 ---------- */

export interface MessageRecord { id: string; address: string; name: string; text: string; blocked: boolean; at: number }
function sensitiveWords() {
  try { return readOperationalSettings().sensitiveWords; } catch { return [] as string[]; }
}
function containsSensitive(text: string) {
  const lower = text.toLowerCase();
  return sensitiveWords().some(word => lower.includes(word.toLowerCase()));
}
export function listMessages(limit = 80): MessageRecord[] {
  return communityDatabase().prepare("SELECT * FROM community_messages ORDER BY at DESC, rowid DESC LIMIT ?").all(Math.min(200, Math.max(1, limit)))
    .reverse()
    .map(row => ({ id: String(row.id), address: String(row.address), name: String(row.name), text: String(row.text), blocked: row.blocked === 1, at: Number(row.at) }));
}
export function createMessage(address: string, text: string): MessageRecord {
  const member = findMember(address);
  if (!member || member.status !== "active") throw new AdminRequestError("你已被移出社群，暂时无法发言", 403);
  const content = text.trim();
  if (!content || content.length > 200) throw new AdminRequestError("消息需为 1–200 字", 400);
  const db = communityDatabase(), now = Date.now();
  const recent = db.prepare("SELECT COUNT(*) AS count FROM community_messages WHERE address=? AND at>?").get(member.address, now - 10_000);
  if (Number(recent?.count || 0) >= 5) throw new AdminRequestError("发言过于频繁，请稍后重试", 429);
  const blocked = containsSensitive(content);
  const id = randomUUID();
  db.prepare("INSERT INTO community_messages(id,address,name,text,blocked,at) VALUES(?,?,?,?,?,?)")
    .run(id, member.address, member.name, blocked ? "[内容包含违规词汇，已被系统自动屏蔽]" : content, blocked ? 1 : 0, now);
  return { id, address: member.address, name: member.name, text: blocked ? "[内容包含违规词汇，已被系统自动屏蔽]" : content, blocked, at: now };
}

/* ---------- 客服工单 ---------- */

export type TicketStatus = "pending" | "processed" | "closed";
export interface TicketReplyRecord { id: string; author: string; role: "support" | "user"; content: string; at: number }
export interface TicketRecord {
  id: string; address: string; category: string; title: string; content: string;
  status: TicketStatus; createdAt: number; updatedAt: number; replies: TicketReplyRecord[];
}
const TICKET_STATUS_LABEL: Record<TicketStatus, string> = { pending: "待处理", processed: "已处理", closed: "已完结" };
export const TICKET_STATUSES = TICKET_STATUS_LABEL;
const CATEGORIES = SUPPORT_CATEGORIES;
function mapTicket(row: Row, replies: TicketReplyRecord[]): TicketRecord {
  return {
    id: String(row.id), address: String(row.address), category: String(row.category), title: String(row.title),
    content: String(row.content), status: (["pending", "processed", "closed"].includes(String(row.status)) ? String(row.status) : "pending") as TicketStatus,
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), replies,
  };
}
function repliesOf(ticketId: string): TicketReplyRecord[] {
  return communityDatabase().prepare("SELECT * FROM ticket_replies WHERE ticket_id=? ORDER BY at ASC, rowid ASC").all(ticketId)
    .map(row => ({ id: String(row.id), author: String(row.author), role: row.role === "user" ? "user" as const : "support" as const, content: String(row.content), at: Number(row.at) }));
}
export function createTicket(address: string, input: { category?: unknown; title?: unknown; content?: unknown }, orderSummary?: string) {
  const key = address.toLowerCase();
  if (memberStatus(key) === "none") ensureMember(key);
  const category = typeof input.category === "string" && CATEGORIES.includes(input.category) ? input.category : null;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (!category) throw new AdminRequestError("请选择有效的问题分类", 400);
  if (title.length < 1 || title.length > 40) throw new AdminRequestError("标题需为 1–40 字", 400);
  if (content.length < 1 || content.length > 300) throw new AdminRequestError("问题详情需为 1–300 字", 400);
  if (containsSensitive(`${title}\n${content}`)) throw new AdminRequestError("内容包含敏感词，请修改后重新提交", 400);
  const db = communityDatabase(), now = Date.now();
  const recent = db.prepare("SELECT COUNT(*) AS count FROM tickets WHERE address=? AND created_at>?").get(key, now - 60_000);
  if (Number(recent?.count || 0) >= 5) throw new AdminRequestError("提交过于频繁，请稍后重试", 429);
  const id = `T${now.toString(36).toUpperCase()}${randomUUID().slice(0, 6).toUpperCase()}`;
  db.prepare("INSERT INTO tickets(id,address,category,title,content,status,created_at,updated_at) VALUES(?,?,?,?,?, 'pending',?,?)")
    .run(id, key, category, title, orderSummary ? `${orderSummary}\n\n${content}` : content, now, now);
  return mapTicket(db.prepare("SELECT * FROM tickets WHERE id=?").get(id)!, []);
}
export function listTicketsFor(address: string) {
  const rows = communityDatabase().prepare("SELECT * FROM tickets WHERE address=? ORDER BY created_at DESC LIMIT 100").all(address.toLowerCase());
  return rows.map(row => mapTicket(row, repliesOf(String(row.id))));
}
export function listTickets(options: { status?: string; q?: string; page?: number; pageSize?: number } = {}) {
  const db = communityDatabase(), page = Math.max(1, Math.floor(options.page || 1)), pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize || 20)));
  const clauses: string[] = [], params: Array<string | number> = [];
  if (options.status && ["pending", "processed", "closed", "all"].includes(options.status) && options.status !== "all") { clauses.push("status=?"); params.push(options.status); }
  const q = options.q?.trim().toLowerCase();
  if (q) { clauses.push("(address LIKE ? OR title LIKE ? OR id LIKE ? OR content LIKE ?)"); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM tickets ${where}`).get(...params)?.count || 0);
  const rows = db.prepare(`SELECT * FROM tickets ${where} ORDER BY updated_at DESC, created_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  return { items: rows.map(row => mapTicket(row, repliesOf(String(row.id)))), total, page, pageSize };
}
export function countPendingTickets() {
  return Number(communityDatabase().prepare("SELECT COUNT(*) AS count FROM tickets WHERE status='pending'").get()?.count || 0);
}
export function replyToTicket(id: string, author: string, content: string) {
  const ticket = communityDatabase().prepare("SELECT * FROM tickets WHERE id=?").get(id);
  if (!ticket) throw new AdminRequestError("工单不存在", 404);
  if (ticket.status === "closed") throw new AdminRequestError("工单已完结，不能再回复", 409);
  const text = content.trim();
  if (!text || text.length > 300) throw new AdminRequestError("回复需为 1–300 字", 400);
  const now = Date.now(), db = communityDatabase();
  db.prepare("INSERT INTO ticket_replies(id,ticket_id,author,role,content,at) VALUES(?,?,?, 'support',?,?)").run(randomUUID(), id, author, text, now);
  db.prepare("UPDATE tickets SET updated_at=? WHERE id=?").run(now, id);
  return mapTicket(db.prepare("SELECT * FROM tickets WHERE id=?").get(id)!, repliesOf(id));
}
export function setTicketStatus(id: string, status: TicketStatus) {
  const ticket = communityDatabase().prepare("SELECT * FROM tickets WHERE id=?").get(id);
  if (!ticket) throw new AdminRequestError("工单不存在", 404);
  const current = String(ticket.status) as TicketStatus;
  const allowed: Record<TicketStatus, TicketStatus[]> = { pending: ["processed", "closed"], processed: ["closed"], closed: [] };
  if (!allowed[current].includes(status)) throw new AdminRequestError(`不能从「${TICKET_STATUS_LABEL[current]}」流转到「${TICKET_STATUS_LABEL[status]}」`, 409);
  communityDatabase().prepare("UPDATE tickets SET status=?, updated_at=? WHERE id=?").run(status, Date.now(), id);
  return mapTicket(communityDatabase().prepare("SELECT * FROM tickets WHERE id=?").get(id)!, repliesOf(id));
}
