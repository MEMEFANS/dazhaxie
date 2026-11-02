import "server-only";

// 纯 HTTP 阶段（APP_ORIGIN 以 http:// 开头）下发 Secure 会被浏览器直接丢弃，导致会话永远建立不了。
// 绑定域名并切换 APP_ORIGIN=https:// 后自动恢复 Secure；未配置 APP_ORIGIN 时回退到 NODE_ENV 判断。
export function secureCookie(): boolean {
  const origin = process.env.APP_ORIGIN?.trim();
  if (origin) return origin.startsWith("https://");
  return process.env.NODE_ENV === "production";
}
