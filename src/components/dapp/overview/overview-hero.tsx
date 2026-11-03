"use client";

// 总览首屏：MEME 品牌插画、认购进度与账户状态。

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useStore } from "@/lib/store";
import { useSubscribeConfig } from "@/lib/subscribe-data";
import {
  HARD_CAP,
  SOFT_CAP,
  TOKENS_PER_SHARE,
  UNIT_PRICE,
  fmt,
} from "@/lib/constants";
import {
  DataRow,
  Metric,
  Panel,
  Progress,
  StatusPill,
} from "@/components/dapp/ui";

export function OverviewHero() {
  const { state } = useStore();
  const subscribe = useSubscribeConfig(), config = subscribe.data;

  const sold = config?.globalSold ?? 0;
  const hardCap = config?.hardCap ?? HARD_CAP;
  const softCap = config?.softCap ?? SOFT_CAP;
  const pct = hardCap > 0 ? Math.min(100, sold / hardCap * 100) : 0;
  const remaining = Math.max(0, hardCap - sold);
  const softReached = sold >= softCap;
  const closed = Boolean(config ? !config.enabled || config.remainingGlobal <= 0 : subscribe.status === "error");
  const chain = state.chainId > 0 ? `Chain ${state.chainId}` : "网络未连接";

  const status = closed
    ? { tone: "paused" as const, label: "认购已关闭" }
    : softReached
      ? { tone: "warn" as const, label: "软顶预警" }
      : { tone: "live" as const, label: "认购进行中" };

  return (
    <Panel className="overflow-hidden">
      <div className="grid overflow-hidden border-b border-line bg-[#200946] sm:grid-cols-[1fr_240px]">
        <div className="min-w-0 self-center px-5 py-6 sm:px-6">
          <p className="text-[10px] tracking-[0.2em] text-[#e3bcf5]">
            XIE BIT · 生态总览
          </p>
          <h1 className="mt-2 text-[24px] font-semibold leading-tight tracking-tight text-[#fff0bd] sm:text-[28px]">
            蟹比特生态份额
          </h1>
          <p className="mt-1.5 max-w-[620px] text-[13px] leading-6 text-[#dcc7ee]">
            用 USDT 认购生态份额，按份获得 CaBi 配额，可在兑换商城换实物蟹礼。
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
            <span className="rounded-md border border-line px-2 py-0.5 text-[10px] text-mute">自动登记 · 领取池发放</span>
          </div>
          <p className="mt-3 text-[10px] leading-5 text-[#dcc7ee]">
            BTC 为创意灵感符号 · 生态代币为 CaBi
          </p>
        </div>
        <div className="relative mx-auto aspect-square w-full max-w-[260px] sm:mx-0 sm:max-w-none">
          <Image
            src="/images/xiebit-avatar-v4.webp"
            alt="蟹比特红蟹与 Bitcoin 金币的徽章插画"
            fill
            sizes="(max-width: 639px) 260px, 240px"
            preload
            className="object-contain"
          />
        </div>
      </div>

      <div className="grid gap-6 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* 主数据：已认购 / 进度 / 关键参数 */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <Metric
              label="已认购份额"
              value={fmt(sold)}
              unit={`/ ${fmt(hardCap)} 份`}
              size="lg"
            />
            <p className="num pb-1 text-[20px] font-semibold leading-none text-strong">
              {pct.toFixed(2)}
              <span className="text-[11px] font-normal text-faint">%</span>
            </p>
          </div>

          <Progress
            value={pct}
            tick={hardCap > 0 ? softCap / hardCap * 100 : 0}
            className="mt-4"
          />
          <div className="mt-2 flex items-center justify-between text-[11px] leading-4 text-faint">
            <span>软顶 {fmt(softCap)} 份</span>
            <span>硬顶 {fmt(hardCap)} 份</span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-5 border-t border-line pt-5 sm:grid-cols-3">
            <Metric
              label="剩余可认购"
              value={fmt(remaining)}
              unit="份"
              size="sm"
            />
            <Metric
              label="认购单价"
              value={fmt(UNIT_PRICE)}
              unit="USDT / 份"
              size="sm"
            />
            <Metric
              label="每份配额"
              value={fmt(TOKENS_PER_SHARE)}
              unit="CaBi"
              size="sm"
            />
          </div>
        </div>

        {/* 账户 / 链状态：字段名与值两端对齐 */}
        <div className="rounded-lg border border-line bg-well px-4 py-3">
          <p className="kicker">NETWORK</p>
          <div className="mt-2 divide-y divide-line">
            <DataRow label="参与钱包" value="同步中" mono={false} tone="mute" />
            <DataRow label="链" value={chain} mono={false} />
            <DataRow
              label="认购状态"
              value={closed ? "已关闭" : "开放"}
              mono={false}
              tone={closed ? "mute" : "up"}
            />
            <DataRow label="认购方式" value="USDT 转账 · 自动登记" mono={false} tone="mute" />
            <DataRow label="领取方式" value={config ? "代币中心自行领取" : "待配置"} mono={false} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4 sm:px-6">
        <Link href="/dapp/subscribe" className="btn btn-gold h-10 px-5 text-xs">
          {closed ? "查看认购状态" : "立即认购"} <ArrowRight size={14} />
        </Link>
        <Link
          href="/dapp/exchange"
          className="btn btn-outline h-10 px-5 text-xs"
        >
          兑换商城
        </Link>
        <span className="ml-auto text-[11px] leading-4 text-faint">
          {closed
            ? "认购入口已关闭"
            : config
              ? "按份转入 USDT，确认后自动登记认购凭证"
              : "正在读取认购配置"}
        </span>
      </div>
    </Panel>
  );
}
