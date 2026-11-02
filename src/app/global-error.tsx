"use client";

export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="zh-CN"><body style={{ margin: 0, background: "#f8f3fc", color: "#281441", fontFamily: "system-ui, sans-serif" }}>
      <main style={{ display: "grid", minHeight: "100dvh", placeItems: "center", padding: "24px", boxSizing: "border-box" }}>
        <section role="alert" style={{ width: "100%", maxWidth: "420px", padding: "32px", borderRadius: "24px", background: "#fff", boxSizing: "border-box", textAlign: "center" }}>
          <p style={{ color: "#8054a8", fontSize: "12px", letterSpacing: "0.1em" }}>CaBi · 蟹比特</p>
          <h1 style={{ margin: "18px 0 12px", fontSize: "24px" }}>页面暂时无法显示</h1>
          <p style={{ color: "#776882", fontSize: "14px", lineHeight: 1.8 }}>请重新加载页面。已提交的链上交易状态可在钱包中查看。</p>
          <button type="button" onClick={() => retry()} style={{ minHeight: "44px", marginTop: "12px", padding: "0 24px", border: 0, borderRadius: "999px", background: "#8248e8", color: "#fff", fontSize: "14px", cursor: "pointer" }}>重新加载</button>
        </section>
      </main>
    </body></html>
  );
}
