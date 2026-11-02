"use client";

// 管理员身份由服务端验证，浏览器不保存密码或登录凭证。

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Lock, ShieldCheck, User } from "lucide-react";
import { adminLogin, useAdminAuth } from "@/lib/admin-auth";

export default function AdminLoginPage() {
  const router = useRouter();
  const { authed, ready, configured, error: sessionError } = useAdminAuth();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (ready && authed) router.replace("/admin");
  }, [ready, authed, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      await adminLogin(account.trim(), password);
      setPassword("");
      router.replace("/admin");
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "登录失败，请重试"); }
    finally { setPending(false); }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-abyss px-4">
      <div className="card w-full max-w-sm p-8">
        <div className="flex flex-col items-center">
          <Image src="/logo.png" alt="蟹比特" width={52} height={52} priority className="h-[52px] w-[52px] rounded-xl object-cover ring-1 ring-line" />
          <h1 className="mt-4 text-lg font-semibold leading-7 tracking-tight">蟹比特 · 管理后台</h1>
          <p className="mt-2 flex items-center gap-1 text-xs leading-5 text-mute">
            <ShieldCheck size={13} /> 管理员登录
          </p>
        </div>

        <form onSubmit={submit} className="mt-8 space-y-3">
          {!ready ? <p className="text-xs leading-6 text-mute" role="status">正在检查登录服务…</p> : null}
          {sessionError ? <p className="text-xs leading-6 text-down" role="alert">{sessionError}</p> : null}
          {ready && !configured && !sessionError ? <p className="rounded-xl border border-line bg-well p-3 text-xs leading-6 text-mute">管理员尚未初始化。请在服务器运行 <code>node scripts/setup-admin.cjs</code>，再刷新此页。</p> : null}
          <label className="field flex h-12 items-center gap-2 px-4">
            <User size={14} className="shrink-0 text-faint" />
            <input
              aria-label="管理员账号"
              required
              maxLength={100}
              value={account}
              onChange={(e) => { setAccount(e.target.value); setError(""); }}
              placeholder="管理员账号"
              autoComplete="username"
              className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
            />
          </label>
          <label className="field flex h-12 items-center gap-2 px-4">
            <Lock size={14} className="shrink-0 text-faint" />
            <input
              aria-label="登录密码"
              required
              maxLength={512}
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              placeholder="登录密码"
              autoComplete="current-password"
              className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
            />
          </label>
          {error && <p className="text-center text-xs leading-5 text-down" role="alert">{error}</p>}
          <button type="submit" disabled={!ready || !configured || pending} className="btn btn-gold h-12 w-full text-sm font-semibold">
            {pending ? "正在验证…" : "登录后台"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs leading-6 text-mute">
          运营管理登录与合约管理员钱包分别验证。修改链上参数需要对应钱包签名。
        </p>
      </div>
    </div>
  );
}
