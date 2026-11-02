"use client";

// 敏感词库卡：词库展示 + 添加 / 删除（输入状态内部管理）

import { Plus, ShieldAlert, X } from "lucide-react";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { Badge, Card, SectionTitle } from "@/components/dapp/ui";

export default function SensitiveWords() {
  const { state, addSensitiveWord, removeSensitiveWord, showToast } = useStore();
  const [word, setWord] = useState("");
  const [saving, setSaving] = useState(false);

  async function submitWord() {
    const value = word.trim();
    if (!value || saving) return;
    if (value.length > 20) { showToast("每条敏感词最多 20 字"); return; }
    setSaving(true);
    try { if (await addSensitiveWord(value)) setWord(""); }
    finally { setSaving(false); }
  }

  return (
    <Card>
      <SectionTitle
        icon={ShieldAlert}
        title="敏感词库配置"
        tone="red"
        extra={<Badge tone="gray">{state.sensitiveWords.length} 个</Badge>}
      />
      <div className="flex flex-wrap gap-2">
        {state.sensitiveWords.map((w) => (
          <span
            key={w}
            className="flex items-center gap-1.5 rounded-full border border-line bg-well px-3 py-1.5 text-[11px] text-strong"
          >
            {w}
            <button
              disabled={saving}
              onClick={async () => { setSaving(true); try { await removeSensitiveWord(w); } finally { setSaving(false); } }}
              className="text-faint transition hover:text-down"
              aria-label={`删除敏感词 ${w}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        {state.sensitiveWords.length === 0 ? (
          <span className="text-[11px] text-faint">词库为空 · 违规内容将不再被屏蔽</span>
        ) : null}
      </div>
      <div className="mt-4 flex gap-2.5">
        <input
          value={word}
          onChange={(e) => setWord(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitWord();
          }}
          placeholder="输入新的敏感词"
          maxLength={20}
          className="field h-10 min-w-0 flex-1 px-4 text-xs"
        />
        <button
          onClick={submitWord}
          disabled={!word.trim() || saving}
          className="btn btn-gold h-10 shrink-0 px-5 text-[11px]"
        >
          <Plus size={13} /> {saving ? "保存中…" : "添加"}
        </button>
      </div>
      <p className="mt-3 text-[10px] text-faint">
        每行独立词条，最多 200 条、每条最多 20 字；保存到服务器后立即用于社群发言与工单提交校验。
      </p>
    </Card>
  );
}
