"use client";

// 底部入口：官方社群与支持工单

import Link from "next/link";
import { ArrowUpRight, Headphones, MessageCircle } from "lucide-react";

const LINKS = [
  { href: "/dapp/community", label: "官方社群", desc: "群内公告与交流", icon: MessageCircle },
  { href: "/dapp/support", label: "支持工单", desc: "问题提交与进度查询", icon: Headphones },
];

export function OverviewLinks() {
  return (
    <section>
      <p className="kicker">SUPPORT</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group flex items-center gap-3 rounded-xl border border-line bg-card p-4 transition-colors duration-200 hover:border-purple/30"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-well text-mute transition-colors duration-200 group-hover:text-strong">
              <item.icon size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-strong">{item.label}</p>
              <p className="mt-0.5 truncate text-[11px] text-faint">{item.desc}</p>
            </div>
            <ArrowUpRight
              size={14}
              className="shrink-0 text-faint transition-colors duration-200 group-hover:text-strong"
            />
          </Link>
        ))}
      </div>
    </section>
  );
}
