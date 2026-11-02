// 社群成员 / 群管理员 / 踢出记录 / 操作日志：类型与权限判定

export interface CommunityMember {
  id: string; // 成员唯一 ID
  name: string;
  address: string;
  official?: boolean; // 官方账号：不可被踢出、不可被设为群管理员
  refCode?: string; // 推广码（邀请码注册表来源之一；官方账号无码）
  joinedAt: number; // 入群时间（毫秒）
}

export interface AdminRecord {
  address: string;
  name: string;
  at: number; // 设置时间
}

export interface KickRecord {
  address: string;
  name: string;
  at: number;
  joinedAt: number; // 原入群时间，恢复时沿用
  operator: string; // 操作者展示名
  by: "admin-panel" | "group-admin"; // 后台移除 / 群管理员移除
}

export type ModAction = "appoint" | "revoke" | "kick" | "restore";

// 初始社群为空；成员和管理员由后续真实服务返回。
export function seedMembers(now: number): CommunityMember[] {
  void now;
  return [];
}

// 不再为旧存档补入内置推广码。
export function seedRefCode(address: string): string | undefined {
  void address;
  return undefined;
}

export function seedAdmins(now: number): AdminRecord[] {
  void now;
  return [];
}

export function isKickedAddress(kicked: KickRecord[], address: string): boolean {
  if (!address) return false;
  const target = address.toLowerCase();
  return kicked.some((k) => k.address.toLowerCase() === target);
}
