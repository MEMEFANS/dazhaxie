export interface LiquidityAccessSettings { scope: string; enabled: boolean; revision: number; updatedAt: number }
export interface LiquidityAccessStatus {
  settings: LiquidityAccessSettings;
  chainId: number; token: string | null; pool: string | null;
  chain: null | { liquidityEnabled: boolean; claimOpen: boolean; tradingOpen: boolean; claimStartsAt: number; tradingStartsAt: number; canPrepare: boolean };
  available: boolean; reason: string; checkedAt: number; maxAuthorizationSeconds: number;
}
