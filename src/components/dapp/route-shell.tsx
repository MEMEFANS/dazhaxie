"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { DAppShell } from "@/components/dapp/shell";

/** Preserve wallet and invitation state across public page navigation. */
export function RouteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isDApp = pathname === "/" || /^\/(subscribe|token|promotion|team|community|exchange|support)(?:\/|$)/.test(pathname);

  return isDApp ? <DAppShell>{children}</DAppShell> : <>{children}</>;
}
