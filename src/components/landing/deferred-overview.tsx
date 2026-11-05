"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import styles from "./landing.module.css";

function OverviewPlaceholder() {
  return <section className={styles.statusGrid} aria-label="账户与生态概况" aria-busy="true">
    {["我的参与", "认购进度"].map((title, index) => <div key={title} className={styles.statusCard} style={{ minHeight: index === 0 ? 220 : 180 }}>
      <div className={styles.statusHeading}><h2>{title}</h2></div>
      <p className={styles.statusNote}>正在准备账户与生态概况…</p>
    </div>)}
  </section>;
}

const OverviewStatus = dynamic(() => import("./overview-status").then((module) => module.OverviewStatus), {
  loading: OverviewPlaceholder,
});

export function DeferredOverview() {
  const { state, hydrated, restored } = useStore();
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const ready = hydrated && restored && state.connected;

  useEffect(() => {
    if (!ready || visible || !container.current) return;
    if (typeof window.IntersectionObserver !== "function") {
      const timer = window.setTimeout(() => setVisible(true), 0);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "160px" });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [ready, visible]);

  return <div ref={container}>{ready && visible ? <OverviewStatus /> : <OverviewPlaceholder />}</div>;
}
