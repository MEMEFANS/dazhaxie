"use client";

import { useStore } from "@/lib/store";
import { LoadingBlock } from "@/components/dapp/ui";
import { CapHeader } from "@/components/dapp/subscribe/cap-header";
import { PurchasePanel } from "@/components/dapp/subscribe/purchase-panel";
import { ProgressCard } from "@/components/dapp/subscribe/progress-card";
import styles from "@/components/dapp/subscribe/subscribe.module.css";

export default function SubscribePage() {
  const { hydrated } = useStore();
  if (!hydrated) return <LoadingBlock />;

  return (
    <div className={styles.page}>
      <CapHeader />
      <div className={styles.workspace}>
        <PurchasePanel />
        <ProgressCard />
      </div>
    </div>
  );
}

