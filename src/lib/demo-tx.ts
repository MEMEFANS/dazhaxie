// 演示交易哈希：仅用于 UI 状态展示，不代表真实链上交易

export function mockTxHash(): string {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return "0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return "0x" + Date.now().toString(16).padStart(64, "0");
}
