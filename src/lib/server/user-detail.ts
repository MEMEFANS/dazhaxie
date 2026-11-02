import "server-only";
import { isAddress } from "viem";
import { memberAddresses } from "./community-db";
import { referralAddresses } from "./referral-db";
import { redemptionAddresses } from "./redemption-db";
import { promotionStats } from "./subscription-db";

export interface UserChainSnapshot {
  available: boolean;
  reason?: string;
  purchased?: string;
  rewardShares?: string;
  directShares?: string;
  teamRewardShares?: string;
  claimed?: string;
  claimable?: string;
}
/** 全部来自服务器认购单与邀请关系树；不再读取 XBTSale。 */
export async function readUserChain(address: string): Promise<UserChainSnapshot> {
  if (!isAddress(address, { strict: false })) return { available: false, reason: "地址格式无效" };
  try {
    const stats = promotionStats(address);
    return {
      available: true,
      purchased: String(stats.purchased),
      rewardShares: String(stats.directRewardShares + stats.differentialShares),
      directShares: String(stats.directShares),
      teamRewardShares: String(stats.differentialShares),
    };
  } catch (error) {
    return { available: false, reason: error instanceof Error ? `服务端读取失败：${error.message.slice(0, 80)}` : "服务端读取失败" };
  }
}

export interface UserAddressRecord { address: string; sources: string[] }
export function collectUserAddresses(): UserAddressRecord[] {
  const map = new Map<string, Set<string>>();
  const add = (address: string, source: string) => {
    const key = address.toLowerCase();
    if (!isAddress(key, { strict: false })) return;
    const set = map.get(key) || new Set<string>();
    set.add(source);
    map.set(key, set);
  };
  memberAddresses().forEach(address => add(address, "社群"));
  referralAddresses().forEach(address => add(address, "邀请"));
  redemptionAddresses().forEach(address => add(address, "兑换"));
  return [...map.entries()].map(([address, sources]) => ({ address, sources: [...sources] })).sort((a, b) => a.address.localeCompare(b.address));
}
export function filterAddresses(q: string) {
  const keyword = q.trim().toLowerCase();
  const all = collectUserAddresses();
  return keyword ? all.filter(record => record.address.includes(keyword)) : all;
}
export interface UserDetailRow extends UserAddressRecord {
  chain: UserChainSnapshot;
  teamPerformance: string | null;
}
export async function readPage(records: UserAddressRecord[]) {
  return Promise.all(records.map(async record => {
    const stats = promotionStats(record.address);
    return { ...record, chain: await readUserChain(record.address), teamPerformance: String(stats.teamShares) };
  }));
}
export async function listUserDetails(options: { q?: string; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, Math.floor(options.page || 1)), pageSize = Math.min(50, Math.max(1, Math.floor(options.pageSize || 10)));
  const all = filterAddresses(options.q || "");
  const slice = all.slice((page - 1) * pageSize, page * pageSize);
  return { items: await readPage(slice), total: all.length, page, pageSize };
}
function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export async function exportUsersCsv(q: string) {
  const all = filterAddresses(q).slice(0, 300);
  const rows = await readPage(all);
  const header = ["地址", "来源", "认购份数", "奖励份数", "直推份数", "团队奖励份数", "团队业绩", "数据状态"];
  const lines = rows.map(row => [
    row.address, row.sources.join("/"),
    row.chain.purchased ?? "无", row.chain.rewardShares ?? "无", row.chain.directShares ?? "无",
    row.chain.teamRewardShares ?? "无", row.teamPerformance ?? "0",
    row.chain.available ? "服务器记账" : row.chain.reason || "不可得",
  ].map(csvCell).join(","));
  return `\uFEFF${[header.join(","), ...lines].join("\r\n")}`;
}
