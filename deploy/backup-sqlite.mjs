#!/usr/bin/env node
// CaBi SQLite 一致性备份：使用 VACUUM INTO 生成独立快照，不直接拷贝正在写入的库与 WAL。
// 用法：node deploy/backup-sqlite.mjs [备份根目录]
// 环境变量：CABI_DATA_DIR（数据库目录）、CABI_BACKUP_DIR（备份根目录）、CABI_BACKUP_KEEP（保留份数，默认 14）。

import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const DATABASES = ["operations.sqlite", "referrals.sqlite", "redemption.sqlite", "subscriptions.sqlite", "community.sqlite"];

function resolveDataDirectory() {
  if (process.env.CABI_DATA_DIR) return path.resolve(process.env.CABI_DATA_DIR);
  if (process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, "CaBi", "admin");
  return path.join(homedir(), ".local", "share", "cabi-admin");
}

function timestamp() {
  const now = new Date();
  const pad = value => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function sqlLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function backupDatabase(source, destination) {
  const db = new DatabaseSync(source);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec(`VACUUM INTO ${sqlLiteral(destination)}`);
  } finally {
    db.close();
  }
  if (!existsSync(destination) || statSync(destination).size === 0) {
    throw new Error(`备份文件为空：${destination}`);
  }
  chmodSync(destination, 0o600);
}

function prune(root, keep) {
  const entries = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^\d{8}-\d{6}$/.test(entry.name))
    .map(entry => entry.name)
    .sort();
  const stale = entries.slice(0, Math.max(0, entries.length - keep));
  for (const name of stale) {
    rmSync(path.join(root, name), { recursive: true, force: true });
  }
  return stale;
}

function main() {
  const dataDirectory = resolveDataDirectory();
  const root = path.resolve(process.argv[2] || process.env.CABI_BACKUP_DIR || path.join(homedir(), "cabi-backups"));
  const keep = Number(process.env.CABI_BACKUP_KEEP || 14);
  if (!Number.isInteger(keep) || keep < 1) throw new Error("CABI_BACKUP_KEEP 必须是大于 0 的整数。");
  if (!existsSync(dataDirectory)) throw new Error(`数据目录不存在：${dataDirectory}（请检查 CABI_DATA_DIR）`);

  const target = path.join(root, timestamp());
  mkdirSync(target, { recursive: true, mode: 0o700 });
  chmodSync(target, 0o700);

  const copied = [];
  const missing = [];
  for (const name of DATABASES) {
    const source = path.join(dataDirectory, name);
    if (!existsSync(source)) {
      missing.push(name);
      continue;
    }
    const destination = path.join(target, name);
    backupDatabase(source, destination);
    copied.push(name);
  }
  if (!copied.length) throw new Error(`数据目录内没有可备份的数据库：${dataDirectory}`);

  writeFileSync(path.join(target, "manifest.json"), JSON.stringify({
    createdAt: new Date().toISOString(),
    source: dataDirectory,
    databases: copied,
    missing,
  }, null, 2), { mode: 0o600 });

  const pruned = prune(root, keep);
  console.log(`备份完成：${target}`);
  console.log(`已备份：${copied.join(", ")}${missing.length ? `；不存在跳过：${missing.join(", ")}` : ""}`);
  if (pruned.length) console.log(`已清理旧备份：${pruned.join(", ")}`);

  const hasRedemptionSecret = Boolean(process.env.REDEMPTION_DATA_SECRET || process.env.ADMIN_SESSION_SECRET);
  console.log("提醒：redemption.sqlite 的收货信息由 REDEMPTION_DATA_SECRET（未设置时回退 ADMIN_SESSION_SECRET）加密。");
  console.log(hasRedemptionSecret
    ? "当前进程环境已提供加密密钥；请把密钥单独备份到密码管理器，不要和数据库放在同一目录。"
    : "当前进程环境没有看到 REDEMPTION_DATA_SECRET / ADMIN_SESSION_SECRET；只有数据库无法恢复收货信息，请确认密钥已安全保存。");
  console.log("请将备份复制到另一台主机或对象存储；本机同盘备份无法应对磁盘或整机故障。");
}

try {
  main();
} catch (error) {
  console.error(`备份失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
