"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Check, Copy, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useStore } from "@/lib/store";
import { useReferralData } from "@/lib/referral-data";
import styles from "./invite-campaign.module.css";

export function InviteCampaign() {
  const { state, hydrated, connect, showToast } = useStore();
  const referral = useReferralData(state.connected ? state.address : undefined);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const canShare = hydrated && state.connected && referral.status === "ready" && Boolean(referral.data?.bound) && referral.data?.account.toLowerCase() === state.address.toLowerCase();
  const code = canShare ? referral.data!.code : "";
  const inviteLink =
    canShare && typeof window !== "undefined"
      ? `${window.location.origin}/dapp/subscribe?ref=${encodeURIComponent(code)}`
      : "";

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy(value: string, type: "code" | "link") {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(type);
      showToast("复制成功");
    } catch {
      showToast("复制失败，请长按文字手动复制");
    }
  }

  return (
    <section
      className={styles.campaign}
      aria-labelledby="invite-campaign-title"
    >
      <div className={styles.artwork}>
        <Image
          src="/images/xiebit-invite-v4.webp"
          alt="两只漫画风 MEME 螃蟹开心分享金币、邀请蟹友"
          width={1280}
          height={720}
          sizes="(max-width: 520px) 100vw, 520px"
          preload
        />
      </div>
      <div className={styles.content}>
        <div className={styles.heading}>
          <h1 id="invite-campaign-title">邀好友 · 启新程</h1>
          <p>分享专属邀请，连接更多蟹友</p>
        </div>
        <div className={styles.card}>
          <h2>我的专属邀请码</h2>
          <div className={styles.codeRow}>
            <p className={styles.code}>{code || "--"}</p>
            <button
              type="button"
              className={styles.copyButton}
              disabled={!canShare}
              onClick={() => void copy(code, "code")}
              aria-label="复制邀请码"
            >
              {copied === "code" ? <Check size={16} /> : <Copy size={16} />}
              <span>{copied === "code" ? "已复制" : "复制"}</span>
            </button>
          </div>
          <h2 className={styles.linkLabel}>专属邀请链接</h2>
          <div className={styles.linkRow}>
            <p className={styles.link} title={inviteLink}>
              {inviteLink || "登录并绑定邀请后生成专属链接"}
            </p>
          </div>
          <button
            type="button"
            className={styles.mainButton}
            disabled={state.connected && !canShare}
            onClick={canShare ? () => void copy(inviteLink, "link") : connect}
          >
            {canShare
              ? copied === "link"
                ? "链接已复制"
                : "复制邀请链接"
              : state.connected ? "请先完成邀请绑定" : "连接钱包获取邀请"}
          </button>
          <div className={styles.cardFooter}>
            <span aria-hidden="true" />
            <p>一起探索更多可能</p>
            <span aria-hidden="true" />
          </div>
          <span className="sr-only" aria-live="polite">
            {copied ? "复制成功" : ""}
          </span>
        </div>
        {canShare && (
          <details className={styles.qrDetails}>
            <summary>
              <QrCode size={14} /> 查看邀请二维码
            </summary>
            <div>
              <QRCodeSVG
                value={inviteLink}
                size={160}
                level="M"
                fgColor="#240f46"
                bgColor="#fff"
              />
            </div>
          </details>
        )}
        <p className={styles.note}>
          链接自动填入 8 位邀请码，受邀人确认后免费绑定；没有链接时手动输入。推荐关系绑定后长期保存，不可更换。
          <br />
          BTC 为创意元素 · 生态代币为 CaBi
        </p>
      </div>
    </section>
  );
}

