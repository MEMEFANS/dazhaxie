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
  const active = useRef(true), operation = useRef(false), latest = useRef("");
  const quote = data?.preview;
  const claimable = data?.server.claimable;
  const consentKey = [state.address.toLowerCase(), state.chainId, contracts.claimPool, claimable, quote?.payout, quote?.lpTokens, quote?.usdtRequired, data?.lpReceiver, data?.usdt, data?.signer].join(":");
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
  else if (data.poolBalance < claimable) reason = "领取储备不足，请联系管理员补足池余额";
  else if (!data.lpReady || !quote) reason = data.lpError || "LP 接收地址尚未配置，请等待管理员完成配置";
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
    if (reason || !confirmed || !claimable || !quote || !contracts.claimPool || !data || controller.busy || operation.current) return;
    operation.current = true; setChecking(true); setError(""); setLastClaim(null); const reviewed = consentKey;
    try {
      const fresh = await fetchClaimPoolData(getAddress(state.address.toLowerCase()));
      if (!active.current || latest.current !== reviewed) return;
      if (fresh.server.claimable !== claimable || (fresh.lpReceiver || "").toLowerCase() !== (data.lpReceiver || "").toLowerCase() || (fresh.usdt || "").toLowerCase() !== (data.usdt || "").toLowerCase()) throw new Error("可领额度或领取配置已变化，请刷新后重新确认。");
      const freshQuote = fresh.preview;
      if (!freshQuote || freshQuote.amount !== claimable || freshQuote.payout !== quote.payout) throw new Error("领取额度已变化，请重新确认。");
      if (!fresh.wallet || !holdingAllows(fresh.wallet.tokenBalance, freshQuote.payout, fresh.wallet.maxWalletAmount, fresh.wallet.exempt)) throw new Error("领取后将超过当前持仓上限。");
      if (!fresh.lpReady || freshQuote.usdtRequired !== quote.usdtRequired || (fresh.wallet.usdtBalance || 0n) < quote.usdtRequired) throw new Error("LP 报价或 USDT 余额已变化，请刷新后重新确认。");

      const authorization = await requestClaimAuthorization();
      if (!active.current || latest.current !== reviewed) return;
      if (authorization.amount !== claimable) throw new Error("授权额度已变化，请刷新后重新确认。");
      if (authorization.deadline <= BigInt(Math.floor(Date.now() / 1000))) throw new Error("领取授权已过期，请重新发起。");

      const hash = await controller.run({
        address: contracts.claimPool,
        abi: claimPoolAbi,
        functionName: "claim",
        args: [authorization.amount, authorization.nonce, authorization.deadline, authorization.signature],
        description: "签名领取 70% CaBi，并支付 " + formatAssetAmount(freshQuote.usdtRequired, fresh.usdtDecimals) + " USDT 组建流动性；30% 代币转入 LP 地址",
        approval: { token: fresh.usdt, amount: freshQuote.usdtRequired },
      });
      if (active.current && hash) {
        setAccepted("");
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
    <SectionHead eyebrow="CABI CLAIM" title="认购与奖励领取" desc="认购与奖励自动累计，可自行领取" right={<Badge tone={statusTone}>{statusLabel}</Badge>} />
    <ServiceQueryNotice {...query} label="CaBi 领取" />
    <div id="allocation" className="mt-4 scroll-mt-36 rounded-lg border border-line bg-well px-4 py-2">
      <DataRow label="本次可领" value={claimable !== undefined ? formatAssetAmount(claimable, data?.tokenDecimals ?? 18) + " CaBi" : "—"} />
      <DataRow label="另需支付" value={quote && data ? formatAssetAmount(quote.usdtRequired, data.usdtDecimals) + " USDT" : "—"} />
    </div>
    <div id="claim-center" className="mt-4 scroll-mt-36 rounded-xl border border-line bg-well p-4">
      <strong className="text-sm">组 LP 领取（唯一领取方式）</strong>
      <span className="mt-2 block text-xs leading-6 text-mute">需先支付 30% USDT 等值组建流动性：30% CaBi 与这笔 USDT 同时进入项目 LP 地址，70% CaBi 到账钱包后可交易。</span>
      {quote && data ? <div className="mt-3 grid grid-cols-1 gap-2 text-xs leading-6 text-mute sm:grid-cols-3">
        <span>转入 LP：{formatAssetAmount(quote.lpTokens, data.tokenDecimals)} CaBi</span>
        <span>支付 USDT：{formatAssetAmount(quote.usdtRequired, data.usdtDecimals)}</span>
        <span>到账钱包：{formatAssetAmount(quote.payout, data.tokenDecimals)} CaBi</span>
      </div> : null}
    </div>
    <div className="mt-4 rounded-lg border border-line bg-well px-4 py-2">
      <DataRow label="本次到账" value={quote && data ? formatAssetAmount(quote.payout, data.tokenDecimals) + " CaBi（70%）" : "—"} />
      <DataRow label="已领取累计" value={data ? formatAssetAmount(data.totalClaimed, data.tokenDecimals) : "—"} />
    </div>
    <p className="mt-3 text-xs leading-6 text-mute">70% CaBi 到账钱包，同时支付 30% USDT 用于组建流动性；未配置 LP 接收地址时暂不能领取。额度按认购与奖励自动累计，可分多次领取。</p>
    {!data?.lpReady ? <p className="mt-2 text-xs leading-6 text-mute">{data?.lpError || "LP 接收地址尚未配置，请等待管理员完成配置。"}</p> : null}
    {!server?.configured ? <p className="mt-2 text-xs leading-6 text-mute">领取通道暂未开放，请稍后再试或联系客服。</p> : null}
    {server?.configured && data && data.signer.toLowerCase() !== (server.signer || "").toLowerCase() ? <p className="mt-2 text-xs leading-6 text-down">领取通道维护中，请稍后再试。</p> : null}
    <label className="mt-3 flex items-start gap-2 text-xs leading-6 text-mute"><input aria-label="确认本次 CaBi 领取" type="checkbox" checked={confirmed} onChange={event => setAccepted(event.target.checked ? consentKey : "")} disabled={Boolean(reason) || controller.busy || checking} className="mt-1.5 h-4 w-4 shrink-0" />我已核对到账数量与支付金额，同意支付 30% USDT 组建流动性。</label>
    {!state.connected ? <button onClick={connect} className="btn btn-outline mt-3 min-h-11 px-4 text-sm">连接钱包</button> : null}
    {state.connected && server?.needsSignIn && server.configured ? <button onClick={() => void signIn()} disabled={signingIn} className="btn btn-outline mt-3 min-h-11 w-full text-sm">{signingIn ? "正在登录…" : "登录后查看可领额度"}</button> : null}
    <button onClick={() => void claim()} disabled={Boolean(reason) || !confirmed || controller.busy || checking} className="btn btn-gold mt-3 min-h-11 w-full text-sm">{checking ? "正在核对" : controller.busy ? "等待钱包确认" : reason || "确认领取 70%"}</button>
    {lastClaim ? <p className="mt-3 text-xs leading-6 text-up">领取已确认：本次到账 {formatAssetAmount(BigInt(lastClaim.payout), data?.tokenDecimals ?? 18)} CaBi（70%）。可领额度已刷新。</p> : null}
    {error ? <p role="alert" className="mt-3 text-xs leading-6 text-down">{error}</p> : null}
    <TransactionFeedback controller={controller} />
  </Card>;
}
