﻿"use client";

// 服务未接入时保持空状态，不生成余额、业绩或交易记录。

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import type { OperationalSettings } from "./admin-settings";
import {
  HARD_CAP,
  floorShares,
  round2,
  teamTierIndex,
} from "./constants";
import {
  type TeamNode,
  countMembers,
  differentialOf,
  seedTeamTree,
  teamSharesOf,
} from "./team-tree";
import { DATA_SERVICE_CONNECTED } from "./data-status";
import * as wallet from "./wallet";

const STORAGE_KEY = "xbt-dapp-state-v2";
const LEGACY_STORAGE_KEY = "xbt-dapp-state-v1";

export interface RewardRecord {
  id: string;
  type: "direct" | "team";
  shares: number;
  at: number;
  detail: string;
}

export interface ShippingInfo {
  name: string;
  phone: string;
  address: string;
}

export interface ExchangeRecord {
  id: string;
  quantity: number;
  tokensBurned: number;
  at: number;
  shipping: ShippingInfo;
}

// 奖励池领取记录（一次选择永久不可更改）
export interface RewardClaim {
  address: string; // 领取地址（小写）
  mode: 0 | 1; // 0 不组 LP 领 50% / 1 组 LP 领 70%
  amount: number; // 实得 CaBi
  burned: number; // 剩余 50% 销毁量（mode 0 且开关为销毁）
  lpTokens: number; // 入 LP 的 30% 代币（mode 1）
  usdtPaid: number; // 支付的 30% USDT 等值（mode 1）
  at: number;
  txHash: string; // 已确认的链上交易哈希
}

// 奖励池操作日志（后台）
export interface RewardPoolLog {
  id: string;
  text: string;
  at: number;
}

export interface DAppState {
  connected: boolean;
  address: string;
  walletLabel: string; // 钱包标识（MetaMask / Coinbase Wallet…）
  chainId: number; // 当前链 ID（十进制，0 表示未知）
  usdtBalance: number;
  purchased: number; // 主动认购份数（限购 2）
  rewardShares: number; // 奖励空投份数（直推 + 团队）
  balance: number; // 可用代币余额
  // 独立奖励池（推广奖励 / 团队极差：链下核算写入，用户自领，50% / 70% 二选一）
  rewardPool: { balance: number; burned: number; burnRemainder: boolean };
  rewardClaimable: Record<string, number>; // 地址（小写）→ 可领额度（枚）
  rewardClaims: RewardClaim[]; // 领取记录
  rewardPoolLogs: RewardPoolLog[]; // 后台操作日志
  referrer: string | null; // 绑定的上级推广码（永久）
  myCode: string; // 我的推广码
  directCount: number; // 直推人数
  directShares: number; // 直推认购份数
  teamTree: TeamNode; // 未接入服务时为空的团队关系树
  globalSold: number; // 全局已认购份数
  subscribeLocked: boolean; // 后台锁定认购
  exchangeEnabled: boolean; // 兑换功能开关
  exchangePayee: string; // 兑换代币收款地址（后台配置）
  sensitiveWords: string[]; // 敏感词库（后台配置）
  rewards: RewardRecord[];
  exchanges: ExchangeRecord[];
  pool: { baseUsdt: number; burned: number; buybackUsdt: number };
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function emptyState(): DAppState {
  return {
    connected: false,
    address: "",
    walletLabel: "",
    chainId: 0,
    usdtBalance: 0,
    purchased: 0,
    rewardShares: 0,
    balance: 0,
    rewardPool: { balance: 0, burned: 0, burnRemainder: true },
    rewardClaimable: {},
    rewardClaims: [],
    rewardPoolLogs: [],
    referrer: null,
    myCode: "",
    directCount: 0,
    directShares: 0,
    teamTree: seedTeamTree(),
    globalSold: 0,
    subscribeLocked: true,
    exchangeEnabled: false,
    exchangePayee: "",
    sensitiveWords: [],
    rewards: [],
    exchanges: [],
    pool: { baseUsdt: 0, burned: 0, buybackUsdt: 0 },
  };
}

interface StoreValue {
  state: DAppState;
  hydrated: boolean;
  restored: boolean; // 钱包连接态恢复是否已完成（用于门禁等 UI 判断，避免恢复间隙闪窗）
  connecting: boolean;
  derived: {
    sharesOwned: number;
    rewardClaimableAmount: number; // 当前钱包奖励池可领额度（枚）
    myRewardClaim: RewardClaim | null; // 当前钱包领取记录（已领取则为非空）
    poolAllocated: number; // 奖励池已分配未领取合计
    poolClaimedTotal: number; // 奖励池已领取合计（用户实得）
    poolUnused: number; // 奖励池未分配可取回余额
    tierIdx: number; // 当前团队梯度档位
    teamShares: number; // 团队业绩份数（所有下级无限代认购份数，不含本人；关系树汇总）
    teamCount: number; // 团队人数（关系树成员数）
    teamRewardExact: number; // 层级差额极差应发份数（未取整）
    teamRewardPending: number; // 待结算份数（向下取整，上线前发放）
    hardCapped: boolean;
    subscribeOpen: boolean;
  };
  showToast: (text: string) => void;
  connect: () => void;
  disconnect: () => void;
  subscribe: (quantity: number) => boolean;
  claimReward: (mode: 0 | 1) => boolean; // 奖励池领取：0 不组 LP 领 50% / 1 组 LP 领 70%
  exchangeCrabs: (quantity: number, shipping: ShippingInfo) => boolean;
  bindReferrer: (code: string) => boolean;
  // 本地管理配置
  toggleSubscribeLock: () => void;
  toggleExchange: () => void;
  addSensitiveWord: (word: string) => Promise<boolean>;
  removeSensitiveWord: (word: string) => Promise<boolean>;
  simulateDirect: () => void;
  simulateTeam: () => void;
  addGlobalSold: (n: number) => void;
  // 奖励池后台能力
  depositRewardPool: (amount: number) => boolean;
  withdrawUnusedRewardPool: (amount: number) => boolean;
  batchSetRewardClaimable: (
    entries: Array<{ address: string; amount: number }>,
    mode: "increment" | "overwrite",
  ) => boolean;
  toggleRewardBurnRemainder: () => void;
  resetDemo: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore 必须在 StoreProvider 内使用");
  return ctx;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<DAppState>(() => emptyState());
  const [hydrated, setHydrated] = useState(false);
  const [restored, setRestored] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [toast, setToast] = useState<{ id: string; text: string } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const settingsQueue = useRef<Promise<unknown>>(Promise.resolve());

  // Retire browser-only business records. Chain and server data are authoritative.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const next: DAppState = emptyState();
      try {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Unavailable or invalid storage falls back to the empty state.
      }
      setState(next);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  // 先完成本地存档读取，再恢复钱包，避免初始化覆盖已恢复的连接态。
  useEffect(() => {
    if (!hydrated) return;
    let mounted = true;
    let chainRevision = 0;
    const syncChain = () => {
      const revision = ++chainRevision;
      wallet
        .getChainId()
        .then((id) => {
          if (mounted && revision === chainRevision) patch((s) => ({ ...s, chainId: id }));
        })
        .catch(() => {
          if (mounted && revision === chainRevision) patch((s) => ({ ...s, chainId: 0 }));
        });
    };
    void wallet.restore().then((conn) => {
      if (!mounted) return;
      setRestored(true);
      if (conn) {
        patch((s) => ({ ...s, connected: true, address: conn.address, walletLabel: conn.label, chainId: 0 }));
        syncChain();
      } else {
        // 钱包未安装或未授权：清理历史残留的连接态
        patch((s) =>
          s.connected || s.address ? { ...s, connected: false, address: "", walletLabel: "", chainId: 0 } : s,
        );
      }
    }).catch(() => {
      // 恢复失败也视为完成，避免依赖 restored 的 UI 永久等待。
      if (mounted) setRestored(true);
    });
    const off = wallet.onChange((conn) => {
      if (conn) {
        patch((s) => ({ ...s, connected: true, address: conn.address, walletLabel: conn.label, chainId: 0 }));
        syncChain();
      } else {
        ++chainRevision;
        patch((s) => ({ ...s, connected: false, address: "", walletLabel: "", chainId: 0 }));
      }
    });
    return () => {
      mounted = false;
      off();
    };
  }, [hydrated]);

  // Operational settings are shared server records; no browser archive can
  // activate a financial service. Those still require their own live adapter.
  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();
    const adminPage = pathname.startsWith("/admin") && pathname !== "/admin/login";
    const sync = async () => {
      try {
        const response = await fetch(adminPage ? "/api/admin/settings" : "/api/settings", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const body = await response.json();
        const settings = (adminPage ? body.settings : body) as Partial<OperationalSettings>;
        if (typeof settings.subscribeLocked !== "boolean" || typeof settings.exchangeEnabled !== "boolean") return;
        if (!controller.signal.aborted) setState(s => ({ ...s, subscribeLocked: settings.subscribeLocked!, exchangeEnabled: settings.exchangeEnabled!,
          ...(adminPage && Array.isArray(settings.sensitiveWords) ? { sensitiveWords: settings.sensitiveWords } : {}),
          ...(settings.exchangePayee ? { exchangePayee: settings.exchangePayee } : {}) }));
      } catch { /* Retain closed/default settings when the settings service is unavailable. */ }
    };
    void sync();
    const onFocus = () => { void sync(); };
    const timer = window.setInterval(onFocus, 30_000);
    window.addEventListener("focus", onFocus);
    window.addEventListener("cabi-operational-settings-updated", onFocus);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", onFocus); window.removeEventListener("cabi-operational-settings-updated", onFocus); };
  }, [hydrated, pathname]);

  // Toast 自动消失
  useEffect(() => {
    if (!toast) return;
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, [toast]);

  function showToast(text: string) {
    setToast({ id: uid(), text });
  }

  function patch(updater: (s: DAppState) => DAppState) {
    setState((s) => updater(s));
  }

  // 连接真实钱包（EIP-1193 注入钱包，如 MetaMask / Coinbase Wallet）
  async function connectWallet() {
    if (state.connected || connecting) return;
    setConnecting(true);
    try {
      const conn = await wallet.connect();
      patch((s) => ({ ...s, connected: true, address: conn.address, walletLabel: conn.label }));
      wallet
        .getChainId()
        .then((id) => patch((s) => ({ ...s, chainId: id })))
        .catch(() => {});
      showToast(`钱包已连接（${conn.label}）`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "钱包连接失败，请重试");
    } finally {
      setConnecting(false);
    }
  }

  function connect() {
    void connectWallet();
  }

  // Retired browser-only binding API: only the chain-backed entry gate may bind.
  function bindReferrer(): boolean {
    showToast("请在邀请入口填写邀请码，推荐关系由服务器保存，绑定无需 Gas。");
    return false;
  }

  // 断开钱包（本地断开，钱包侧授权保留，下次连接不再弹窗）
  function disconnect() {
    void wallet.disconnect();
    patch((s) => ({ ...s, connected: false, address: "", walletLabel: "", chainId: 0 }));
    showToast("钱包已断开连接");
  }

  // No local success path until a real backend/contract adapter is implemented.
  function unavailable(feature: string): false {
    showToast(`${feature}服务暂未开放，等待服务接入`);
    return false;
  }

  function subscribe(): boolean { return unavailable("认购"); }

  function claimReward(): boolean { return unavailable("领取"); }

  function exchangeCrabs(): boolean { return unavailable("兑换"); }

  // Queue changes against the latest server settings so rapid edits do not
  // overwrite one another with an older local copy.
  function persistSettings(update: (settings: OperationalSettings) => Omit<OperationalSettings, "updatedAt" | "exchangePayee" | "subscribePayee">, success: string): Promise<boolean> {
    const operation = settingsQueue.current.then(async () => {
      try {
        const response = await fetch("/api/admin/settings", { cache: "no-store" });
        if (!response.ok) throw new Error("请先登录管理后台");
        const { settings: previous } = await response.json() as { settings: OperationalSettings };
        const settings = { ...update(previous), exchangePayee: previous.exchangePayee, subscribePayee: previous.subscribePayee };
        const saved = await fetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
        const body = await saved.json();
        if (!saved.ok) throw new Error(body.error || "设置保存失败");
        const confirmed = body.settings as OperationalSettings;
        patch(s => ({ ...s, subscribeLocked: confirmed.subscribeLocked, exchangeEnabled: confirmed.exchangeEnabled, sensitiveWords: confirmed.sensitiveWords, exchangePayee: confirmed.exchangePayee }));
        window.dispatchEvent(new Event("cabi-operational-settings-updated"));
        showToast(success);
        return true;
      } catch (error) {
        showToast(error instanceof Error ? error.message : "设置未保存，请稍后重试");
        return false;
      }
    });
    settingsQueue.current = operation;
    return operation;
  }

  function toggleSubscribeLock() {
    void persistSettings(s => ({ subscribeLocked: !s.subscribeLocked, exchangeEnabled: s.exchangeEnabled, sensitiveWords: s.sensitiveWords }), "认购运营设置已保存；功能开放仍以服务状态为准");
  }

  function toggleExchange() {
    void persistSettings(s => ({ subscribeLocked: s.subscribeLocked, exchangeEnabled: !s.exchangeEnabled, sensitiveWords: s.sensitiveWords }), "兑换运营设置已保存；功能开放仍以服务状态为准");
  }

  async function addSensitiveWord(word: string): Promise<boolean> {
    const w = word.trim();
    if (!w) return false;
    if (state.sensitiveWords.includes(w)) {
      showToast("该敏感词已存在");
      return false;
    }
    return persistSettings(s => ({ subscribeLocked: s.subscribeLocked, exchangeEnabled: s.exchangeEnabled, sensitiveWords: [...new Set([...s.sensitiveWords, w])] }), `已保存敏感词：${w}`);
  }

  async function removeSensitiveWord(word: string): Promise<boolean> {
    return persistSettings(s => ({ subscribeLocked: s.subscribeLocked, exchangeEnabled: s.exchangeEnabled, sensitiveWords: s.sensitiveWords.filter(w => w !== word) }), "敏感词已从服务器移除");
  }

  function simulateDirect() { unavailable("业绩"); }

  function simulateTeam() { unavailable("业绩"); }

  function addGlobalSold() { unavailable("认购数据"); }

  function depositRewardPool(): boolean { return unavailable("奖励池"); }

  function withdrawUnusedRewardPool(): boolean { return unavailable("奖励池"); }

  function batchSetRewardClaimable(): boolean { return unavailable("配额"); }

  function toggleRewardBurnRemainder() { unavailable("奖励池"); }

  function resetDemo() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // 忽略
    }
    showToast("旧版本浏览器记录已清理，服务器设置和钱包连接不受影响");
  }

  const derived = useMemo(() => {
    const sharesOwned = round2(state.purchased + state.rewardShares);
    // 奖励池：当前钱包可领额度 / 领取记录 / 池统计
    const addrKey = state.address.toLowerCase();
    const rewardClaimableAmount = round2(state.rewardClaimable[addrKey] ?? 0);
    const myRewardClaim = state.rewardClaims.find((c) => c.address === addrKey) ?? null;
    const poolAllocated = round2(
      Object.values(state.rewardClaimable).reduce((sum, n) => sum + n, 0),
    );
    const poolClaimedTotal = round2(
      state.rewardClaims.reduce((sum, c) => sum + c.amount, 0),
    );
    const poolUnused = round2(state.rewardPool.balance - poolAllocated);
    // 团队关系树：总份数 / 层级差额极差（待结算，上线前发放）
    const teamShares = teamSharesOf(state.teamTree);
    const teamCount = countMembers(state.teamTree);
    const teamRewardExact = differentialOf(state.teamTree);
    const teamRewardPending = floorShares(teamRewardExact);
    const tierIdx = teamTierIndex(teamShares);
    const hardCapped = state.globalSold >= HARD_CAP;
    return {
      sharesOwned,
      rewardClaimableAmount,
      myRewardClaim,
      poolAllocated,
      poolClaimedTotal,
      poolUnused,
      tierIdx,
      teamShares,
      teamCount,
      teamRewardExact,
      teamRewardPending,
      hardCapped,
      subscribeOpen: DATA_SERVICE_CONNECTED && state.connected && !state.subscribeLocked && !hardCapped,
    };
  }, [state]);

  const value: StoreValue = {
    state,
    hydrated,
    restored,
    connecting,
    derived,
    showToast,
    connect,
    disconnect,
    subscribe,
    claimReward,
    exchangeCrabs,
    bindReferrer,
    toggleSubscribeLock,
    toggleExchange,
    addSensitiveWord,
    removeSensitiveWord,
    simulateDirect,
    simulateTeam,
    addGlobalSold,
    depositRewardPool,
    withdrawUnusedRewardPool,
    batchSetRewardClaimable,
    toggleRewardBurnRemainder,
    resetDemo,
  };

  return (
    <StoreContext.Provider value={value}>
      {children}
      {toast && (
        <div
          role="status"
          className="animate-toast-in fixed bottom-24 left-1/2 z-[90] flex max-w-[86vw] items-center gap-2 rounded-full border border-white/10 bg-[linear-gradient(180deg,#2b1a4a,#1d1233)] px-5 py-3 text-xs text-white shadow-pop backdrop-blur-xl"
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-purple" />
          <span className="truncate">{toast.text}</span>
        </div>
      )}
    </StoreContext.Provider>
  );
}
