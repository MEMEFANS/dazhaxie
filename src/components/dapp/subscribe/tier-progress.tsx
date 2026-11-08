import { SUBSCRIPTION_PRICE_TIERS } from "@/lib/constants";
import styles from "./tier-progress.module.css";

interface TierProgressProps {
  sold?: number;
  tiers?: readonly { until: number; price: number }[];
}

export function TierProgress({ sold, tiers = SUBSCRIPTION_PRICE_TIERS }: TierProgressProps) {
  const known = sold !== undefined && Number.isFinite(sold);
  const total = tiers.at(-1)?.until ?? 0;
  const totalSold = known ? Math.min(total, Math.max(0, Math.floor(sold))) : 0;

  return <div
    className={styles.progress}
    role="progressbar"
    aria-label="认购进度"
    aria-valuemin={0}
    aria-valuemax={total}
    aria-valuenow={known ? totalSold : undefined}
    aria-valuetext={known ? `已认购 ${totalSold.toLocaleString("en-US")} / ${total.toLocaleString("en-US")} 份` : "正在读取认购进度"}
  >
    {tiers.map((tier, index) => {
      const start = index === 0 ? 0 : tiers[index - 1].until;
      const capacity = tier.until - start;
      const filled = Math.min(capacity, Math.max(0, totalSold - start));

      return <span key={tier.until} className={styles.segment} data-tone={index % 4} style={{ flexGrow: capacity }} aria-hidden="true">
        <span className={styles.fill} style={{ width: `${capacity > 0 ? filled / capacity * 100 : 0}%` }} />
      </span>;
    })}
  </div>;
}
