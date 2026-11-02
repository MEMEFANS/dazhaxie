"use client";

// 社群 / 工单共用：服务端请求与免签名入群（复用邀请门禁已验证的钱包会话）。

export interface CommunityMemberView {
  address: string;
  name: string;
  joinedAt: number;
  status: "active" | "kicked";
  official: boolean;
  isAdmin: boolean;
}
export interface CommunityMessageView {
  id: string;
  address: string;
  name: string;
  text: string;
  blocked: boolean;
  at: number;
}
export interface CommunityLogView {
  id: string;
  action: "appoint" | "revoke" | "kick" | "restore";
  operator: string;
  target: string;
  targetName: string;
  at: number;
}
export interface TicketReplyView { id: string; author: string; role: "support" | "user"; content: string; at: number }
export interface TicketView {
  id: string;
  address: string;
  category: string;
  title: string;
  content: string;
  status: "pending" | "processed" | "closed";
  createdAt: number;
  updatedAt: number;
  replies: TicketReplyView[];
}
export const TICKET_STATUS_LABEL: Record<TicketView["status"], string> = { pending: "待处理", processed: "已处理", closed: "已完结" };

export async function communityRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error || "服务暂时不可用，请稍后重试");
  return body as T;
}

export async function signInCommunity(address: string): Promise<void> {
  // 免签名：邀请门禁已验证钱包身份，服务端直接复用该会话发放社群会话
  const result = await communityRequest<{ session: { address: string } }>("/api/community/auth/auto", { method: "POST", body: JSON.stringify({ address }) });
  if (result.session.address.toLowerCase() !== address.toLowerCase()) throw new Error("会话与当前钱包不一致，请重新进入");
}
