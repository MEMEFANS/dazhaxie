"use client";

import { useEffect, useState } from "react";

const SESSION_EVENT = "cabi-admin-session-updated";
export interface AdminAuthState {
  authed: boolean;
  ready: boolean;
  configured: boolean;
  account?: string;
  error?: string;
}

async function mutateSession(path: string, body?: object) {
  const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "操作失败，请重试");
  window.dispatchEvent(new Event(SESSION_EVENT));
}
export function adminLogin(account: string, password: string) { return mutateSession("/api/admin/login", { account, password }); }
export function adminLogout() { return mutateSession("/api/admin/logout"); }

export function useAdminAuth(): AdminAuthState {
  const [state, setState] = useState<AdminAuthState>({ authed: false, ready: false, configured: false });
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/admin/session", { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) throw new Error("登录服务暂时不可用，请刷新重试");
        const result = await response.json();
        if (active) setState({ authed: result.authenticated === true, configured: result.configured === true, ready: true, account: result.account });
      } catch (error) {
        if (active) setState({ authed: false, configured: false, ready: true, error: error instanceof Error ? error.message : "登录状态查询失败" });
      }
    };
    void refresh();
    window.addEventListener(SESSION_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener(SESSION_EVENT, refresh); window.removeEventListener("focus", refresh); };
  }, []);
  return state;
}
