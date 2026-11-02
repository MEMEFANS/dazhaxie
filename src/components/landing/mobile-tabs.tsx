"use client";

import { useEffect, useState } from "react";
import { Coins, House, Route, UsersRound } from "lucide-react";
import styles from "./landing.module.css";

const tabs = [
  { href: "#home", label: "首页", icon: House },
  { href: "#ecosystem", label: "生态", icon: Coins },
  { href: "#how-it-works", label: "参与", icon: Route },
  { href: "#community", label: "蟹友", icon: UsersRound },
];

export function MobileTabs() {
  const [activeTab, setActiveTab] = useState("#home");

  useEffect(() => {
    let frame = 0;
    const updateActiveTab = () => {
      const threshold = Math.min(window.innerHeight * 0.3, 180);
      let current = tabs[0].href;
      for (const tab of tabs) {
        const section = document.getElementById(tab.href.slice(1));
        if (section && section.getBoundingClientRect().top <= threshold) {
          current = tab.href;
        }
      }
      setActiveTab(current);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateActiveTab);
    };

    updateActiveTab();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <nav className={styles.mobileTabs} aria-label="首页快捷导航">
      {tabs.map((tab) => (
        <a
          key={tab.href}
          href={tab.href}
          className={activeTab === tab.href ? styles.mobileTabActive : undefined}
          aria-current={activeTab === tab.href ? "location" : undefined}
        >
          <tab.icon size={18} strokeWidth={activeTab === tab.href ? 2.3 : 1.9} />
          <span>{tab.label}</span>
        </a>
      ))}
    </nav>
  );
}
