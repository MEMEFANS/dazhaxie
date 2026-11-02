import type { Address } from "viem";

// 实物兑换不依赖任何兑换合约：用户把 CaBi 直接转入后台配置的收款地址，
// 服务端核验这笔 ERC20 transfer 后生成待发货订单。

export type RedemptionOrderStatus = "paid" | "shipped" | "delivered" | "cancelled";

export interface RedemptionShipping {
  name: string;
  phone: string;
  address: string;
}

export interface RedemptionOrder {
  id: string;
  address: string;
  chainId: number;
  payee: string; // 下单时锁定的收款地址
  quantity: number;
  amount: string; // 代币数量（wei）
  status: RedemptionOrderStatus;
  createdAt: number;
  paidAt?: number;
  transactionHash?: `0x${string}`;
  shipping: RedemptionShipping;
  carrier?: string;
  trackingNumber?: string;
  shippedAt?: number;
  note?: string;
}

export interface RedemptionConfig {
  configured: boolean; // 代币地址、收款地址与订单加密密钥齐全
  enabled: boolean; // configured 且后台运营开关开启
  exchangeEnabled: boolean; // 后台运营开关原始值
  chainId: number;
  token?: Address;
  tokenDecimals?: number;
  payee?: Address; // 后台设置的收款地址
  unitPrice?: string; // 每份应付代币（wei，等于 EXCHANGE_COST × 10^18）
  maxPerTransaction?: number;
  message?: string;
}
