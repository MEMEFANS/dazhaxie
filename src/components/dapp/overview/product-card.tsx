"use client";

// 商品卡（Web3 橱窗）：规格 / 所需代币 / 限兑 / 库存状态 / 兑换入口
// MEME 礼盒插画仅作示意，兑换金额继续使用业务常量计算。

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EXCHANGE_COST, MAX_EXCHANGE_PER_TIME, fmt } from "@/lib/constants";
import { Badge, DataRow, StatusPill } from "@/components/dapp/ui";

export function ProductCard({
  index,
  name,
  shares,
  desc,
  recommended = false,
  paused = false,
}: {
  index: number;
  name: string;
  shares: number;
  desc: string;
  recommended?: boolean;
  paused?: boolean;
}) {
  const cost = shares * EXCHANGE_COST;

  return (
    <article className="flex h-full flex-col rounded-xl border border-line bg-card p-4 transition-colors duration-200 hover:border-purple/30">
      <div className="relative mb-4 aspect-[1.5] overflow-hidden rounded-xl bg-[#f7effb]">
        <Image
          src="/images/xiebit-gift-v4.webp"
          alt="紫金礼盒与蟹比特螃蟹吉祥物的蟹礼示意插画"
          fill
          sizes="(max-width: 639px) 90vw, (max-width: 1023px) 44vw, 350px"
          className="object-contain"
        />
        <span className="absolute bottom-2 right-2 rounded-full bg-white/85 px-2 py-1 text-[9px] text-mute">
          蟹礼示意插画
        </span>
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="num grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line bg-well text-[11px] text-mute">
            {String(index).padStart(2, "0")}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-strong">
              {name}
            </p>
            <p className="mt-0.5 text-[11px] text-faint">实物兑换</p>
          </div>
        </div>
        {recommended ? <Badge tone="gold">推荐</Badge> : null}
      </div>

      <p className="mt-3 line-clamp-2 min-h-[40px] text-[12px] leading-5 text-mute">
        {desc}
      </p>

      <div className="mt-4">
        <p className="kicker">REDEEM COST</p>
        <p className="num mt-1 text-[22px] font-semibold leading-none tracking-tight text-strong">
          {fmt(cost)}
          <span className="ml-1 font-sans text-[11px] font-normal text-faint">
            CaBi
          </span>
        </p>
      </div>

      <div className="mt-3 divide-y divide-line rounded-lg border border-line bg-well/60 px-3">
        <DataRow label="单次上限" value={`${MAX_EXCHANGE_PER_TIME} 份`} />
        <DataRow label="每人限兑" value="未配置" mono={false} tone="mute" />
        <DataRow
          label="库存"
          value={<StatusPill tone="neutral">同步中</StatusPill>}
          mono={false}
        />
      </div>

      <div className="mt-auto pt-4">
        {paused ? (
          <span className="flex h-9 w-full cursor-not-allowed items-center justify-center rounded-lg border border-line bg-raise/50 text-xs text-faint">
            兑换已暂停
          </span>
        ) : (
          <Link
            href="/dapp/exchange"
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-plum/5 text-xs font-medium text-strong transition-colors duration-200 hover:border-gold/35 hover:text-gold"
          >
            兑换 <ArrowRight size={13} />
          </Link>
        )}
        <p className="mt-2 text-center text-[10px] leading-4 text-faint">
          代币转入后台指定收款地址
        </p>
      </div>
    </article>
  );
}
