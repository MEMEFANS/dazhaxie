import { SUBSCRIPTION_PRICE_TIERS } from "@/lib/constants";
import styles from "./tier-progress.module.css";

interface TierProgressProps {
  sold?: number;
  tiers?: readonly { until: number; price: number }[];
}

export function TierProgress({ sold, tiers = SUBSCRIPTION_PRICE_TIERS }: TierProgressProps) {
  const known = sold !== undefined && Number.isFinite(sold);
  const totalSold = known ? Math.max(0, Math.floor(sold)) : 0;

  return <ol className={styles.tiers} aria-label="分档认购进度">
    {tiers.map((tier, index) => {
      const start = index === 0 ? 0 : tiers[index - 1].until;
      const capacity = tier.until - start;
      const filled = Math.min(capacity, Math.max(0, totalSold - start));
      const complete = known && filled === capacity;
      const current = known && totalSold >= start && totalSold < tier.until;
      const status = !known ? "待更新" : complete ? "已售罄" : current ? "当前档" : "待开启";

      return <li key={tier.until} className={styles.tier} data-tone={index % 4} aria-current={current ? "step" : undefined}>
        <span className={styles.label}>第 {index + 1} 档</span>
        <div className={styles.price}><strong>{tier.price}</strong><span>USDT</span></div>
        <div className={styles.track} role="progressbar" aria-label={`第 ${index + 1} 档，${tier.price} USDT / 份`} aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={known ? filled : undefined} aria-valuetext={known ? `${status}，已售 ${filled.toLocaleString("en-US")} / ${capacity.toLocaleString("en-US")} 份` : "正在读取认购进度"}>
          <span className={styles.fill} style={{ width: `${capacity > 0 ? filled / capacity * 100 : 0}%` }} />
        </div>
        <span className={styles.capacity}>{capacity.toLocaleString("en-US")} 份</span>
        <span className={styles.status} data-active={current || complete}>{status}</span>
      </li>;
    })}
  </ol>;
}
