import type { RedemptionShipping } from "@/lib/redemption";

const LIST_KEY = "cabi-shipping-addresses:v1";
const LEGACY_KEY = "cabi-shipping-profile:v1";

export type ShippingAddress = RedemptionShipping & { id: string; isDefault: boolean };

export const emptyShipping: RedemptionShipping = { name: "", phone: "", address: "" };

function normalize(value: Partial<RedemptionShipping> | null | undefined): RedemptionShipping | null {
  const name = typeof value?.name === "string" ? value.name.trim() : "";
  const phone = typeof value?.phone === "string" ? value.phone.trim() : "";
  const address = typeof value?.address === "string" ? value.address.trim() : "";
  return name && phone && address ? { name, phone, address } : null;
}

function createId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* 旧浏览器回退到时间戳 */
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function sameAddress(a: RedemptionShipping, b: RedemptionShipping) {
  return a.name === b.name && a.phone === b.phone && a.address === b.address;
}

function defaultFirst(list: ShippingAddress[]) {
  return [...list].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

function write(list: ShippingAddress[]) {
  try {
    window.localStorage.setItem(LIST_KEY, JSON.stringify(list));
    window.dispatchEvent(new Event("cabi-shipping-updated"));
  } catch {
    /* 本机记忆不可用时不影响正常提交 */
  }
}

// 读取本机保存的全部收货地址，默认地址排在最前。
export function listShippingAddresses(): ShippingAddress[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(LIST_KEY) || "null") as unknown;
    const list = (Array.isArray(raw) ? raw : []).flatMap(item => {
      const value = normalize(item as Partial<RedemptionShipping> | null);
      if (!value) return [];
      const record = item as Partial<ShippingAddress>;
      return [{
        ...value,
        id: typeof record.id === "string" && record.id ? record.id : createId(),
        isDefault: Boolean(record.isDefault),
      }];
    });
    if (list.length) {
      if (!list.some(item => item.isDefault)) list[0].isDefault = true;
      return defaultFirst(list);
    }
    // 兼容上一版只保存单个地址的格式
    const legacy = normalize(JSON.parse(window.localStorage.getItem(LEGACY_KEY) || "null") as Partial<RedemptionShipping> | null);
    return legacy ? [{ ...legacy, id: createId(), isDefault: true }] : [];
  } catch {
    return [];
  }
}

// 表单默认带入默认收货地址。
export function readShippingProfile(): RedemptionShipping | null {
  const target = listShippingAddresses().find(item => item.isDefault);
  return target ? { name: target.name, phone: target.phone, address: target.address } : null;
}

// 保存或更新一条收货地址；第一条自动成为默认地址。
export function saveShippingProfile(value: RedemptionShipping) {
  if (typeof window === "undefined") return;
  const normalized = normalize(value);
  if (!normalized) return;
  const list = listShippingAddresses();
  const index = list.findIndex(item => sameAddress(item, normalized));
  if (index >= 0) list[index] = { ...list[index], ...normalized };
  else list.push({ ...normalized, id: createId(), isDefault: list.length === 0 });
  if (!list.some(item => item.isDefault)) list[0].isDefault = true;
  write(defaultFirst(list));
}

export function setDefaultShipping(id: string) {
  if (typeof window === "undefined") return;
  const list = listShippingAddresses().map(item => ({ ...item, isDefault: item.id === id }));
  if (list.some(item => item.isDefault)) write(defaultFirst(list));
}

export function removeShippingAddress(id: string) {
  if (typeof window === "undefined") return;
  const remaining = listShippingAddresses().filter(item => item.id !== id);
  if (!remaining.length) {
    try {
      window.localStorage.removeItem(LIST_KEY);
      window.dispatchEvent(new Event("cabi-shipping-updated"));
    } catch {
      /* ignore */
    }
    return;
  }
  if (!remaining.some(item => item.isDefault)) remaining[0].isDefault = true;
  write(defaultFirst(remaining));
}
