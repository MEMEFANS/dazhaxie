import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import styles from "./landing.module.css";

const navItems = [
  { label: "生态介绍", href: "#ecosystem" },
  { label: "参与流程", href: "#how-it-works" },
  { label: "蟹礼兑换", href: "#crab-gifts" },
  { label: "社群", href: "#community" },
];

export function Header() {
  return (
    <header className={styles.header}>
      <div className={`${styles.container} ${styles.headerInner}`}>
        <Link href="/" className={styles.brand} aria-label="蟹比特首页">
          <Image
            src="/images/xiebit-avatar-v4.webp"
            alt=""
            width={40}
            height={40}
            preload
          />
          <span>
            <strong>蟹比特</strong>
            <small>XIE BIT</small>
          </span>
        </Link>

        <nav className={styles.desktopNav} aria-label="首页导航">
          {navItems.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>

        <Link href="/" className={styles.headerAction}>
          进入应用 <ArrowUpRight size={14} />
        </Link>
      </div>
    </header>
  );
}
