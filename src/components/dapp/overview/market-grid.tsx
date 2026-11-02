"use client";

// 兑换商城：商品网格（手机 1 列 / 平板 2 列 / 桌面 3 列）

import { Info } from "lucide-react";
import { useStore } from "@/lib/store";
import { EXCHANGE_COST, MAX_EXCHANGE_PER_TIME, fmt } from "@/lib/constants";
import { ProductCard } from "@/components/dapp/overview/product-card";
import { SectionHead } from "@/components/dapp/ui";

const PRODUCTS = [
  {
    id: "single",
    name: "单份装",
    shares: 1,
    desc: "当季大闸蟹 1 份，标准礼盒包装。",
    recommended: false,
  },
  {
    id: "double",
    name: "双份装",
    shares: 2,
    desc: "当季大闸蟹 2 份，双蟹礼盒包装。",
    recommended: true,
  },
  {
    id: "family",
    name: "五份装",
    shares: 5,
    desc: "当季大闸蟹 5 份，整箱包装。",
    recommended: false,
  },
];

export function MarketGrid() {
  const { state } = useStore();
  const paused = !state.exchangeEnabled;

  return (
    <section>
      <SectionHead
        eyebrow="REDEEM MARKET"
        title="兑换商城"
        desc="使用 CaBi 兑换实物蟹礼，代币转入后台指定收款地址"
        right={
          <span className="num text-[11px] leading-5 text-mute">
            {fmt(EXCHANGE_COST)} CaBi / 份 · 单次 ≤ {MAX_EXCHANGE_PER_TIME} 份
          </span>
        }
      />

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PRODUCTS.map((product, i) => (
          <ProductCard
            key={product.id}
            index={i + 1}
            name={product.name}
            shares={product.shares}
            desc={product.desc}
            recommended={product.recommended}
            paused={paused}
          />
        ))}
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] leading-5 text-faint">
        <span className="flex items-center gap-1.5">
          <Info size={12} /> 库存与每人限兑规则尚未接入，兑换以提交结果为准
        </span>
        <span>所有金额按份数 × 单价计算</span>
      </p>
    </section>
  );
}
