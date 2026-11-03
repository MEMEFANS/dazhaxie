/** Wallet libraries may wrap an EIP-1193 rejection in several cause objects. */
export function isUserCancelledError(error: unknown): boolean {
  const queue: unknown[] = [error], seen = new Set<unknown>();
  const rejected = /user (?:rejected|denied|cancelled|canceled)|(?:request|transaction|signature) (?:was )?(?:rejected|denied)|已取消钱包确认|用户(?:拒绝|取消)|取消(?:了)?(?:签名|交易|钱包确认)/i;
  while (queue.length && seen.size < 12) {
    const value = queue.shift();
    if (seen.has(value)) continue;
    seen.add(value);
    if (typeof value === "string" && rejected.test(value)) return true;
    if (!value || typeof value !== "object") continue;
    const detail = value as Record<string, unknown>;
    if (detail.code === 4001 || detail.code === "4001" || detail.code === "ACTION_REJECTED" || detail.name === "UserRejectedRequestError") return true;
    if (typeof detail.message === "string" && rejected.test(detail.message)) return true;
    queue.push(detail.cause, detail.error, detail.originalError, detail.data);
  }
  return false;
}
