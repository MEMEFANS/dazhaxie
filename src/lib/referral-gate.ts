// 邀请码门禁：触发判定、输入清洗与推广码注册表查询（纯函数，无渲染逻辑）
// 注册表仅查询实际传入的社群成员推广码；本人推广码仅用于自绑拦截

import {
  type CommunityMember,
  type KickRecord,
  isKickedAddress,
} from "./community";

export const REF_CODE_LENGTH = 6;

export interface ReferralOwner {
  name: string;
  address: string;
  demo?: boolean; // 演示码持有方（界面上明确标注）
}

// 保留旧导出兼容调用方，不再提供任何内置可用推广码。
export const DEMO_REF_CODES: ReadonlyArray<{ code: string; owner: ReferralOwner }> = [];

export type ReferralReject = "empty" | "self" | "revoked" | "not-found";

export type ReferralResolution =
  | { ok: true; owner: ReferralOwner }
  | { ok: false; reason: ReferralReject };

// 输入清洗：支持粘贴整条链接（自动提取 ref 参数），大写、去空格与非字母数字，限 6 位
export function sanitizeRefInput(raw: string): string {
  let v = raw.trim();
  const link = v.match(/ref=([A-Za-z0-9]+)/i);
  if (link) v = link[1];
  return v.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, REF_CODE_LENGTH);
}

// 校验推广码：须真实存在且未失效（被移出社群的成员其码视为已失效）；不能绑定自己的码
export function resolveReferralCode(args: {
  members: CommunityMember[];
  kicked: KickRecord[];
  myCode: string;
  code: string;
}): ReferralResolution {
  const { members, kicked, myCode, code } = args;
  if (!code) return { ok: false, reason: "empty" };
  const target = code.toUpperCase();
  if (myCode && target === myCode.toUpperCase()) {
    return { ok: false, reason: "self" };
  }
  const member = members.find((m) => m.refCode?.toUpperCase() === target);
  if (member) {
    if (isKickedAddress(kicked, member.address)) {
      return { ok: false, reason: "revoked" };
    }
    return { ok: true, owner: { name: member.name, address: member.address } };
  }
  return { ok: false, reason: "not-found" };
}

export type ReferralGatePhase = "hidden" | "connect" | "bind";

// 门禁阶段：未水合 / 已绑定上级（含 URL 有效 ref 自动绑定）→ 不弹；
// 未连接钱包 → 连接阶段（连接不可绕过，绑定按地址生效）；已连接未绑定 → 输码阶段
export function referralGatePhase(s: {
  hydrated: boolean;
  connected: boolean;
  referrer: string | null;
}): ReferralGatePhase {
  if (!s.hydrated || s.referrer) return "hidden";
  return s.connected ? "bind" : "connect";
}
