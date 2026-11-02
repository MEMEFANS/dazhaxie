"use client";

// 后台控制台外壳（路由组 (console)）：未登录跳转 /admin/login
// 布局：顶栏（品牌 + 退出）+ 侧边模块导航（移动端为横向导航条）+ 内容区
// 视觉与前台 DApp 同源（同一设计 token），信息结构不变

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Coins,
  Gift,
  Headphones,
  LayoutDashboard,
  LogOut,
  ShieldAlert,
  ShoppingBag,
  Settings2,
  ScrollText,
  UserRound,
  Users,
} from "lucide-react";
import { adminLogout, useAdminAuth } from "@/lib/admin-auth";
import { LoadingBlock } from "@/components/dapp/ui";

const ADMIN_NAV = [
  { href: "/admin", label: "仪表盘", icon: LayoutDashboard },
  { href: "/admin/settings", label: "运营设置", icon: Settings2 },
  { href: "/admin/contracts", label: "链上合约", icon: Coins },
  { href: "/admin/subscribe", label: "认购管理", icon: ShoppingBag },
  { href: "/admin/exchange", label: "兑换管理", icon: Gift },
  { href: "/admin/reward-pool", label: "领取管理", icon: Coins },
  { href: "/admin/words", label: "敏感词库", icon: ShieldAlert },
  { href: "/admin/community", label: "社群管理", icon: Users },
  { href: "/admin/tickets", label: "工单处理", icon: Headphones },
  { href: "/admin/users", label: "用户明细", icon: UserRound },
  { href: "/admin/audit", label: "审计与会话", icon: ScrollText },
];

export default function AdminConsoleShell({ children }: { children: React.ReactNode }) {
  const { authed, ready } = useAdminAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    if (ready && !authed) router.replace("/admin/login");
  }, [ready, authed, router]);

  if (!ready || !authed) {
    return (
      <div className="p-6">
        <LoadingBlock />
      </div>
    );
  }

  async function logout() {
    setLoggingOut(true);
    setLogoutError("");
    try { await adminLogout(); router.replace("/admin/login"); router.refresh(); }
    catch { setLogoutError("退出失败，请重试"); }
    finally { setLoggingOut(false); }
  }

  return (
    <div className="min-h-screen bg-abyss text-strong">
      {/* 顶栏 */}
      <header className="sticky top-0 z-40 border-b border-line bg-deep/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="grid h-8 w-8 place-items-center rounded-lg border border-line text-mute transition hover:border-purple/40 hover:text-purple-deep"
              title="返回官网"
            >
              <ArrowLeft size={14} />
            </Link>
            <Image src="/logo.png" alt="蟹比特" width={32} height={32} priority className="h-8 w-8 rounded-lg object-cover ring-1 ring-line" />
            <div className="leading-tight">
              <p className="text-xs font-semibold">蟹比特</p>
              <p className="mt-0.5 text-[10px] tracking-[0.2em] text-faint">ADMIN CONSOLE</p>
            </div>
          </div>
          <button
            onClick={logout}
            disabled={loggingOut}
            className="btn btn-outline h-10 px-4 text-[11px] hover:border-down/50 hover:bg-down/[0.06] hover:text-down"
          >
            <LogOut size={12} /> {loggingOut ? "正在退出…" : "退出登录"}
          </button>
        </div>
      </header>

      {logoutError ? <p className="px-4 py-3 text-center text-xs text-down" role="alert">{logoutError}</p> : null}
      {/* 移动端横向导航 */}
      <nav className="sticky top-16 z-30 flex gap-2 overflow-x-auto border-b border-line bg-deep/95 px-4 py-3 backdrop-blur-xl md:hidden">
        {ADMIN_NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[11px] transition ${
                active
                  ? "border-purple/30 bg-purple/[0.08] font-medium text-purple-deep"
                  : "border-line text-mute hover:text-strong"
              }`}
            >
              <item.icon size={12} /> {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mx-auto flex max-w-[1180px] gap-6 px-4 py-6 lg:px-6">
        {/* 桌面端侧边导航 */}
        <aside className="hidden w-44 shrink-0 md:block">
          <nav className="sticky top-24 space-y-1">
            {ADMIN_NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative flex h-10 items-center gap-2.5 rounded-xl px-3.5 text-xs transition ${
                    active
                      ? "bg-purple/[0.08] font-medium text-purple-deep"
                      : "text-mute hover:bg-plum/5 hover:text-strong"
                  }`}
                >
                  {active ? (
                    <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-purple" aria-hidden />
                  ) : null}
                  <item.icon size={14} /> {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main key={pathname} className="animate-fade-up min-w-0 flex-1 pb-10">{children}</main>
      </div>
    </div>
  );
}
