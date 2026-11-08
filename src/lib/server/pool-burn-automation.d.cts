export interface BurnContext { chainId: number; token: string; quote: string; rpcUrls: string[] }
export interface BurnStatus {
  context: Omit<BurnContext, "rpcUrls">;
  config: null | { address: string; chainId: number; token: string; quote: string; maxGasGwei: string; enabled: boolean; revision: number; updatedAt: number; matches: boolean };
  worker: { heartbeat: number; fresh: boolean; status: string; message: string; balance: string | null; observedAt: number | null; chain: null | { pair: string; amount: string; nextBurnAt: string; due: boolean; lastBurnAt: string; totalBurned: string; timestamp: string } };
  history: { hash: string; status: string; createdAt: number; confirmedAt: number | null; amount: string | null; address: string; token: string; chainId: number }[];
  pending: boolean;
}
export class BurnError extends Error {}
export interface BurnStore { close(): void }
export function contextFromEnv(env: Record<string, string | undefined>): BurnContext;
export function openStore(directory?: string): BurnStore;
export function status(store: BurnStore, context: BurnContext): BurnStatus;
export function saveConfiguration(store: BurnStore, context: BurnContext, input: { privateKey: string; maxGasGwei: string; revision: number }, actor: string): void;
export function setEnabled(store: BurnStore, context: BurnContext, enabled: boolean, revision: number, actor: string): Promise<void>;
