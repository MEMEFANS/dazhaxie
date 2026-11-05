"use client";

import { useEffect, useRef, useState } from "react";
import { getAddress, parseUnits } from "viem";
import { useStore } from "@/lib/store";
import { chainConfig, contracts } from "@/lib/chain-config";
import { claimPoolAbi, claimPoolClient, fetchClaimPoolData, refreshClaimPoolData, requestClaimAuthorization, submitClaimReceipt, useClaimPoolData } from "@/lib/claim-pool-data";
import { useContractTransaction, TransactionFeedback } from "@/lib/contract-transactions";
import { signInCommunity } from "@/lib/community-client";
import { formatAssetAmount } from "@/lib/amounts";
import { holdingAllows } from "@/lib/allocation-utils";
import { Card, DataRow, SectionHead, Badge } from "@/components/dapp/ui";
import { ServiceQueryNotice } from "@/components/dapp/service-query-notice";

export default function SimpleClaimCard() {
  const { state } = useStore();
  return <ClaimForm key={[state.connected, state.address.toLowerCase(), state.chainId, contracts.claimPool, contracts.usdt].join(":")} />;
}
function ClaimForm() {
  const { state, connect } = useStore(), query = useClaimPoolData(state.connected ? state.address : undefined);
  const data = query.status === "ready" && !query.error ? query.data : undefined;
  const controller = useContractTransaction("claim-pool-claim");
  const [accepted, setAccepted] = useState(""), [error, setError] = useState("");
  const [checking, setChecking] = useState(false), [signingIn, setSigningIn] = useState(false);
  const [lastClaim, setLastClaim] = useState<{ payout: string } | null>(null);
  const [requested, setRequested] = useState("");
  const active = useRef(true), operation = useRef(false), latest = useRef("");
  const claimable = data?.server.claimable;
  let claimAmount = claimable;
  let invalidAmount = false;
  if (requested.trim()) {
    try {
      if (!/^\d+(?:\.\d{1,18})?$/.test(requested.trim())) throw new Error();
      claimAmount = parseUnits(requested.trim(), 18);
    } catch { invalidAmount = true; claimAmount = undefined; }
  }
  if (claimAmount !== undefined && (claimAmount <= 0n || (claimable !== undefined && claimAmount > claimable))) invalidAmount = true;
  const quote = data && claimAmount && !invalidAmount ? {
    amount: claimAmount,
    payout: claimAmount * 70n / 100n,
    lpTokens: claimAmount - claimAmount * 70n / 100n,
    usdtRequired: claimAmount * 50n * 30n * 10n ** BigInt(data.usdtDecimals) / (35_000n * 10n ** 18n * 100n),
  } : undefined;
  const consentKey = [state.address.toLowerCase(), state.chainId, contracts.claimPool, claimable, claimAmount, quote?.payout, quote?.lpTokens, quote?.usdtRequired, data?.lpReceiver, data?.usdt, data?.signer].join(":");
  const confirmed = accepted === consentKey;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { latest.current = consentKey; }, [consentKey]);
  useEffect(() => { if (controller.transaction?.status === "success") refreshClaimPoolData(); }, [controller.transaction?.status]);
  const server = data?.server;
  let reason = "";
  if (!state.connected) reason = "请连接钱包";
  else if (state.chainId !== chainConfig.id) reason = "请切换到" + chainConfig.shortName;
  else if (!data?.wallet) reason = query.status === "error" || query.error ? "领取信息暂时无法更新" : "正在更新领取信息";
  else if (!server?.configured) reason = server?.error || "领取通道暂未开放，请稍后再试";
  else if (server.needsSignIn) reason = "";
  else if (server.error) reason = server.error;
  else if (claimable === undefined) reason = "正在读取可领额度";
  else if (claimable === 0n) reason = "当前没有可领取额度";
  else if (invalidAmount || !claimAmount) reason = "请输入不超过可领额度的有效数量";
  else if (data.poolBalance < claimAmount) reason = "领取储备不足，请联系管理员补足池余额";
  else if (!data.lpReady || !quote) reason = data.lpError || "LP 接收地址尚未配置，请等待管理员完成配置";
  else if (quote.usdtRequired === 0n) reason = "本次领取数量过小";
  else if (quote.payout === 0n) reason = "当前额度不足以领取";
  else if (!holdingAllows(data.wallet.tokenBalance, quote.payout, data.wallet.maxWalletAmount, data.wallet.exempt)) reason = "领取后将超过持仓上限，请先转出部分 CaBi";
  else if (data.wallet.usdtBalance === undefined || data.wallet.usdtBalance < quote.usdtRequired) reason = "USDT 余额不足，需 " + formatAssetAmount(quote.usdtRequired, data.usdtDecimals) + " USDT";

  async function signIn() {
    if (signingIn || !state.connected) return;
    setSigningIn(true); setError("");
    try { await signInCommunity(getAddress(state.address.toLowerCase())); if (active.current) refreshClaimPoolData(); }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "登录失败，请重试。"); }
    finally { if (active.current) setSigningIn(false); }
  }

  async function claim() {
    if (reason || !confirmed || !claimAmount || !claimable || !quote || !contracts.claimPool || !data || controller.busy || operation.current) return;
    operation.current = true; setChecking(true); setError(""); setLastClaim(null); const reviewed = consentKey;
    try {
      const fresh = await fetchClaimPoolData(getAddress(state.address.toLowerCase()));
      if (!active.current || latest.current !== reviewed) return;
      if (fresh.server.claimable !== claimable || (fresh.lpReceiver || "").toLowerCase() !== (data.lpReceiver || "").toLowerCase() || (fresh.usdt || "").toLowerCase() !== (data.usdt || "").toLowerCase()) throw new Error("可领额度或领取配置已变化，请刷新后重新确认。");
      if (!fresh.server.entitlement || fresh.server.entitlement < claimAmount) throw new Error("领取额度已变化，请重新确认。");
      const preview = await claimPoolClient.readContract({ address: contracts.claimPool, abi: claimPoolAbi, functionName: "previewClaim", args: [claimAmount] });
      const freshQuote = { amount: claimAmount, payout: preview[0], lpTokens: preview[1], usdtRequired: preview[2] };
      if (freshQuote.payout !== quote.payout || freshQuote.lpTokens !== quote.lpTokens || freshQuote.usdtRequired !== quote.usdtRequired) throw new Error("领取预览已变化，请刷新后重新确认。");
      if (!fresh.wallet || !holdingAllows(fresh.wallet.tokenBalance, freshQuote.payout, fresh.wallet.maxWalletAmount, fresh.wallet.exempt)) throw new Error("领取后将超过当前持仓上限。");
      if (!fresh.lpReady || freshQuote.usdtRequired !== quote.usdtRequired || (fresh.wallet.usdtBalance || 0n) < quote.usdtRequired) throw new Error("LP 报价或 USDT 余额已变化，请刷新后重新确认。");

      const authorization = await requestClaimAuthorization(claimAmount);
      if (!active.current || latest.current !== reviewed) return;
      if (authorization.amount !== claimAmount || authorization.cumulativeLimit !== fresh.server.entitlement) throw new Error("授权额度已变化，请刷新后重新确认。");

      const hash = await controller.run({
        address: contracts.claimPool,
        abi: claimPoolAbi,
        functionName: "claim",
        args: [authorization.amount, authorization.cumulativeLimit, authorization.nonce, authorization.deadline, authorization.signature],
        description: "领取 70% CaBi，并支付 " + formatAssetAmount(freshQuote.usdtRequired, fresh.usdtDecimals) + " USDT；30% CaBi 和 USDT 转入项目 LP 接收地址",
        approval: { token: fresh.usdt, amount: freshQuote.usdtRequired },
      });
      if (active.current && hash) {
        setAccepted("");
        setRequested("");
        setLastClaim({ payout: freshQuote.payout.toString() });
        void submitClaimReceipt(authorization.nonce, hash);
        refreshClaimPoolData();
      }
    } catch (cause) { if (active.current) { setAccepted(""); setError(cause instanceof Error ? cause.message : "领取检查失败，请重试。"); refreshClaimPoolData(); } }
    finally { if (active.current) { operation.current = false; setChecking(false); } }
  }

  const statusTone = !server?.configured ? "gray" : claimable ? "green" : "gray";
  const statusLabel = !server?.configured ? "暂未开放" : claimable ? "可领取" : "等待额度";
  return <Card className="p-5 sm:p-6">
    <SectionHead eyebrow="CABI CLAIM" title="CaBi 领取" desc="认购与奖励额度已自动汇总" right={<Badge tone={statusTone}>{statusLabel}</Badge>} />
    <ServiceQueryNotice {...query} label="CaBi 领取" />
    <div id="allocation" className="mt-4 scroll-mt-36 rounded-lg border border-line bg-well px-4 py-2">
      <DataRow label="累计待领" value={claimable !== undefined ? formatAssetAmount(claimable, data?.tokenDecimals ?? 18) + " CaBi" : "—"} />
      <DataRow label="领取池储备" value={data ? formatAssetAmount(data.poolBalance, data.tokenDecimals) + " CaBi" : "—"} />
      <label className="block py-2 text-xs text-mute">本次领取数量（CaBi）
        <input value={requested} onChange={event => { setRequested(event.target.value); setAccepted(""); }} placeholder={claimable !== undefined ? `默认全部领取：${formatAssetAmount(claimable, data?.tokenDecimals ?? 18)}` : "输入数量"} inputMode="decimal" disabled={!claimable || controller.busy || checking} className="field mt-2 min-h-11 w-full px-3 text-sm" />
      </label>
      <DataRow label="另需支付" value={quote && data ? formatAssetAmount(quote.usdtRequired, data.usdtDecimals) + " USDT" : "—"} />
    </div>
    <div id="claim-center" className="mt-4 scroll-mt-36 rounded-xl border border-line bg-well p-4">
      <strong className="text-sm">本次领取</strong>
      {quote && data ? <div className="mt-3 grid grid-cols-1 gap-2 text-xs leading-6 text-mute sm:grid-cols-3">
        <span>到账（70%）：{formatAssetAmount(quote.payout, data.tokenDecimals)} CaBi</span>
        <span>转入 LP（30%）：{formatAssetAmount(quote.lpTokens, data.tokenDecimals)} CaBi</span>
        <span>另付：{formatAssetAmount(quote.usdtRequired, data.usdtDecimals)} USDT</span>
      </div> : null}
    </div>
    <p className="mt-3 text-xs leading-6 text-mute">LP 资金转入项目地址，由项目方后续处理。</p>
    {!data?.lpReady ? <p className="mt-2 text-xs leading-6 text-mute">{data?.lpError || "LP 接收地址尚未配置，请等待管理员完成配置。"}</p> : null}
    {!server?.configured ? <p className="mt-2 text-xs leading-6 text-mute">领取通道暂未开放，请稍后再试或联系客服。</p> : null}
    {server?.configured && data && data.signer.toLowerCase() !== (server.signer || "").toLowerCase() ? <p className="mt-2 text-xs leading-6 text-down">领取通道维护中，请稍后再试。</p> : null}
    <label className="mt-3 flex items-start gap-2 text-xs leading-6 text-mute"><input aria-label="确认本次 CaBi 领取" type="checkbox" checked={confirmed} onChange={event => setAccepted(event.target.checked ? consentKey : "")} disabled={Boolean(reason) || controller.busy || checking} className="mt-1.5 h-4 w-4 shrink-0" />我已确认到账数量及支付金额。</label>
    {!state.connected ? <button onClick={connect} className="btn btn-outline mt-3 min-h-11 px-4 text-sm">连接钱包</button> : null}
    {state.connected && server?.needsSignIn && server.configured ? <button onClick={() => void signIn()} disabled={signingIn} className="btn btn-outline mt-3 min-h-11 w-full text-sm">{signingIn ? "正在登录…" : "登录后查看可领额度"}</button> : null}
    <button onClick={() => void claim()} disabled={Boolean(reason) || !confirmed || controller.busy || checking} className="btn btn-gold mt-3 min-h-11 w-full text-sm">{checking ? "正在核对" : controller.busy ? "等待钱包确认" : reason || "确认领取 70%"}</button>
    {lastClaim ? <p className="mt-3 text-xs leading-6 text-up">领取已确认：本次到账 {formatAssetAmount(BigInt(lastClaim.payout), data?.tokenDecimals ?? 18)} CaBi（70%）。可领额度已刷新。</p> : null}
    {error ? <p role="alert" className="mt-3 text-xs leading-6 text-down">{error}</p> : null}
    <TransactionFeedback controller={controller} />
  </Card>;
}
