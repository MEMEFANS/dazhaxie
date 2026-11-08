"use client";

// 工单分类选择（表单内）+ 状态筛选（列表头部）按钮组
// 尺寸规范：控件高 28px（sm 档），选中态金色描边、不用大面积金色填充

import { SUPPORT_CATEGORIES } from "@/lib/support";
export const CATEGORIES = SUPPORT_CATEGORIES;
export const FILTERS = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待处理" },
  { key: "processed", label: "已处理" },
  { key: "closed", label: "已完结" },
] as const;
export type FilterKey = (typeof FILTERS)[number]["key"];

export function CategoryPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (category: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CATEGORIES.map((c) => (
        <button
          key={c}
          type="button"
          disabled={disabled}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={`min-h-11 rounded-full border px-3 text-xs transition-colors duration-200 ${
            value === c
              ? "border-purple/30 bg-purple/[0.08] font-medium text-purple-deep"
              : "border-line bg-card text-mute hover:border-purple/25 hover:text-strong"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

export function StatusFilter({
  value,
  onChange,
}: {
  value: FilterKey;
  onChange: (key: FilterKey) => void;
}) {
  return (
    <div className="grid w-full grid-cols-4 gap-1 rounded-xl border border-line bg-well p-1 sm:inline-flex sm:w-auto">
      {FILTERS.map((f) => (
        <button
          key={f.key}
          onClick={() => onChange(f.key)}
          type="button"
          aria-pressed={value === f.key}
          className={`min-h-11 rounded-lg px-2 text-xs transition-colors duration-200 ${
            value === f.key
              ? "seg-active font-medium"
              : "text-mute hover:text-strong"
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
