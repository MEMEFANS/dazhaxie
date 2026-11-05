/** Public display state only; this is not a wallet session. */
export interface ReferralBinding {
  account: string;
  chainId: number;
  bound: boolean;
}

export interface ReferralData {
  account: string;
  code: string;
  referrerCode: string | null;
  referrer: string | null;
  bound: boolean;
  root: boolean;
}

/** Short server-issued codes only. Wallet addresses are never invitation codes. */
export function parseInvitation(raw: string): string | undefined {
  let value = raw.trim();
  if (!value || value.length > 4096) return undefined;
  if (!/^[A-Z2-9]{8}$/i.test(value)) {
    try {
      const url = new URL(value);
      if (!["https:", "http:"].includes(url.protocol) || url.searchParams.getAll("ref").length !== 1) return undefined;
      value = url.searchParams.get("ref") || "";
    } catch { return undefined; }
  }
  return /^[A-Z2-9]{8}$/i.test(value) ? value.toUpperCase() : undefined;
}
