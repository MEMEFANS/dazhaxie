"use client";

// DApp 共享 UI 基元（币安主题色 · 统一设计 token）
// 排版阶梯：页面标题 26 sans / 卡片标题 14 semibold / 数值 24 mono tabular /
//          正文 12 / 说明 11 / 辅助 10；间距刻度 4/8/12/16/24/32/48

import type { LucideIcon } from "lucide-react";
import {
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  Inbox,
  Minus,
  Plus,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useStore } from "@/lib/store";

/* ---------- 页面骨架：统一内容栅格（最大 960px，区块间距 24px） ---------- */

export function PageStack({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-[1180px] space-y-6 ${className}`}>
      {children}
    </div>
  );
}

/* ---------- 卡片 ---------- */

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={`card p-6 ${className}`}>{children}</section>;
}

/* ---------- 平面面板：次级区块（无阴影，与 .card 大卡区分层级） ---------- */

export function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-card ${className}`}>
      {children}
    </section>
  );
}

/* ---------- 未连接钱包引导：安静信息条 + 单一金色主操作 ---------- */

export function ConnectNotice({
  icon: Icon,
  eyebrow,
  title,
  desc,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  desc: string;
}) {
  const { connect } = useStore();

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-plum/5 text-mute">
            <Icon size={18} strokeWidth={1.6} />
          </span>
          <div className="min-w-0">
            <p className="kicker">{eyebrow}</p>
            <h2 className="mt-1 text-[16px] font-semibold leading-5 text-strong">
              {title}
            </h2>
            <p className="mt-1 text-[12px] leading-5 text-mute">{desc}</p>
          </div>
        </div>
        <button
          onClick={connect}
          className="btn btn-gold h-10 w-full shrink-0 px-5 text-[12px] sm:w-auto"
        >
          <Wallet size={14} /> 连接钱包
        </button>
      </div>
    </section>
  );
}

/* ---------- 页面头部：eyebrow + 标题 + 状态摘要 ---------- */

export function PageHeader({
  eyebrow,
  title,
  desc,
}: {
  eyebrow: string;
  title: string;
  desc?: string;
}) {
  return (
    <header>
      <p className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.28em] text-gold">
        <span className="h-px w-5 bg-gold/60" aria-hidden />
        {eyebrow}
      </p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-strong">
          {title}
        </h1>
        {desc ? (
          <p className="pb-1 text-[11px] leading-5 text-faint">{desc}</p>
        ) : null}
      </div>
    </header>
  );
}

/* ---------- 卡片内区块标题 ---------- */

export function SectionTitle({
  icon: Icon,
  title,
  tone = "gold",
  extra,
}: {
  icon?: LucideIcon;
  title: string;
  tone?: "gold" | "red";
  extra?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold leading-5 text-strong">
        {Icon ? (
          <Icon
            size={15}
            className={tone === "red" ? "text-down" : "text-gold"}
          />
        ) : null}
        {title}
      </h3>
      {extra ? <div className="flex items-center gap-2">{extra}</div> : null}
    </div>
  );
}

/* ---------- 数值卡：大字号数值 + 弱化标签（数字全局 tabular） ---------- */

export function StatCard({
  icon: Icon,
  label,
  value,
  unit,
  hint,
}: {
  icon?: LucideIcon;
  label: string;
  value: string;
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="well group p-4 transition-colors hover:border-line">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] leading-4 text-mute">{label}</span>
        {Icon ? (
          <Icon
            size={14}
            strokeWidth={1.6}
            className="shrink-0 text-faint transition-colors group-hover:text-gold"
          />
        ) : null}
      </div>
      <p className="num mt-2 text-[24px] font-semibold leading-none tracking-tight text-strong">
        {value}
        {unit ? (
          <span className="ml-1 font-sans text-[10px] font-normal text-faint">{unit}</span>
        ) : null}
      </p>
      {hint ? (
        <p className="mt-2 truncate text-[10px] leading-4 text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

/* ---------- 徽章 ---------- */

export function Badge({
  children,
  tone = "green",
}: {
  children: React.ReactNode;
  tone?: "green" | "gold" | "amber" | "gray" | "red";
}) {
  const tones: Record<string, string> = {
    green: "border-up/20 bg-up/10 text-up",
    gold: "border-gold/20 bg-gold/10 text-gold",
    amber: "border-warn/25 bg-warn/10 text-warn",
    gray: "border-line bg-plum/5 text-mute",
    red: "border-down/20 bg-down/10 text-down",
  };
  return (
    <span
      className={`inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-[10px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function DemoTag({ children = "待接入" }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex h-5 items-center rounded-md border border-line bg-plum/5 px-1.5 text-[10px] font-medium text-faint">
      {children}
    </span>
  );
}

/* ---------- 状态条：安静而专业的信息条（风险提示 / 状态提示） ---------- */

export function Notice({
  tone = "gold",
  icon: Icon,
  children,
  className = "",
}: {
  tone?: "gold" | "green" | "red" | "gray";
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  const tones: Record<string, string> = {
    gold: "border-gold/20 bg-gold/[0.06]",
    green: "border-up/20 bg-up/[0.06]",
    red: "border-down/25 bg-down/[0.06]",
    gray: "border-line bg-well",
  };
  const iconTones: Record<string, string> = {
    gold: "text-gold",
    green: "text-up",
    red: "text-down",
    gray: "text-mute",
  };
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-xs leading-6 text-mute ${tones[tone]} ${className}`}
    >
      {Icon ? (
        <Icon size={15} className={`mt-[5px] shrink-0 ${iconTones[tone]}`} />
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/* ---------- 进度条：渐变填充 + 微光 + 可选刻度 ---------- */

export function Progress({
  value,
  alert = false,
  tick,
  className = "",
}: {
  value: number; // 0-100
  alert?: boolean;
  tick?: number; // 刻度位置（百分比）
  className?: string;
}) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className={`relative h-2 rounded-full bg-line/60 ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-200 ease-out ${
          alert ? "bg-down" : "bg-gold-2"
        }`}
        style={{ width: `${pct}%` }}
      />
      {typeof tick === "number" ? (
        <span
          className="absolute -top-1 h-4 w-px bg-gold/50"
          style={{ left: `${tick}%` }}
          aria-hidden
        />
      ) : null}
    </div>
  );
}

/* ---------- 数量步进器（lg 控件，统一 48px 高） ---------- */

export function QtyStepper({
  value,
  unit = "份",
  onDecrease,
  onIncrease,
  disabled = false,
}: {
  value: number;
  unit?: string;
  onDecrease: () => void;
  onIncrease: () => void;
  disabled?: boolean;
}) {
  const stepBtn =
    "grid h-10 w-10 place-items-center rounded-lg text-mute transition hover:bg-plum/5 hover:text-strong disabled:opacity-30";
  return (
    <div className="field flex h-12 items-center justify-between px-2">
      <button
        onClick={onDecrease}
        disabled={disabled}
        className={stepBtn}
        aria-label="减少数量"
      >
        <Minus size={16} />
      </button>
      <p className="leading-none">
        <span className="text-[24px] font-semibold text-strong">{value}</span>
        <span className="ml-2 text-xs text-mute">{unit}</span>
      </p>
      <button
        onClick={onIncrease}
        disabled={disabled}
        className={stepBtn}
        aria-label="增加数量"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}

/* ---------- 弹窗（统一遮罩 / 圆角 / 进场动效） ---------- */

export function Modal({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-plum/45 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="card shadow-pop animate-pop-in w-full max-w-[400px] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full bg-well text-mute transition hover:bg-line hover:text-strong"
            aria-label="关闭"
          >
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- 空态（与骨架屏占位节奏一致，避免切换跳动） ---------- */

export function EmptyRow({ text }: { text: string }) {
  return (
    <div className="flex min-h-[168px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line px-4 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-plum/5 text-faint">
        <Inbox size={16} strokeWidth={1.5} />
      </span>
      <p className="text-[11px] leading-5 text-faint">{text}</p>
    </div>
  );
}

/* ---------- 区块头：eyebrow + 标题 + 右侧元信息 ---------- */

export function SectionHead({
  eyebrow,
  title,
  desc,
  right,
}: {
  eyebrow?: string;
  title: string;
  desc?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        {eyebrow ? <p className="kicker">{eyebrow}</p> : null}
        <h2 className="mt-1.5 text-[20px] font-semibold leading-tight tracking-tight text-strong">
          {title}
        </h2>
        {desc ? <p className="mt-1 text-[12px] leading-5 text-mute">{desc}</p> : null}
      </div>
      {right ? <div className="shrink-0 pb-0.5">{right}</div> : null}
    </div>
  );
}

/* ---------- 指标：标签 + 等宽数值 + 单位 ---------- */

export function Metric({
  label,
  value,
  unit,
  hint,
  tone = "default",
  size = "md",
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  tone?: "default" | "gold" | "up" | "down" | "muted";
  size?: "sm" | "md" | "lg";
}) {
  const tones = {
    default: "text-strong",
    gold: "text-gold",
    up: "text-up",
    down: "text-down",
    muted: "text-mute",
  };
  const sizes = { sm: "text-[18px]", md: "text-[22px]", lg: "text-[28px]" };
  return (
    <div className="min-w-0">
      <p className="kicker">{label}</p>
      <p className={`num mt-1.5 break-words font-semibold leading-tight tracking-tight ${tones[tone]} ${sizes[size]}`}>
        {value}
        {unit ? (
          <span className="ml-1 font-sans text-[11px] font-normal text-faint">{unit}</span>
        ) : null}
      </p>
      {hint ? <p className="mt-1.5 text-[11px] leading-4 text-faint">{hint}</p> : null}
    </div>
  );
}

/* ---------- 数据行：字段名左、值右，等宽右对齐 ---------- */

export function DataRow({
  label,
  value,
  mono = true,
  tone = "default",
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  tone?: "default" | "gold" | "up" | "down" | "mute" | "faint";
  className?: string;
}) {
  const tones = {
    default: "text-strong",
    gold: "text-gold",
    up: "text-up",
    down: "text-down",
    mute: "text-mute",
    faint: "text-faint",
  };
  return (
    <div className={`flex items-center justify-between gap-3 py-2 ${className}`}>
      <span className="shrink-0 text-[12px] leading-5 text-mute">{label}</span>
      <span className={`${mono ? "num " : ""}min-w-0 break-words text-right text-[12px] font-medium leading-6 ${tones[tone]}`}>
        {value}
      </span>
    </div>
  );
}

/* ---------- 状态徽标：带状态点 ---------- */

export function StatusPill({
  tone = "live",
  children,
}: {
  tone?: "live" | "paused" | "soon" | "warn" | "error" | "neutral";
  children: React.ReactNode;
}) {
  const tones = {
    live: "border-up/25 bg-up/10 text-up",
    paused: "border-line bg-plum/5 text-mute",
    soon: "border-warn/25 bg-warn/10 text-warn",
    warn: "border-warn/25 bg-warn/10 text-warn",
    error: "border-down/25 bg-down/10 text-down",
    neutral: "border-line bg-plum/5 text-mute",
  };
  const dots = {
    live: "bg-up",
    paused: "bg-faint",
    soon: "bg-warn",
    warn: "bg-warn",
    error: "bg-down",
    neutral: "bg-faint",
  };
  return (
    <span className={`inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium ${tones[tone]}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dots[tone]}`} aria-hidden />
      {children}
    </span>
  );
}

/* ---------- 复制按钮：地址 / 合约 / 链接 ---------- */

export function CopyButton({
  value,
  label = "复制",
  className = "",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const { showToast } = useStore();
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      showToast("已复制到剪贴板");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      showToast("复制失败，请手动选择文本");
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      title={label}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg text-mute transition-colors duration-200 hover:bg-plum/5 hover:text-strong sm:h-8 sm:w-8 ${className}`}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

/* ---------- 合约行：地址 + 复制 + 区块浏览器 + 链 ---------- */

export function ContractRow({
  address,
  chain,
  href,
}: {
  address?: string;
  chain?: string;
  href?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="text-[11px] text-mute">合约</span>
      {address ? (
        <>
          <span className="num min-w-0 break-all text-[12px] text-strong">{address}</span>
          <CopyButton value={address} label="复制合约地址" />
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[11px] text-mute transition-colors duration-200 hover:text-gold"
            >
              区块浏览器 <ExternalLink size={11} />
            </a>
          ) : (
            <span className="text-[11px] text-faint">区块浏览器</span>
          )}
        </>
      ) : (
        <>
          <span className="text-[11px] text-mute">未配置</span>
          <Badge tone="gray">待配置</Badge>
          <span className="text-[11px] text-faint">部署后展示区块浏览器链接</span>
        </>
      )}
      {chain ? (
        <span className="flex items-center gap-1.5 text-[11px] text-mute">
          <span className="h-1.5 w-1.5 rounded-full bg-up" aria-hidden />
          {chain}
        </span>
      ) : null}
    </div>
  );
}

/* ---------- 交易状态：pending / success / failed ---------- */

export type TxState = "pending" | "success" | "failed";

export function TxStatus({
  state,
  hash,
  explorer,
  note = "请以服务确认结果为准",
}: {
  state: TxState;
  hash?: string;
  explorer?: string;
  note?: string;
}) {
  const map = {
    pending: {
      label: "处理中",
      tone: "text-warn",
      border: "border-warn/25 bg-warn/[0.06]",
      icon: Clock3,
      text: "正在等待确认",
    },
    success: {
      label: "已完成",
      tone: "text-up",
      border: "border-up/25 bg-up/[0.06]",
      icon: CheckCircle2,
      text: "操作已生效",
    },
    failed: {
      label: "未通过",
      tone: "text-down",
      border: "border-down/25 bg-down/[0.06]",
      icon: XCircle,
      text: "操作未完成，请检查后重试",
    },
  } as const;
  const m = map[state];
  const Icon = m.icon;

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${m.border}`}>
      <div className="flex items-center justify-between gap-3">
        <span className={`flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] ${m.tone}`}>
          <Icon size={13} /> {m.label}
        </span>
        <span className="text-[11px] text-mute">{m.text}</span>
      </div>
      {hash ? (
        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line pt-2.5">
          <span className="num min-w-0 truncate text-[11px] text-mute">{hash}</span>
          {explorer ? (
            <a
              href={explorer}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-[11px] text-mute transition-colors hover:text-gold"
            >
              查看
            </a>
          ) : (
            <CopyButton value={hash} label="复制交易哈希" />
          )}
        </div>
      ) : null}
      <p className="mt-2 text-[10px] leading-4 text-faint">{note}</p>
    </div>
  );
}

/* ---------- 进度环：轻量自绘 SVG，仅一条金色弧 ---------- */

export function ProgressRing({
  value,
  max,
  size = 132,
  stroke = 8,
  label,
  sublabel,
  className = "",
}: {
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  label?: string;
  sublabel?: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  return (
    <div
      className={`relative grid shrink-0 place-items-center ${className}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="currentColor"
          className="text-line/60"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="currentColor"
          className="text-gold-2"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
          style={{ transition: "stroke-dashoffset 200ms ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          {label ? <p className="kicker">{label}</p> : null}
          <p className="num mt-1 text-[22px] font-semibold leading-none text-strong">
            {pct.toFixed(2)}
            <span className="text-[11px] font-normal text-faint">%</span>
          </p>
          {sublabel ? <p className="num mt-1 text-[10px] leading-4 text-faint">{sublabel}</p> : null}
        </div>
      </div>
    </div>
  );
}

/* ---------- 迷你柱状图：轻量自绘，无网格装饰 ---------- */

export function MiniBars({
  data,
  tone = "gold",
  height = 56,
  className = "",
}: {
  data: number[];
  tone?: "gold" | "up" | "down" | "neutral";
  height?: number;
  className?: string;
}) {
  const max = Math.max(1, ...data);
  const colors = {
    gold: "bg-gold-2",
    up: "bg-up",
    down: "bg-down",
    neutral: "bg-strong/40",
  };
  return (
    <div className={`flex items-end gap-1 ${className}`} style={{ height }} aria-hidden>
      {data.map((v, i) => (
        <span
          key={i}
          className={`min-w-0 flex-1 rounded-sm ${colors[tone]} ${
            i === data.length - 1 ? "opacity-100" : "opacity-40"
          }`}
          style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

/* ---------- 加载态：骨架屏 ---------- */

export function LoadingBlock() {
  return (
    <div
      role="status"
      aria-label="正在载入"
      className="mx-auto w-full max-w-[1180px] space-y-6"
    >
      <div className="space-y-3">
        <div className="skeleton h-3 w-24" />
        <div className="skeleton h-8 w-48" />
      </div>
      <div className="skeleton h-24 w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-[104px]" />
        ))}
      </div>
      <div className="skeleton h-40 w-full" />
    </div>
  );
}
