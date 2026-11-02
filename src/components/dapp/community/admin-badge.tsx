"use client";

// 群管理员徽章：金色系但克制，仅用于昵称旁的轻量标识

export function AdminBadge() {
  return (
    <span className="inline-flex h-4 shrink-0 items-center rounded border border-gold/25 bg-gold/[0.08] px-1 text-[10px] font-medium leading-none text-gold/90">
      管理
    </span>
  );
}
