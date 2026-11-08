"use client";

import { useEffect, useRef, useState } from "react";
import { getAddress } from "viem";
import { useStore } from "@/lib/store";
import { chainConfig, contracts } from "@/lib/chain-config";
import { claimPoolAbi, fetchClaimPoolData, refreshClaimPoolData, requestClaimAuthorization, submitClaimReceipt, useClaimPoolData } from "@/lib/claim-pool-data";
import { useContractTransaction, TransactionFeedback } from "@/lib/contract-transactions";
import { signInCommunity } from "@/lib/community-client";
import { formatAssetAmount } from "@/lib/amounts";
import { holdingAllows } from "@/lib/allocation-utils";
import { Card, DataRow, SectionHead, Badge } from "@/components/dapp/ui";
import { ServiceQueryNotice } from "@/components/dapp/service-query-notice";
import styles from "./claim.module.css";

export default function SimpleClaimCard() {
  const { state } = useStore();
  return <ClaimForm key={[state.connected, state.address.toLowerCase(), state.chainId, contracts.claimPool, contracts.usdt].join(":")} />;
}
function ClaimForm() {
  const { state, connect } = useStore(), query = useClaimPoolData(state.connected ? state.address : undefined);
  const data = query.data;
  const prepareTx = useContractTransaction("claim-pool-prepare"), claimTx = useContractTransaction("claim-pool-claim");
  const [error, setError] = useState(""), [checking, setChecking] = useState(false), [signingIn, setSigningIn] = useState(false);
  const active = useRef(true), operation = useRef(false), latest = useRef("");
  const claimable = data?.server.claimable, quote = data?.preview;
  const preparedOutstanding = data && data.prepared > data.claimed ? data.prepared - data.claimed : 0n;
  const consentKey = [state.address.toLowerCase(), state.chainId, contracts.claimPool, claimable, quote?.payout, quote?.lpTokens, quote?.usdtRequired, quote?.estimatedLiquidity, data?.prepared, data?.claimed, data?.claimOpen, data?.lpReceiver, data?.usdt, data?.signer].join(":");
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { latest.current = consentKey; }, [consentKey]);
  useEffect(() => { if (prepareTx.transaction?.status === "success" || claimTx.transaction?.status === "success") refreshClaimPoolData(); }, [prepareTx.transaction?.status, claimTx.transaction?.status]);
  const server = data?.server;
  const canClaimNow = Boolean(data?.claimOpen && preparedOutstanding > 0n);
  let reason = "";
  if (!state.connected) reason = "请连接钱包";
  else if (state.chainId !== chainConfig.id) reason = "请切换到" + chainConfig.shortName;
  else if (query.status === "unconfigured") reason = "领取通道暂未开放";
  else if (query.error) reason = "信息更新失败，请刷新后重试";
  else if (!data?.wallet) reason = query.status === "error" || query.error ? "领取信息暂时无法更新" : "正在更新领取信息";
  else if (!server?.configured) reason = server?.error || "领取通道暂未开放，请稍后再试";
  else if (server.needsSignIn) reason = "请先签名登录查看额度";
  else if (server.error && claimable !== 0n) reason = server.error;
  else if (canClaimNow) {
    const payout = preparedOutstanding * 70n / 100n;
    if (!holdingAllows(data.wallet.tokenBalance, payout, data.wallet.maxWalletAmount, data.wallet.exempt)) reason = "领取后将超过持仓上限，请先转出部分 CaBi";
  } else if (preparedOutstanding > 0n) reason = "组 LP 已完成，领取开放后可领取";
  else if (claimable === undefined) reason = "正在读取可领额度";
  else if (claimable === 0n) reason = "当前没有可组 LP 的额度";
  else if (!data.lpReady || !quote) reason = data.lpError || "LP 接收地址尚未配置，请等待管理员完成配置";
  else if (quote.usdtRequired === 0n || quote.payout === 0n) reason = "当前额度不足以组建流动性";
  else if (data.wallet.usdtBalance === undefined || data.wallet.usdtBalance < quote.usdtRequired) reason = "USDT 余额不足，需 " + formatAssetAmount(quote.usdtRequired, data.usdtDecimals) + " USDT";

  async function signIn() {
    if (signingIn || !state.connected) return; setSigningIn(true); setError("");
    try { await signInCommunity(getAddress(state.address.toLowerCase())); if (active.current) refreshClaimPoolData(); }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "登录失败，请重试。"); }
    finally { if (active.current) setSigningIn(false); }
  }
  async function act() {
    if (reason || !contracts.claimPool || !data || prepareTx.busy || claimTx.busy || operation.current) return;
    operation.current = true; setChecking(true); setError(""); const reviewed = consentKey;
    try {
      const fresh = await fetchClaimPoolData(getAddress(state.address.toLowerCase()));
      if (!active.current || latest.current !== reviewed) return;
      if ((fresh.lpReceiver || "").toLowerCase() !== data.lpReceiver.toLowerCase() || fresh.claimOpen !== data.claimOpen) throw new Error("领取状态已变化，请刷新后重新确认。");
      if (fresh.prepared > fresh.claimed) {
        if (!fresh.claimOpen) throw new Error("组 LP 已完成，请等待领取开放时间。");
        const hash = await claimTx.run({ address: contracts.claimPool, abi: claimPoolAbi, functionName: "claim", args: [], description: "领取已组 LP 对应的 70% CaBi" });
        if (hash) refreshClaimPoolData();
      } else {
        if (!fresh.server.claimable || !fresh.preview || !fresh.server.entitlement) throw new Error("可组 LP 额度尚未就绪，请刷新后重试。");
        const authorization = await requestClaimAuthorization(fresh.server.claimable);
        if (authorization.amount !== fresh.server.claimable || authorization.cumulativeLimit !== fresh.server.entitlement) throw new Error("授权额度已变化，请刷新后重试。");
        const minLiquidity = fresh.preview.estimatedLiquidity * 99n / 100n;
        if (minLiquidity <= 0n) throw new Error("LP 预估数量无效，请刷新后重试。");
        const hash = await prepareTx.run({ address: contracts.claimPool, abi: claimPoolAbi, functionName: "prepareLiquidity", args: [{ amount: authorization.amount, cumulativeLimit: authorization.cumulativeLimit, nonce: authorization.nonce, deadline: authorization.deadline }, authorization.signature, fresh.preview.usdtRequired, minLiquidity], description: "支付 " + formatAssetAmount(fresh.preview.usdtRequired, fresh.usdtDecimals) + " USDT 并自动组 LP；70% CaBi 在领取开放后到账", approval: { token: fresh.usdt, amount: fresh.preview.usdtRequired } });
        if (hash) { void submitClaimReceipt(authorization.nonce, hash); refreshClaimPoolData(); }
      }
    } catch (cause) { if (active.current) { setError(cause instanceof Error ? cause.message : "领取操作失败，请重试。"); refreshClaimPoolData(); } }
    finally { if (active.current) { operation.current = false; setChecking(false); } }
  }

  const statusTone = !server?.configured ? "gray" : (claimable || preparedOutstanding) ? "green" : "gray";
  const statusLabel = !server?.configured ? "暂未开放" : canClaimNow ? "可领取" : preparedOutstanding ? "已组 LP" : claimable ? "可组 LP" : "等待额度";
  const buttonLabel = canClaimNow ? "领取 70% CaBi" : preparedOutstanding ? "等待领取开放" : "确认组 LP";
  return <Card className="p-5 sm:p-6">
    <SectionHead eyebrow="CABI CLAIM" title="组 LP 与领取" desc="先组 LP，开放后领取 CaBi" right={<Badge tone={statusTone}>{statusLabel}</Badge>} />
    <ServiceQueryNotice {...query} label="CaBi 领取" />
    <ol className={styles.journey} aria-label="参与流程">
      <li><span>01</span>认购份额</li>
      <li><span>02</span>完成组 LP</li>
      <li><span>03</span>领取 CaBi</li>
    </ol>
    <div className={styles.layout}>
    <div>
    <div id="allocation" className={styles.balances}>
      <DataRow label="可组 LP 额度" value={claimable !== undefined ? formatAssetAmount(claimable, data?.tokenDecimals ?? 18) + " CaBi" : "—"} />
      <DataRow label="已组 LP 额度" value={data ? formatAssetAmount(data.prepared, data.tokenDecimals) + " CaBi" : "—"} />
      <DataRow label="已领取 CaBi" value={data ? formatAssetAmount(data.claimed * 70n / 100n, data.tokenDecimals) + " CaBi" : "—"} />
    </div>
    <details className={styles.rules}>
      <summary>每份如何分配？</summary>
      <p>每份 35,000 CaBi 配额中，10,500 CaBi 与另付的 15 USDT 组 LP；24,500 CaBi 在领取开放后到账。</p>
    </details>
    </div>
    <div>
    <div id="claim-center" className={styles.checkout}>
      <p className={styles.checkoutLabel}>{preparedOutstanding > 0n ? "待领取 CaBi" : "本次组 LP 需支付"}</p>
      <p className={styles.total}>
        {preparedOutstanding > 0n && data ? formatAssetAmount(preparedOutstanding * 70n / 100n, data.tokenDecimals) : quote && data ? formatAssetAmount(quote.usdtRequired, data.usdtDecimals) : "—"}
        <small>{preparedOutstanding > 0n ? "CaBi" : "USDT"}</small>
      </p>
      {preparedOutstanding > 0n ? <p className={styles.hint}>{canClaimNow ? "领取已开放，确认后 CaBi 将转入当前钱包。" : "组 LP 已完成，领取开放后即可操作。"}</p> : <>
        <dl className={styles.split}>
          <div><dt>30% 进入 LP</dt><dd>{quote && data ? formatAssetAmount(quote.lpTokens, data.tokenDecimals) : "—"}<small>CaBi</small></dd></div>
          <div><dt>70% 待领取</dt><dd>{quote && data ? formatAssetAmount(quote.payout, data.tokenDecimals) : "—"}<small>CaBi</small></dd></div>
        </dl>
        <p className={styles.hint}>每份另付 15 USDT，按固定比例组 LP。</p>
      </>}
    </div>
    {quote && data && preparedOutstanding === 0n ? <p className={styles.hint}>授权金额：{formatAssetAmount(quote.usdtRequired, data.usdtDecimals)} USDT。请在钱包中核对，已有足额授权会自动跳过。</p> : null}
    {data && !data.lpReady ? <p className="mt-2 text-xs leading-6 text-mute">{data.lpError || "组 LP 暂未开放，请稍后再试。"}</p> : null}
    {server?.configured && data && data.signer.toLowerCase() !== (server.signer || "").toLowerCase() ? <p className="mt-2 text-xs leading-6 text-down">领取签名服务与链上配置不一致，请联系管理员。</p> : null}
    {!state.connected ? <button onClick={connect} className="btn btn-purple mt-4 min-h-12 w-full px-4 text-sm">连接钱包</button> : null}
    {state.connected && server?.needsSignIn && server.configured ? <button onClick={() => void signIn()} disabled={signingIn} className="btn btn-outline mt-3 min-h-11 w-full text-sm">{signingIn ? "正在登录…" : "登录后查看可领额度"}</button> : null}
    {state.connected ? <button onClick={() => void act()} disabled={Boolean(reason) || prepareTx.busy || claimTx.busy || checking} className="btn btn-gold mt-4 min-h-12 w-full px-3 py-3 text-sm leading-6">{checking ? "正在核对" : prepareTx.busy || claimTx.busy ? "等待钱包确认" : reason || buttonLabel}</button> : null}
    {error ? <p role="alert" className="mt-3 text-xs leading-6 text-down">{error}</p> : null}
    <TransactionFeedback controller={prepareTx} /><TransactionFeedback controller={claimTx} />
    </div>
    </div>
  </Card>;
}
