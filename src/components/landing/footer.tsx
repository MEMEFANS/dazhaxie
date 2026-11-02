import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import styles from "./landing.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`${styles.container} ${styles.footerInner}`}>
        <Link href="/" className={styles.footerBrand} aria-label="蟹比特首页">
          <Image src="/images/xiebit-avatar-v4.webp" alt="" width={30} height={30} />
          蟹比特 · XIE BIT
        </Link>
        <div className={styles.footerNote}>
          <p>© 2026 XIE BIT · 螃蟹与数字生活</p>
          <p>
            BTC 为视觉灵感，生态代币为 CaBi。需要帮助？{" "}
            <Link href="/dapp/support">
              联系支持 <ArrowUpRight size={11} />
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
