import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // 生产部署使用独立运行包：.next/standalone/server.js（无需完整 node_modules）。
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
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
    ];
  },
  redirects() {
    return [{ source: "/dapp", destination: "/", permanent: false }];
  },
  turbopack: {
    rules: {
      "globals.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
