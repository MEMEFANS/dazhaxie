"use client";

import { useEffect, useState } from "react";
import type { RedemptionShipping } from "@/lib/redemption";
import { listShippingAddresses, removeShippingAddress, setDefaultShipping, type ShippingAddress } from "@/lib/shipping-profile";

type ShippingAddressPickerProps = {
  value: RedemptionShipping;
  onChange: (value: RedemptionShipping) => void;
  disabled?: boolean;
};

function summary(value: ShippingAddress) {
  const address = value.address.length > 28 ? `${value.address.slice(0, 28)}…` : value.address;
  return `${value.isDefault ? "默认 · " : ""}${value.name} · ${address}`;
}

// 已保存的收货地址下拉选择，支持切换默认地址和删除。
export function ShippingAddressPicker({ value, onChange, disabled }: ShippingAddressPickerProps) {
  const [addresses, setAddresses] = useState<ShippingAddress[]>([]);

  useEffect(() => {
    const refresh = () => setAddresses(listShippingAddresses());
    const timer = window.setTimeout(refresh, 0);
    window.addEventListener("cabi-shipping-updated", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("cabi-shipping-updated", refresh);
    };
  }, []);

  if (!addresses.length) return null;

  const selected = addresses.find(item => item.name === value.name && item.phone === value.phone && item.address === value.address);

  return (
    <div className="mt-3 rounded-xl border border-line bg-well p-3">
      <label className="block space-y-2 text-xs text-mute">
        <span>常用收货地址</span>
        <select
          value={selected?.id ?? ""}
          disabled={disabled}
          onChange={event => {
            const next = addresses.find(item => item.id === event.target.value);
            if (next) onChange({ name: next.name, phone: next.phone, address: next.address });
          }}
          className="field min-h-11 w-full px-3 text-base sm:text-sm"
        >
          <option value="">手动填写 / 新地址</option>
          {addresses.map(item => <option key={item.id} value={item.id}>{summary(item)}</option>)}
        </select>
      </label>
      {selected && !selected.isDefault ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={disabled} onClick={() => setDefaultShipping(selected.id)} className="btn btn-outline min-h-9 px-3 text-xs">设为默认地址</button>
          <button type="button" disabled={disabled} onClick={() => removeShippingAddress(selected.id)} className="btn btn-outline min-h-9 px-3 text-xs">删除</button>
        </div>
      ) : null}
    </div>
  );
}
