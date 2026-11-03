"use client";

import Image from "next/image";
import { ArrowUpRight, Sparkles, Ticket } from "lucide-react";
import { useSubscribeConfig } from "@/lib/subscribe-data";
import styles from "./subscribe.module.css";
import mascotStyles from "./mobile-mascot.module.css";

export function CapHeader() {
  const query = useSubscribeConfig(), data = query.data;
  const closed = Boolean(data && (!data.enabled || data.remainingGlobal <= 0));
  const ready = Boolean(data?.configured);
  const percentage = data && data.hardCap > 0 ? Math.min(100, Math.max(0, data.globalSold / data.hardCap * 100)) : 0;
  const number = (value: number) => value.toLocaleString("en-US");
  const status = query.status === "error" ? "查询失败" : !data ? "读取配置中" : !ready ? "等待开放" : closed ? "认购已关闭" : "认购进行中";

  return (
    <section className={styles.hero} aria-labelledby="subscribe-title">
      <div className={styles.heroBody}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><Ticket size={14} /> XIE BIT CLUB / 生态认购</p>
          <h1 id="subscribe-title"><span className={styles.desktopTitle}>认购一份，<br />开启蟹友之旅<span>。</span></span><span className={styles.mobileTitle}>份额认购</span></h1>
          <p className={styles.heroDescription}><span className={styles.desktopTitle}>使用 USDT 认购生态份额，获得对应 CaBi 配额。</span><span className={styles.mobileTitle}>USDT 认购 · CaBi 生态配额</span></p>
          <div className={styles.heroMetrics}>
            <div><span>每份价格</span><strong>{data ? number(data.unitPrice) : "—"}<small>USDT</small></strong></div>
            <div><span>每份配额</span><strong>{data ? number(data.tokensPerShare) : "—"}<small>CaBi</small></strong></div>
            <div><span>每钱包限购</span><strong>{data ? number(data.maxShares) : "—"}<small>份</small></strong></div>
          </div>
        </div>
        <div className={`${styles.ticketStage} ${mascotStyles.desktopArt}`} aria-hidden="true">
          <div className={styles.orbit} />
          <Sparkles className={styles.sparkleOne} size={29} strokeWidth={1.4} />
          <Sparkles className={styles.sparkleTwo} size={20} strokeWidth={1.5} />
          <div className={styles.ticketBack} />
          <div className={styles.ticket}>
            <div className={styles.ticketMain}>
              <div className={styles.ticketBrand}>XIE BIT CLUB <ArrowUpRight size={17} /></div>
              <div className={styles.ticketIdentity}>
                <div><span>一起加入蟹友俱乐部</span><strong>CaBi<span>生态份额</span></strong></div>
                <Image src="/images/xiebit-avatar-v4.webp" alt="" width={98} height={98} sizes="98px" preload />
              </div>
              <div className={styles.ticketBottom}><span>YOUR NEXT CHAPTER</span><span>一份热爱 · 一起出发</span></div>
            </div>
            <div className={styles.ticketStub}><span>SUBSCRIPTION</span><i /><Ticket size={23} strokeWidth={1.3} /></div>
          </div>
          <div className={styles.ticketCaption}><span /> 让每一份参与，都有迹可循</div>
        </div>
        <div className={mascotStyles.mobileBadge} aria-hidden="true">
          <Image src="/images/xiebit-avatar-v4.webp" alt="" width={84} height={84} sizes="(max-width: 360px) 64px, 84px" />
          <Sparkles size={17} strokeWidth={1.7} className={mascotStyles.sparkle} />
        </div>
      </div>
      <div className={styles.capProgress}>
        <div className={styles.progressHeading}>
          <div><h2>认购进度</h2><span className={styles.status} data-tone={query.status === "error" ? "error" : ready && !closed ? "live" : "neutral"}><i />{status}</span></div>
          <p>{data ? percentage.toFixed(1) : "—"}<span>%</span></p>
        </div>
        <div className={styles.progressTrack} role="progressbar" aria-label="已认购份额占比" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={data ? `已认购 ${data.globalSold} 份，共 ${data.hardCap} 份` : "正在读取认购进度"}><div style={{ width: `${percentage}%` }} /></div>
        <div className={styles.progressLabels}><span>已认购 <strong>{data ? number(data.globalSold) : "—"}</strong><span> / {data ? number(data.hardCap) : "—"} 份</span></span><span>剩余 <strong>{data ? number(data.remainingGlobal) : "—"}</strong> 份</span></div>
      </div>
    </section>
  );
}
