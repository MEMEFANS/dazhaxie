"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { DAppShell } from "@/components/dapp/shell";

/** Keep one DApp shell mounted when navigation crosses the overview and /dapp routes. */
export function RouteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isDApp = pathname === "/" || pathname === "/dapp" || pathname.startsWith("/dapp/");

  return isDApp ? <DAppShell>{children}</DAppShell> : <>{children}</>;
}
