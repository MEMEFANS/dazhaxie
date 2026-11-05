// 蟹比特业务常量与规则计算（项目配置）

// 3.1 认购基础规则
export const UNIT_PRICE = 50; // USDT / 份
export const MIN_SHARES = 1; // 单账户最低限购
export const MAX_SHARES = 2; // 单账户最高限购

// 3.2 全局总量封顶
export const SOFT_CAP = 10000; // 软顶（阶段性预警）
export const HARD_CAP = 20000; // 硬顶（永久封顶）

// 5.2 代币分配
export const TOTAL_SUPPLY = 1_000_000_000; // 总量 10 亿，永不增发
export const TOKENS_PER_SHARE = 35000; // 每份认购对应的代币配额（枚）
export const EXCHANGE_COST = 3500; // 兑换一份大闸蟹需转入收款地址的代币数量（不走兑换合约）
export const MAX_EXCHANGE_PER_TIME = 20; // 单次兑换最多份数

// 默认持仓规则；当前实际值和地址豁免状态从代币合约读取。
export const MAX_WALLET_BALANCE = 200000; // 默认单地址持仓上限（枚）；owner 可在代币合约中调整

// 三、代币交易机制
export const BUY_FEE_BPS = 300; // pancake: 买入扣3% CaBi，换USDT后固定50/50分账；legacy gateway: 支付额3% USDT
export const PAYOUT_SPLIT_BPS = 5000; // 税款兑换所得分发比例：5000 给分配地址，其余给回购池（余数归回购池）
export const SELL_FEE_BPS = 300; // 卖出数量的 3% CaBi -> 黑洞地址
export const BUY_FEE_RATE = BUY_FEE_BPS / 10000;
export const SELL_FEE_RATE = SELL_FEE_BPS / 10000;
export const LP_RATIO = 0.3; // 认购领取计划中的金库配对比例；转账至金库，不自动创建LP

// 历史 XBTRewardPool 金库规则；新版 CaBiClaimPool 固定直接50% / 真实组LP70%，独立读取链上规则。
export const REWARD_DIRECT_RATIO = 0.5; // 直接领取：领取可领额度的 50%
export const REWARD_LP_RATIO = 0.7; // 金库配对领取：领取可领额度的 70%
export const REWARD_LP_TOKEN_RATIO = 0.3; // 金库配对领取：30% 代币进入配置金库，不自动创建LP
export const REWARD_LP_USDT_RATIO = 0.3; // 金库配对领取：另支付30% USDT等值（按配额与单价折算）
export const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD"; // 黑洞销毁地址
export const LP_VAULT_ADDRESS = ""; // 尚未配置真实领取金库；不是AMM交易对地址

// 金库配对领取需付USDT：配额折算认购单价后的30%；不代表已添加流动性
export function rewardLpUsdtDue(amount: number): number {
  return round2((Math.max(0, amount) / TOKENS_PER_SHARE) * UNIT_PRICE * REWARD_LP_USDT_RATIO);
}

// 3.4 团队业绩梯度（团队业绩 = 所有下级无限代总认购份数）
export const TEAM_TIERS = [
  { threshold: 100, rate: 0.01, label: "1%" },
  { threshold: 200, rate: 0.02, label: "2%" },
  { threshold: 500, rate: 0.03, label: "3%" },
  { threshold: 1000, rate: 0.04, label: "4%" },
  { threshold: 2000, rate: 0.05, label: "5%" },
] as const;

// 当前团队梯度档位下标，-1 表示未达标
export function teamTierIndex(teamShares: number): number {
  let idx = -1;
  for (let i = 0; i < TEAM_TIERS.length; i++) {
    if (teamShares >= TEAM_TIERS[i].threshold) idx = i;
  }
  return idx;
}

// 档位比例：按团队总份数取档（TEAM_TIERS 为唯一来源，梯度表展示与奖励计算共用）
export function teamRate(shares: number): number {
  const idx = teamTierIndex(shares);
  return idx >= 0 ? TEAM_TIERS[idx].rate : 0;
}

// 档位比例标签（展示用，与计算同源）
export function teamTierLabel(shares: number): string {
  const idx = teamTierIndex(shares);
  return idx >= 0 ? TEAM_TIERS[idx].label : "0%";
}

export interface TeamRewardBranch {
  selfShares: number; // 直接下级本人认购；不计入该下级自己的团队档位
  teamShares: number; // 该下级的全部下级认购，不含本人
}

// 已确认的完整极差口径：每个分支 = 本档比例 × 直接下级本人认购
// + max(本档比例 − 下级团队档位比例, 0) × 下级团队业绩。
// 直接下级本人认购也参与上级奖励；同档时仅其下级团队差额为0，不漏掉其本人。
// 数字数组保留旧纯团队调用语义，等价于各分支 selfShares=0。
export function teamDifferential(ownShares: number, children: readonly (number | TeamRewardBranch)[]): number {
  const ownPercent = Math.round(teamRate(ownShares) * 100);
  let hundredths = 0;
  for (const child of children) {
    const selfShares = typeof child === "number" ? 0 : child.selfShares;
    const childShares = typeof child === "number" ? child : child.teamShares;
    const childPercent = Math.round(teamRate(childShares) * 100);
    hundredths += ownPercent * selfShares + Math.max(ownPercent - childPercent, 0) * childShares;
  }
  return round2(hundredths / 100);
}

// 结算取整：「份」是离散单位，向下取整到整数份
export function floorShares(shares: number): number {
  return Math.floor(Math.max(0, shares));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function fmt2(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function shortAddr(addr: string): string {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";
}

export function timeAgo(at: number): string {
  const diff = Math.max(0, Date.now() - at);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return new Date(at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
