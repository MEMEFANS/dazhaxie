import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // 生产部署使用独立运行包：.next/standalone/server.js（无需完整 node_modules）。
  output: "standalone",
  deploymentId: process.env.CABI_DEPLOYMENT_ID,
  images: {
    // 图片 URL 不带内容哈希，默认 4 小时的优化缓存会产生周期性回源。
    // 31 天由 CDN 兜住首次转码；更新同名图片需清理 .next/cache/images 并刷新 CDN。
    minimumCacheTTL: 2678400,
  },
  async headers() {
    return [
      // 原图本身不带哈希；交给图片优化器与 CDN 长缓存，避免反复读盘。
      {
        source: "/images/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=2678400, stale-while-revalidate=86400" }],
      },
      // 后台页面与接口包含会话/隐私数据，禁止任何中间层缓存。
      { source: "/admin", headers: [{ key: "Cache-Control", value: "no-store" }] },
      { source: "/admin/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
      // DApp 页面依赖钱包、登录会话和实时额度，禁止复用旧的静态页面壳。
      { source: "/dapp", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      { source: "/dapp/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      // 展示型页面内容变化不频繁，允许 Cloudflare 边缘短缓存，避免每次进站都跨境回源渲染。
      ...["/", "/token", "/promotion", "/team", "/community"].map(source => ({
        source,
        headers: [{ key: "Cache-Control", value: "public, max-age=0, s-maxage=60, stale-while-revalidate=300" }],
      })),
      // 认购、兑换、工单页面含实时额度和用户输入，禁止中间层缓存。
      ...["/subscribe", "/exchange", "/support", "/liquidity/:path*"].map(source => ({
        source, headers: [{ key: "Cache-Control", value: "private, no-store" }],
      })),
    ];
  },
  redirects() {
    return [
      { source: "/dapp", destination: "/", permanent: true },
      { source: "/dapp/:path+", destination: "/:path+", permanent: true },
    ];
  },
};

export default nextConfig;
