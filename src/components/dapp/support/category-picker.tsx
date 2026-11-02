"use client";

// 工单分类选择（表单内）+ 状态筛选（列表头部）按钮组
// 尺寸规范：控件高 28px（sm 档），选中态金色描边、不用大面积金色填充

export const CATEGORIES = ["认购问题", "奖励问题", "兑换问题", "交易问题", "其他"];
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
}: {
  value: string;
  onChange: (category: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CATEGORIES.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`h-8 rounded-full border px-3 text-[11px] transition-colors duration-200 ${
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
    <div className="inline-flex shrink-0 rounded-full border border-line bg-well p-0.5">
      {FILTERS.map((f) => (
        <button
          key={f.key}
          onClick={() => onChange(f.key)}
          className={`h-7 rounded-full px-2.5 text-[10px] transition-colors duration-200 ${
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
