"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight, ChevronRight, Coins, Headphones, House,
  Check, CircleAlert, LoaderCircle, MessageCircle, MoreHorizontal, Network, ShieldCheck, ShoppingBag, Users, Wallet, X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { shortAddr } from "@/lib/constants";
import { CopyButton } from "@/components/dapp/ui";
import { ReferralGate } from "@/components/dapp/referral-gate";
import { chainConfig, contracts } from "@/lib/chain-config";
import { useTokenData } from "@/lib/chain-data";
import { PancakeSwapLink } from "@/components/dapp/pancake-swap-link";
import * as wallet from "@/lib/wallet";
import styles from "./shell.module.css";

const primaryItems = [
  { href: "/", label: "首页", icon: House },
  { href: "/dapp/subscribe", label: "认购", icon: ShoppingBag },
  { href: "/dapp/token", label: "代币", icon: Coins },
  { href: "/dapp/promotion", label: "邀请", icon: Users },
  { href: "/dapp/team", label: "团队", icon: Network },
];

const communityItem = { href: "/dapp/community", label: "社群", icon: MessageCircle };
const mobileItems = primaryItems.map(item => item.href === "/dapp/promotion" ? communityItem : item);

const serviceItems = [
  { ...communityItem, detail: "公告、交流与生态动态" },
  { href: "/dapp/support", label: "联系支持", detail: "查看工单与常见问题", icon: Headphones },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" || pathname === "/dapp" : pathname.startsWith(href);
}

function chainLabel(id: number) {
  const chains: Record<number, string> = { 1: "Ethereum", 56: "BNB Chain", 97: "BSC Testnet", 8453: "Base", 42161: "Arbitrum" };
  return chains[id] || `Chain ${id}`;
}

export function DAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const overviewPage = pathname === "/" || pathname === "/dapp";
  const invitePage = pathname === "/dapp/promotion";
  const communityPage = pathname === "/dapp/community";
  const { state, hydrated, connecting, connect, disconnect, showToast } = useStore();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [addingToken, setAddingToken] = useState(false);
  const [previousPath, setPreviousPath] = useState(pathname);
  const drawerRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const connected = hydrated && state.connected;
  const wrongNetwork = connected && state.chainId !== chainConfig.id;
  const token = useTokenData();

  async function switchNetwork() {
    if (switching) return;
    setSwitching(true);
    try {
      const actualChain = await wallet.switchChain(chainConfig.id);
      if (actualChain !== chainConfig.id) throw new Error("网络尚未切换，请在钱包中确认");
      showToast(`已切换至 ${chainConfig.shortName}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "切换未完成，请在钱包中检查网络");
    } finally {
      setSwitching(false);
    }
  }

  async function addToken() {
    const connection = wallet.getConnection();
    if (!connection || !contracts.token || !token.data || addingToken) return;
    setAddingToken(true);
    try {
      if (await wallet.getChainId() !== chainConfig.id) throw new Error(`请先切换至 ${chainConfig.shortName}`);
      const accepted = await connection.provider.request({ method: "wallet_watchAsset", params: {
        type: "ERC20", options: { address: contracts.token, symbol: token.data.symbol, decimals: token.data.decimals },
      } });
      showToast(accepted === true ? "已添加到钱包资产列表" : "已取消添加代币");
    } catch {
      showToast("添加未完成，请在钱包中重试或手动添加合约地址");
    } finally {
      setAddingToken(false);
    }
  }

  if (previousPath !== pathname) {
    setPreviousPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!communityPage) return;
    const viewport = window.visualViewport;
    let element = shellRef.current;
    const resize = () => {
      element = shellRef.current;
      element?.style.setProperty("--chat-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
      element?.style.setProperty("--chat-viewport-top", `${viewport?.offsetTop ?? 0}px`);
    };
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
      window.removeEventListener("resize", resize);
      element?.style.removeProperty("--chat-viewport-height");
      element?.style.removeProperty("--chat-viewport-top");
    };
  }, [communityPage]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(drawerRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex="0"]',
    ) || []);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  return (
    <ReferralGate><div ref={shellRef} className={`${styles.shell} ${invitePage ? styles.inviteShell : ""} ${communityPage ? styles.communityShell : ""}`}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brand} aria-label="蟹比特首页">
            <Image src="/images/xiebit-avatar-v4.webp" alt="" width={40} height={40} preload />
            <span><strong>蟹比特</strong><small>XIE BIT CLUB</small></span>
          </Link>
          <nav className={styles.desktopNav} aria-label="主导航">
            {primaryItems.map(item => (
              <Link key={item.href} href={item.href} className={isActive(pathname, item.href) ? styles.active : undefined} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className={styles.headerActions}>
            <button onClick={connected ? () => setOpen(true) : connect} disabled={connecting} className={styles.walletButton} aria-label={connected ? "查看钱包账户" : connecting ? "正在连接钱包" : "连接钱包"}>
              {connecting ? <LoaderCircle size={15} className="animate-spin" /> : <Wallet size={15} />}
              <span>{connected ? shortAddr(state.address) : connecting ? "连接中…" : "连接钱包"}</span>
              {connected ? <i aria-hidden="true" /> : null}
            </button>
            <button onClick={() => setOpen(value => !value)} className={styles.moreButton} aria-label="账户与更多服务" aria-expanded={open} aria-controls="app-services">
              <MoreHorizontal size={22} />
            </button>
          </div>
        </div>
        <div className={styles.networkBar} role="status" aria-live="polite">
          <span className={styles.networkIdentity}><i data-testnet={chainConfig.isTestnet} />{chainConfig.shortName}{chainConfig.isTestnet ? " · 测试资产" : ""}</span>
          {wrongNetwork ? (
            <button onClick={switchNetwork} disabled={switching} className={styles.switchNetwork}>
              {switching ? <LoaderCircle size={13} className="animate-spin" /> : <CircleAlert size={13} />}
              {switching ? "等待钱包确认" : "切换到正确网络"}
            </button>
          ) : <span className={styles.networkState}>{connected ? <><Check size={12} /> 网络已匹配</> : "连接钱包查看个人资产"}</span>}
        </div>
      </header>
      <main id="home" className={communityPage ? styles.communityContent : overviewPage ? styles.overviewContent : invitePage ? styles.inviteContent : styles.content}>
        {children}
      </main>
      <nav className={styles.mobileNav} aria-label="主导航">
        {mobileItems.map(item => {
          const active = isActive(pathname, item.href);
          return (
            <Link key={item.href} href={item.href} className={active ? styles.active : undefined} aria-current={active ? "page" : undefined}>
              <item.icon size={20} strokeWidth={active ? 2.2 : 1.7} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className={`${styles.backdrop} ${open ? styles.backdropOpen : ""}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <aside ref={drawerRef} id="app-services" className={`${styles.drawer} ${open ? styles.drawerOpen : ""}`} role="dialog" aria-modal="true" aria-label="账户与更多服务" aria-hidden={!open} inert={!open}>
        <div className={styles.drawerHeading}>
          <span><small>YOUR CORNER</small><strong>账户与服务</strong></span>
          <button onClick={() => setOpen(false)} aria-label="关闭服务面板"><X size={20} /></button>
        </div>
        <div className={styles.accountCard}>
          <span className={styles.accountIcon}><Wallet size={21} /></span>
          <p>{connected ? "钱包已连接" : "连接你的钱包"}</p>
          {connected ? (
            <>
              <div className={styles.address}><strong>{shortAddr(state.address)}</strong><CopyButton value={state.address} label="复制钱包地址" /></div>
              <small>{state.walletLabel || "浏览器钱包"}{state.chainId > 0 ? ` · ${chainLabel(state.chainId)}` : ""}</small>
              {contracts.token && token.status === "ready" ? <button onClick={addToken} disabled={addingToken || wrongNetwork} className={styles.assetButton}>{addingToken ? "等待钱包确认…" : "添加 CaBi 到钱包"}</button> : null}
              <button onClick={disconnect} className={styles.disconnectButton}>断开连接</button>
            </>
          ) : (
            <>
              <small>连接后查看份额、配额与兑换记录。</small>
              <button onClick={connect} disabled={connecting} className={styles.connectButton}><Wallet size={14} /> {connecting ? "连接中…" : "连接钱包"}</button>
            </>
          )}
        </div>
        <PancakeSwapLink className="mt-4" />
        <p className={styles.drawerLabel}>蟹友服务</p>
        <nav className={styles.serviceNav} aria-label="服务导航">
          {serviceItems.map(item => (
            <Link key={item.href} href={item.href} onClick={() => setOpen(false)} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
              <span className={styles.serviceIcon}><item.icon size={19} /></span>
              <span><strong>{item.label}</strong><small>{item.detail}</small></span>
              <ChevronRight size={15} />
            </Link>
          ))}
        </nav>
        <div className={styles.drawerFooter}>
          <ShieldCheck size={15} />
          <p>{chainConfig.shortName}<br /><span>{token.status === "ready" ? "代币信息已从链上同步" : token.status === "error" ? "代币查询暂不可用，可稍后重试" : contracts.token ? "正在查询代币信息" : "代币合约地址待配置"}</span></p>
          <ArrowUpRight size={14} />
        </div>
      </aside>
    </div></ReferralGate>
  );
}
