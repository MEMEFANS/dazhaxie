import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Coins,
  Gift,
  Megaphone,
  MessageCircle,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  UsersRound,
} from "lucide-react";
import {
  EXCHANGE_COST,
  HARD_CAP,
  TOKENS_PER_SHARE,
  TOTAL_SUPPLY,
  UNIT_PRICE,
  fmt,
} from "@/lib/constants";
import styles from "./landing.module.css";
import { OverviewStatus } from "./overview-status";

const shortcuts = [
  {
    href: "/dapp/subscribe",
    label: "生态认购",
    detail: "认购规则与配额",
    icon: ShoppingBag,
  },
  {
    href: "/dapp/token",
    label: "CaBi 代币",
    detail: "合约与资产查询",
    icon: Coins,
  },
  {
    href: "/dapp/exchange",
    label: "蟹礼兑换",
    detail: "规格与兑换规则",
    icon: Gift,
  },
  {
    href: "/dapp/promotion",
    label: "邀请蟹友",
    detail: "邀请规则与进度",
    icon: UsersRound,
  },
];

const metrics = [
  {
    value: `${fmt(TOTAL_SUPPLY / 100000000)} 亿`,
    label: "CaBi 代币总量",
  },
  { value: fmt(HARD_CAP), label: "认购份额硬顶" },
  { value: fmt(TOKENS_PER_SHARE), label: "每份 CaBi 配额" },
  { value: fmt(EXCHANGE_COST), label: "每份蟹礼消耗" },
];

const steps = [
  {
    number: "01",
    title: "了解生态份额",
    description: `查看认购规则与状态，当前配置为 ${fmt(UNIT_PRICE)} USDT / 份。`,
  },
  {
    number: "02",
    title: "查看 CaBi 配额",
    description: `每份对应 ${fmt(TOKENS_PER_SHARE)} CaBi 配额，可在代币中心查看记录。`,
  },
  {
    number: "03",
    title: "兑换实物蟹礼",
    description: `前往兑换商城挑选礼盒，每份蟹礼需转入 ${fmt(EXCHANGE_COST)} CaBi 到后台指定收款地址。`,
  },
];

export function Hero() {
  return (
    <div className={styles.container}>
      <section className={styles.homeBanner} aria-labelledby="landing-title">
        <Image
          src="/images/xiebit-home-banner-v4.webp"
          alt=""
          fill
          sizes="(max-width: 680px) 100vw, 1120px"
          preload
        />
        <div className={styles.bannerShade} aria-hidden="true" />
        <div className={styles.bannerContent}>
          <p className={styles.eyebrow}>XIE BIT CLUB · 生态总览</p>
          <h1 id="landing-title">
            今天也要
            <span>横着开心。</span>
          </h1>
          <p className={styles.bannerLead}>
            一点 MEME，一群蟹友。一起探索 CaBi 与真实蟹礼。
          </p>
          <div className={styles.heroActions}>
            <Link href="/dapp/token" className={styles.primaryButton}>
              查看 CaBi 资产 <ArrowRight size={15} />
            </Link>
            <a href="#ecosystem" className={styles.bannerTextLink}>
              了解生态 <ArrowUpRight size={14} />
            </a>
          </div>
          <p className={styles.bannerFootnote}>
            <ShieldCheck size={13} /> BTC 是视觉灵感 · 生态代币为 CaBi
          </p>
        </div>
      </section>

      <div className={styles.noticeBar} role="note">
        <span className={styles.noticeIcon}>
          <Megaphone size={16} />
        </span>
        <p>
          <strong>项目提示</strong>
          <span> 查看 CaBi 规则与链上接入状态。认购、领取与兑换开放进度以页面公告为准。</span>
        </p>
        <a href="#faq" aria-label="查看项目说明">
          <ArrowUpRight size={15} />
        </a>
      </div>

      <nav className={styles.quickLinks} aria-label="生态功能快捷入口">
        {shortcuts.map((item) => (
          <Link key={item.href} href={item.href} className={styles.quickLink}>
            <span className={styles.quickIcon}>
              <item.icon size={21} strokeWidth={1.9} />
            </span>
            <span className={styles.quickCopy}>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
            <ArrowUpRight className={styles.quickArrow} size={15} />
          </Link>
        ))}
      </nav>

      <OverviewStatus />

      <section id="ecosystem" className={styles.section} aria-labelledby="ecosystem-title">
        <div className={styles.sectionLabel}>
          <Sparkles size={18} aria-hidden="true" />
          <h2 id="ecosystem-title">蟹比特 · 生态参与</h2>
          <span>CaBi ECOSYSTEM</span>
        </div>
        <div className={styles.exploration}>
          <div className={styles.explorationHeader}>
            <Image
              src="/images/xiebit-ecosystem-v4.webp"
              alt=""
              fill
              sizes="(max-width: 680px) 100vw, 1120px"
            />
            <div className={styles.explorationShade} aria-hidden="true" />
            <div className={styles.explorationCopy}>
              <p className={styles.sectionKicker}>DISCOVER XIE BIT</p>
              <h3>把数字参与，带到蟹礼生活里</h3>
              <p>从生态份额到 CaBi 配额，再到实物蟹礼兑换。</p>
            </div>
          </div>
          <div className={styles.explorationBody}>
            <div className={styles.participationHeader}>
              <span>生态认购 · 每份额度</span>
              <span className={styles.ruleBadge}><ShieldCheck size={12} /> 规则参数</span>
            </div>
            <div className={styles.participationAmount}>
              <span className={styles.amountIcon}><Coins size={21} aria-hidden="true" /></span>
              <strong>{fmt(UNIT_PRICE)} <small>USDT</small></strong>
              <Link href="/dapp/subscribe">查看认购规则 <ArrowUpRight size={13} /></Link>
            </div>
            <div className={styles.metrics}>
              {metrics.map((metric) => (
                <div key={metric.label} className={styles.metric}>
                  <strong>{metric.value}</strong>
                  <small>{metric.label}</small>
                </div>
              ))}
            </div>
            <Link href="/dapp/subscribe" className={`${styles.primaryButton} ${styles.participationButton}`}>
              查看认购详情 <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      <section id="how-it-works" className={styles.section} aria-labelledby="steps-title">
        <div className={styles.sectionHead}>
          <p className={styles.sectionKicker}>HOW IT WORKS</p>
          <h2 id="steps-title">三步了解蟹比特</h2>
          <p>先看规则，再了解配额，最后选择适合自己的蟹礼。</p>
        </div>
        <div className={styles.steps}>
          {steps.map((step) => (
            <article key={step.number} className={styles.step}>
              <span className={styles.stepNumber}>{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.featureGrid} aria-label="蟹礼与社区">
        <article id="crab-gifts" className={styles.featureCard}>
          <div className={styles.featureImage}>
            <Image
              src="/images/xiebit-gift-v4.webp"
              alt="从紫色礼盒里探头、举起大蟹钳的漫画螃蟹"
              fill
              sizes="(max-width: 680px) 100vw, 520px"
            />
          </div>
          <div className={styles.featureCopy}>
            <p className={styles.sectionKicker}>CRAB GIFT MARKET</p>
            <h2>挑一份心仪蟹礼</h2>
            <p>查看礼盒规格、兑换条件与商品信息。</p>
            <Link href="/dapp/exchange" className={styles.textLink}>
              查看蟹礼兑换 <ArrowRight size={14} />
            </Link>
          </div>
        </article>

        <article id="community" className={styles.featureCard}>
          <div className={styles.featureImage}>
            <Image
              src="/images/xiebit-community-v4.webp"
              alt="两只戴像素墨镜的 MEME 螃蟹开心碰钳"
              fill
              sizes="(max-width: 680px) 100vw, 520px"
            />
          </div>
          <div className={styles.featureCopy}>
            <p className={styles.sectionKicker}>CRAB FRIENDS</p>
            <h2>和蟹友一起探索</h2>
            <p>进入社区查看公告、交流生态进展并联系支持。</p>
            <Link href="/dapp/community" className={styles.textLink}>
              进入蟹友社区 <MessageCircle size={14} />
            </Link>
          </div>
        </article>
      </section>

      <section id="faq" className={styles.section} aria-labelledby="faq-title">
        <div className={styles.sectionHead}>
          <p className={styles.sectionKicker}>GOOD TO KNOW</p>
          <h2 id="faq-title">开始之前，先了解这些</h2>
        </div>
        <div className={styles.faq}>
          <details className={styles.faqItem}>
            <summary>蟹比特里的 BTC 和 CaBi 是什么关系？</summary>
            <p>BTC 是视觉灵感元素；生态代币名称为 CaBi，两者不是同一种资产。</p>
          </details>
          <details className={styles.faqItem}>
            <summary>首页显示的数据代表实时链上状态吗？</summary>
            <p>CaBi 余额和持仓上限在配置合约后从当前项目网络查询，页面会分别标注查询状态。尚未配置、未连接钱包或查询失败的字段显示“—”。认购额度和兑换单价属于项目规则参数，不代表已发生认购或已分配资产。</p>
          </details>
          <details className={styles.faqItem}>
            <summary>CaBi 交易有哪些费用？</summary>
            <p>买入和卖出各收取 3% 交易手续费，普通钱包转账不收取交易手续费。卖出手续费代币用于销毁，实际成交数量以交易页面报价和钱包确认为准。</p>
          </details>
          <details className={styles.faqItem}>
            <summary>认购后什么时候可以领取 CaBi？</summary>
            <p>连接认购时使用的钱包，系统会读取链上认购记录，无需另行登记领取名单。配置定时领取池后，管理员存入 CaBi 并设置开放时间；到时可自行选择：直接领取50%，剩余50%销毁；或支付配对USDT领取70%，剩余30%实际组成LP，LP凭证归项目指定钱包。两种方式均需支付网络费用。实际额度、开放时间与领取状态以链上查询为准。</p>
          </details>
        </div>
      </section>
    </div>
  );
}
