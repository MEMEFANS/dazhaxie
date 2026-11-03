"use client";

import { useId } from "react";
import { parseUnits } from "viem";
import { formatAssetAmount } from "@/lib/amounts";
import type { SubscribeConfig } from "@/lib/subscribe-data";
import styles from "./share-options.module.css";

type ShareOptionsProps = {
  value: number;
  onChange: (value: number) => void;
  config?: SubscribeConfig;
  available: number;
  disabled: boolean;
};

export function ShareOptions({ value, onChange, config, available, disabled }: ShareOptionsProps) {
  const id = useId();
  const minimum = Math.max(1, Math.ceil(config?.minShares ?? 1));
  const maximum = Math.max(0, Math.floor(config?.maxShares ?? 0));
  const canChoose = Boolean(config?.configured && config.enabled) && !disabled;
  const limit = Math.min(maximum, Math.max(0, Math.floor(available)));

  function amounts(shares: number) {
    if (!config) return { price: "—", allocation: "—" };
    return {
      price: formatAssetAmount(parseUnits(String(config.unitPrice), config.usdtDecimals) * BigInt(shares), config.usdtDecimals),
      allocation: formatAssetAmount(parseUnits(String(config.tokensPerShare), config.tokenDecimals) * BigInt(shares), config.tokenDecimals),
    };
  }

  const selected = amounts(value);
  const count = Math.max(0, maximum - minimum + 1);

  return (
    <fieldset className={styles.fieldset} aria-busy={!config}>
      <legend className={styles.legend}>认购数量<span className={styles.limit}>每钱包限购 {config ? maximum : "—"} 份</span></legend>
      {!config ? (
        <div className={styles.options} aria-label="正在读取可选份额">
          {[0, 1].map(index => <div key={index} className={styles.placeholder} aria-hidden="true"><span /><span /><span /></div>)}
        </div>
      ) : count > 6 ? (
        <div className={styles.custom}>
          <label htmlFor={`${id}-quantity`}>选择份数 <span>{minimum}–{maximum} 份</span></label>
          <input id={`${id}-quantity`} type="number" inputMode="numeric" min={minimum} max={limit} step={1} value={value} disabled={!canChoose || limit < minimum} onChange={event => {
            const quantity = event.currentTarget.valueAsNumber;
            if (Number.isSafeInteger(quantity) && quantity >= minimum && quantity <= limit) onChange(quantity);
          }} />
          <div className={styles.customSummary}><strong>{selected.price}<small>USDT</small></strong><p>{selected.allocation} CaBi 配额</p></div>
        </div>
      ) : count > 0 ? (
        <div className={styles.options}>
          {Array.from({ length: count }, (_, index) => minimum + index).map(shares => {
            const { price, allocation } = amounts(shares);
            const unavailable = shares > limit;
            const priceId = `${id}-price-${shares}`;
            const quotaId = `${id}-quota-${shares}`;
            return (
              <label key={shares} className={styles.option}>
                <input type="radio" name={`${id}-shares`} value={shares} checked={value === shares} disabled={!canChoose || unavailable} onChange={() => onChange(shares)} aria-label={`认购 ${shares} 份`} aria-describedby={`${priceId} ${quotaId}`} className={styles.input} />
                <span className={styles.card}>
                  <span className={styles.cardHeading}><strong>{shares}<small>份生态份额</small></strong><span className={styles.radioMark} aria-hidden="true" /></span>
                  <span id={priceId} className={styles.price}>{price}<small>USDT</small></span>
                  <span id={quotaId} className={styles.allocation}>{allocation}<span> CaBi 配额</span></span>
                  <span className={styles.cardFoot}>{unavailable ? "剩余可购份额不足" : value === shares ? "已选择" : "点击选择"}</span>
                </span>
              </label>
            );
          })}
        </div>
      ) : <p className={styles.empty}>当前暂无可选份额</p>}
    </fieldset>
  );
}
