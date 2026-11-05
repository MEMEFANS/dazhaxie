"use client";

import type { ReactNode } from "react";
import { ArrowUpRight, ShieldCheck, Wallet } from "lucide-react";
import { useStore } from "@/lib/store";
import { shortAddr } from "@/lib/constants";
import { chainConfig, contracts } from "@/lib/chain-config";
import { useTokenData } from "@/lib/chain-data";
import * as wallet from "@/lib/wallet";
import { CopyButton } from "./ui";
import { PancakeSwapLink } from "./pancake-swap-link";
import styles from "./shell.module.css";

function chainLabel(id: number) {
  const chains: Record<number, string> = { 1: "Ethereum", 56: "BNB Chain", 97: "BSC Testnet", 8453: "Base", 42161: "Arbitrum" };
  return chains[id] || `Chain ${id}`;
}

// This component, its RPC clients and its subscriptions exist only while the drawer is open.
export default function WalletDrawerContent({ children, addingToken, setAddingToken }: {
  children: ReactNode;
  addingToken: boolean;
  setAddingToken: (pending: boolean) => void;
}) {
  const { state, hydrated, connecting, connect, disconnect, showToast } = useStore();
  const connected = hydrated && state.connected;
  const wrongNetwork = connected && state.chainId !== chainConfig.id;
  const token = useTokenData();

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

  return <>
    <div className={styles.accountCard}>
      <span className={styles.accountIcon}><Wallet size={21} /></span>
      <p>{connected ? "钱包已连接" : "连接你的钱包"}</p>
      {connected ? <>
        <div className={styles.address}><strong>{shortAddr(state.address)}</strong><CopyButton value={state.address} label="复制钱包地址" /></div>
        <small>{state.walletLabel || "浏览器钱包"}{state.chainId > 0 ? ` · ${chainLabel(state.chainId)}` : ""}</small>
        {contracts.token && token.status === "ready" ? <button onClick={addToken} disabled={addingToken || wrongNetwork} className={styles.assetButton}>{addingToken ? "等待钱包确认…" : "添加 CaBi 到钱包"}</button> : null}
        <button onClick={disconnect} className={styles.disconnectButton}>断开连接</button>
      </> : <>
        <small>连接后查看份额、配额与兑换记录。</small>
        <button onClick={connect} disabled={connecting} className={styles.connectButton}><Wallet size={14} /> {connecting ? "连接中…" : "连接钱包"}</button>
      </>}
    </div>
    <PancakeSwapLink className="mt-4" />
    {children}
    <div className={styles.drawerFooter}>
      <ShieldCheck size={15} />
      <p>{chainConfig.shortName}<br /><span>{token.status === "ready" ? "代币信息已从链上同步" : token.status === "error" ? "代币查询暂不可用，可稍后重试" : contracts.token ? "正在查询代币信息" : "代币合约地址待配置"}</span></p>
      <ArrowUpRight size={14} />
    </div>
  </>;
}
