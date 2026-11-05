"use client";

// 管理员身份由服务端验证，浏览器不保存密码或登录凭证。

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Lock, ShieldCheck, User } from "lucide-react";
import { adminLogin, useAdminAuth } from "@/lib/admin-auth";

function cleanAccountInput(value: string) {
  return value.trim().replace(/^(`+)([a-zA-Z0-9._-]+)\1$/, "$2");
}

export default function AdminLoginPage() {
  const router = useRouter();
  const { authed, ready, configured, error: sessionError } = useAdminAuth();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      const cleanedAccount = cleanAccountInput(account);
      setAccount(cleanedAccount);
      await adminLogin(cleanedAccount, password);
      setPassword("");
      router.replace("/admin");
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "登录失败，请重试"); }
    finally { setPending(false); }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-abyss px-4">
      <div className="card w-full min-w-0 max-w-sm p-6 sm:p-8">
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
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text");
                const cleaned = cleanAccountInput(pasted);
                if (cleaned === pasted) return;
                e.preventDefault();
                const start = e.currentTarget.selectionStart ?? account.length;
                const end = e.currentTarget.selectionEnd ?? start;
                setAccount(account.slice(0, start) + cleaned + account.slice(end));
                setError("");
              }}
              placeholder="管理员账号"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            />
          </label>
          <div className="field flex h-12 items-center gap-2 pl-4 pr-1">
            <Lock size={14} className="shrink-0 text-faint" />
            <input
              aria-label="登录密码"
              required
              maxLength={512}
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              placeholder="登录密码"
              name="password"
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby={password !== password.trim() ? "password-whitespace" : undefined}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            />
            <button
              type="button"
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
              title={showPassword ? "隐藏密码" : "显示密码"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((visible) => !visible)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-mute hover:text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
            >
              {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
            </button>
          </div>
          {password !== password.trim() ? <p id="password-whitespace" className="text-xs leading-5 text-mute" role="status">密码首尾含有空格，请确认是否在复制时多选了空格。</p> : null}
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
