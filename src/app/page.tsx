import type { Metadata } from "next";
import { DAppShell } from "@/components/dapp/shell";
import { Hero } from "@/components/landing/hero";
import { Footer } from "@/components/landing/footer";
import styles from "@/components/landing/landing.module.css";

export const metadata: Metadata = {
  title: "生态总览 · 蟹比特 XIE BIT",
  description: "蟹比特生态总览：了解 CaBi 配额、生态进度、蟹礼兑换规则和蟹友社区。",
};

export default function Home() {
  return (
    <DAppShell>
      <div className={styles.page}>
        <Hero />
        <Footer />
      </div>
    </DAppShell>
  );
}
