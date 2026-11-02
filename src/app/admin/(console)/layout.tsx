import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/server/admin-session";
import AdminConsoleShell from "../console-shell";

async function AuthenticatedConsole({ children }: { children: React.ReactNode }) {
  if (!await getCurrentAdmin()) redirect("/admin/login");
  return <AdminConsoleShell>{children}</AdminConsoleShell>;
}

export default function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="p-6 text-sm text-mute" role="status">正在验证管理员会话…</div>}>
    <AuthenticatedConsole>{children}</AuthenticatedConsole>
  </Suspense>;
}
