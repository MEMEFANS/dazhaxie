export interface OperationalSettings {
  subscribeLocked: boolean;
  exchangeEnabled: boolean;
  sensitiveWords: string[];
  exchangePayee: string; // 实物兑换代币收款地址（校验和格式）
  subscribePayee: string; // 认购 USDT 收款地址（校验和格式）
  updatedAt: number;
}
export interface AdminAuditEntry {
  id: string;
  actor: string;
  action: string;
  detail: string;
  at: number;
}
export interface AdminSettingsResponse {
  settings: OperationalSettings;
  logs: AdminAuditEntry[];
}
