"use client";

// 用户份额明细：按地址查询链上认购/奖励/领取数据，缺失项明确标注「链上不可得」

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, Search, Users } from "lucide-react";
import { communityRequest } from "@/lib/community-client";
import { shortAddr } from "@/lib/constants";
import { EmptyRow, SectionTitle } from "@/components/dapp/ui";

interface ChainSnapshot {
  available: boolean; reason?: string;
  purchased?: string; rewardShares?: string; directShares?: string;
  teamRewardShares?: string; claimed?: string; claimable?: string;
}
interface UserRow { address: string; sources: string[]; chain: ChainSnapshot; teamPerformance: null }
interface UsersPayload { items: UserRow[]; total: number; page: number; pageSize: number }

const PAGE_SIZE = 10;
const value = (row: UserRow, key: keyof ChainSnapshot) => {
  const raw = row.chain[key];
  return typeof raw === "string" ? raw : null;
};

export function UsersAdmin() {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<UsersPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: search, page: String(page), pageSize: String(PAGE_SIZE) });
      const payload = await communityRequest<UsersPayload>(`/api/admin/users?${params}`);
      setData(payload);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "用户明细加载失败"); }
    finally { setLoading(false); }
  }, [search, page]);
  useEffect(() => { const id = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(id); }, [load]);

  async function exportCsv() {
    setExporting(true);
    try {
      const response = await fetch(`/api/admin/users/export?q=${encodeURIComponent(search)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("导出失败，请确认登录状态");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url;
      link.download = `cabi-users-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof Error ? e.message : "导出失败"); }
    finally { setExporting(false); }
  }

  const items = data?.items || [];
  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / PAGE_SIZE));

  return (
    <section className="card p-5 sm:p-6">
      <SectionTitle icon={Users} title="用户份额明细" extra={<span className="kicker">ON-CHAIN SNAPSHOT</span>} />
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <form onSubmit={e => { e.preventDefault(); setPage(1); setSearch(q.trim().toLowerCase()); }} className="flex min-w-0 flex-1 items-center gap-2">
          <label className="relative min-w-0 flex-1 lg:w-80">
            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="输入完整或部分钱包地址" className="field h-9 w-full pl-8 pr-3 text-[12px]" />
          </label>
          <button type="submit" className="btn btn-outline h-9 px-3 text-[11px]">搜索</button>
        </form>
        <button onClick={() => void exportCsv()} disabled={exporting} className="btn btn-outline h-9 px-3 text-[11px]">{exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} 导出 CSV</button>
      </div>

      <p className="mb-3 text-[11px] leading-5 text-faint">地址集合来自社群、邀请与兑换的服务端记录（链上无法枚举地址）。认购、奖励、领取等数值实时读取认购合约；团队业绩无链上口径，统一标注「链上不可得」。</p>
      {error ? <p role="alert" className="mb-3 rounded-lg border border-down/30 bg-down/[0.06] px-3 py-2 text-[11px] text-down">{error}</p> : null}

      {loading ? <EmptyRow text="正在读取链上数据…" /> : items.length === 0 ? <EmptyRow text={search ? "没有匹配的地址" : "暂无已登记地址 · 用户签名登录社群或邀请/兑换后自动出现"} /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-[0.06em] text-faint">
                <th className="py-2 pr-3 font-medium">地址 / 来源</th>
                <th className="py-2 pr-3 font-medium">认购份数</th>
                <th className="py-2 pr-3 font-medium">奖励份数</th>
                <th className="py-2 pr-3 font-medium">直推份数</th>
                <th className="py-2 pr-3 font-medium">团队奖励</th>
                <th className="py-2 pr-3 font-medium">已领取</th>
                <th className="py-2 pr-3 font-medium">待领取</th>
                <th className="py-2 pr-3 font-medium">团队业绩</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map(row => {
                const unavailable = !row.chain.available;
                return (
                  <tr key={row.address}>
                    <td className="py-2.5 pr-3">
                      <p className="num text-[11px] text-strong" title={row.address}>{shortAddr(row.address)}</p>
                      <p className="mt-0.5 text-[10px] text-faint">{row.sources.join(" / ")}{unavailable ? <span className="text-down"> · {row.chain.reason}</span> : null}</p>
                    </td>
                    {(["purchased", "rewardShares", "directShares", "teamRewardShares", "claimed", "claimable"] as const).map(key => {
                      const text = value(row, key);
                      return <td key={key} className="num py-2.5 pr-3 text-[11px]">{text ?? <span className="text-faint" title="该地址的链上数据不可读取">链上不可得</span>}</td>;
                    })}
                    <td className="num py-2.5 pr-3 text-[11px] text-strong" title="团队业绩由服务器认购单聚合">{row.teamPerformance ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-[11px] text-faint">
        <span>共 <span className="num">{data?.total ?? 0}</span> 个地址 · 当前第 <span className="num">{page}</span>/<span className="num">{totalPages}</span> 页</span>
        <div className="flex gap-1.5">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="btn btn-outline h-7 w-7 px-0" aria-label="上一页"><ChevronLeft size={13} /></button>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading} className="btn btn-outline h-7 w-7 px-0" aria-label="下一页"><ChevronRight size={13} /></button>
        </div>
      </div>
    </section>
  );
}
