"use client";

import Link from "next/link";
import { RefreshCw, House } from "lucide-react";

export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="mx-auto flex min-h-[65dvh] w-full max-w-lg items-center px-5 py-12">
      <section className="card w-full p-7 text-center" role="alert">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-well text-gold"><RefreshCw size={25} /></span>
        <p className="kicker mt-5">LET’S TRY AGAIN</p>
        <h1 className="mt-2 text-2xl font-semibold text-strong">页面暂时没能加载</h1>
        <p className="mt-3 text-sm leading-7 text-mute">请检查网络后重试。如果刚刚提交过链上交易，请先在钱包或区块浏览器确认交易状态。</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button type="button" onClick={() => retry()} className="btn btn-gold min-h-11 px-6 text-sm"><RefreshCw size={16} />重新加载</button>
          <Link href="/" className="btn btn-outline min-h-11 px-6 text-sm"><House size={16} />返回总览</Link>
        </div>
      </section>
    </div>
  );
}
