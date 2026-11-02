"use client";

// 链上操作审计：操作前后参数、交易哈希与结果统一写入后台审计日志。

type AuditStatus = "pending" | "success" | "failed";
export interface ChainAuditInput {
  action: string;
  status: AuditStatus;
  before?: unknown;
  after?: unknown;
  txHash?: string;
  wallet?: string;
  error?: string;
}

function serialize(value: unknown) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value, (_key, raw) => typeof raw === "bigint" ? raw.toString() : raw)) as unknown;
  } catch { return String(value); }
}

export function recordChainAudit(input: ChainAuditInput) {
  const body = JSON.stringify({
    action: input.action.slice(0, 60),
    status: input.status,
    before: serialize(input.before),
    after: serialize(input.after),
    txHash: input.txHash,
    wallet: input.wallet,
    error: input.error,
  });
  void fetch("/api/admin/audit", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => { /* 审计失败不阻断链上交易，后台仍可从回执核对 */ });
}
