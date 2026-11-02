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
  const [mode, setMode] = useState<0 | 1>(0), [accepted, setAccepted] = useState(""), [error, setError] = useState("");
  const [checking, setChecking] = useState(false), [signingIn, setSigningIn] = useState(false);
  const [lastClaim, setLastClaim] = useState<{ mode: number; payout: string } | null>(null);
  const active = useRef(true), operation = useRef(false), latest = useRef("");
  const quote = mode === 0 ? data?.directPreview : data?.lpPreview;
  const claimable = data?.server.claimable;
  const consentKey = [state.address.toLowerCase(), state.chainId, contracts.claimPool, mode, claimable, quote?.payout, quote?.burnAmount, quote?.lpTokens, quote?.usdtRequired, data?.lpReceiver, data?.usdt, data?.signer].join(":");
  const confirmed = accepted === consentKey;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { latest.current = consentKey; }, [consentKey]);
  useEffect(() => { if (controller.transaction?.status === "success") refreshClaimPoolData(); }, [controller.transaction?.status]);
  const server = data?.server;
  let reason = "";
  if (!state.connected) reason = "请连接钱包";
  else if (state.chainId !== chainConfig.id) reason = "请切换到" + chainConfig.shortName;
  else if (!data?.wallet) reason = query.status === "error" || query.error ? "领取信息暂时无法更新" : "正在更新领取信息";
  else if (!server?.configured) reason = server?.error || "服务器未配置签名服务，暂时无法领取";
  else if (server.needsSignIn) reason = "";
  else if (server.error) reason = server.error;
  else if (claimable === undefined) reason = "正在读取可领额度";
  else if (claimable === 0n) reason = "当前没有可领取额度";
  else if (data.poolBalance < claimable) reason = "领取储备不足，请联系管理员补足池余额";
  else if (mode === 1 && (!data.lpReady || !quote)) reason = data.lpError || "LP 领取暂不可用";
  else if (!quote || quote.payout === 0n) reason = "当前额度不足以领取";
  else if (!holdingAllows(data.wallet.tokenBalance, quote.payout, data.wallet.maxWalletAmount, data.wallet.exempt)) reason = "领取后将超过持仓上限，请先转出部分 CaBi";
  else if (mode === 1 && (data.wallet.usdtBalance === undefined || data.wallet.usdtBalance < quote.usdtRequired)) reason = "配对所需 USDT 余额不足";

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
      const freshQuote = mode === 0 ? fresh.directPreview : fresh.lpPreview;
      if (!freshQuote || freshQuote.amount !== claimable || freshQuote.payout !== quote.payout) throw new Error("领取额度已变化，请重新确认。");
      if (!fresh.wallet || !holdingAllows(fresh.wallet.tokenBalance, freshQuote.payout, fresh.wallet.maxWalletAmount, fresh.wallet.exempt)) throw new Error("领取后将超过当前持仓上限。");
      if (mode === 1 && (!fresh.lpReady || freshQuote.usdtRequired !== quote.usdtRequired || (fresh.wallet.usdtBalance || 0n) < quote.usdtRequired)) throw new Error("配对报价或 USDT 余额已变化，请刷新后重新确认。");

      const authorization = await requestClaimAuthorization(mode);
      if (!active.current || latest.current !== reviewed) return;
      if (authorization.amount !== claimable || authorization.mode !== mode) throw new Error("服务器授权额度已变化，请刷新后重新确认。");
      if (authorization.deadline <= BigInt(Math.floor(Date.now() / 1000))) throw new Error("领取授权已过期，请重新发起。");

      const hash = await controller.run({
        address: contracts.claimPool,
        abi: claimPoolAbi,
        functionName: "claim",
        args: [authorization.amount, authorization.nonce, authorization.deadline, authorization.mode, authorization.signature],
        description: mode === 0 ? "签名领取 50% CaBi，其余 50% 销毁或留池" : "签名领取 70% CaBi，并支付 30% USDT 等值；30% 代币转入 LP 地址",
        ...(mode === 1 ? { approval: { token: fresh.usdt, amount: freshQuote.usdtRequired } } : {}),
      });
      if (active.current && hash) {
        setAccepted("");
        setLastClaim({ mode, payout: freshQuote.payout.toString() });
        void submitClaimReceipt(authorization.nonce, hash);
        refreshClaimPoolData();
      }
    } catch (cause) { if (active.current) { setAccepted(""); setError(cause instanceof Error ? cause.message : "领取检查失败，请重试。"); refreshClaimPoolData(); } }
    finally { if (active.current) { operation.current = false; setChecking(false); } }
  }

  const statusTone = !server?.configured ? "gray" : claimable ? "green" : "gray";
  const statusLabel = !server?.configured ? "未启用签名服务" : claimable ? "可领取" : "等待额度";
  return <Card className="p-5 sm:p-6">
    <SectionHead eyebrow="CABI CLAIM" title="认购与奖励领取" desc="额度由服务器按认购单、直推与极差结算聚合，并用签名授权你自行领取" right={<Badge tone={statusTone}>{statusLabel}</Badge>} />
    <ServiceQueryNotice {...query} label="CaBi 领取" />
    <div className="mt-4 rounded-lg border border-line bg-well px-4 py-2">
      <DataRow label="本次可领额度" value={claimable !== undefined ? formatAssetAmount(claimable, data?.tokenDecimals ?? 18) + " CaBi" : "—"} />
      <DataRow label="本次到账比例" value={mode === 0 ? "50%（其余销毁或留池）" : "70%（30% 入 LP）"} />
      <DataRow label={mode === 0 ? "本次销毁 / 留池" : "转入 LP 地址"} value={quote && data ? formatAssetAmount(mode === 0 ? quote.burnAmount : quote.lpTokens, data.tokenDecimals) + " CaBi" : "—"} />
      {mode === 1 ? <DataRow label="另需支付 USDT" value={quote && data ? formatAssetAmount(quote.usdtRequired, data.usdtDecimals) + " USDT" : "—"} /> : null}
      <DataRow label="链上已领累计" value={data ? formatAssetAmount(data.claimed, data.tokenDecimals) + " CaBi" : "—"} />
    </div>
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">{([0, 1] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => { setMode(value); setAccepted(""); setError(""); }} disabled={controller.busy || checking} className={"rounded-xl border p-4 text-left " + (mode === value ? "border-gold bg-gold/5" : "border-line bg-well")}><strong className="text-sm">{value === 0 ? "直接领取 50%" : "组 LP 领取 70%"}</strong><span className="mt-2 block text-xs leading-6 text-mute">{value === 0 ? "不支付 USDT；剩余 50% 按开关销毁或留池" : "30% 代币转入 LP 地址，另付 30% USDT 等值"}</span></button>)}</div>
    <div className="mt-4 rounded-lg border border-line bg-well px-4 py-2">
      <DataRow label="本次实际到账" value={quote && data ? formatAssetAmount(quote.payout, data.tokenDecimals) + " CaBi（" + (mode === 0 ? "50%" : "70%") + "）" : "—"} />
      <DataRow label="池余额 / 已分配未领" value={data ? formatAssetAmount(data.poolBalance, data.tokenDecimals) + " / " + formatAssetAmount(data.allocatedUnclaimed, data.tokenDecimals) : "—"} />
      <DataRow label="已领取累计 / 销毁累计" value={data ? formatAssetAmount(data.totalClaimed, data.tokenDecimals) + " / " + formatAssetAmount(data.totalBurned, data.tokenDecimals) : "—"} />
    </div>
    <p className="mt-3 text-xs leading-6 text-mute">{mode === 0 ? "直接领取本次授权额度的 50%，剩余 50% 在开关开启时销毁，否则留在池内成为未分配余额。" : "本次授权额度的 70% 到你的钱包，剩余 30% CaBi 转入项目 LP 地址；同时按 50 USDT / 份、每份 35000 CaBi 的折算口径支付 30% USDT 等值。合约不会自动添加流动性。"} 额度按认购单与奖励自动聚合，可多次领取；每次领取都由服务器签发一次性授权（nonce），签名有效期有限。</p>
    {mode === 1 && !data?.lpReady ? <p className="mt-2 text-xs leading-6 text-mute">{data?.lpError || "LP 领取暂不可用，可选择直接领取。"}</p> : null}
    {!server?.configured ? <p className="mt-2 text-xs leading-6 text-mute">签名服务尚未配置（服务器缺少 CLAIM_SIGNER_PRIVATE_KEY），领取按钮已禁用；请联系管理员。</p> : null}
    {server?.configured && data && data.signer.toLowerCase() !== (server.signer || "").toLowerCase() ? <p className="mt-2 text-xs leading-6 text-down">链上 signer 与服务器签名地址不一致，请联系管理员完成权限交接。</p> : null}
    <label className="mt-3 flex items-start gap-2 text-xs leading-6 text-mute"><input aria-label="确认本次 CaBi 领取额度" type="checkbox" checked={confirmed} onChange={event => setAccepted(event.target.checked ? consentKey : "")} disabled={Boolean(reason) || controller.busy || checking} className="mt-1.5 h-4 w-4 shrink-0" />我已核对领取方式、到账数量与费用{mode === 1 ? "，同意 USDT 支付与 30% 代币转入 LP 地址" : ""}；本次由服务器签发一次性领取授权。</label>
    {!state.connected ? <button onClick={connect} className="btn btn-outline mt-3 min-h-11 px-4 text-sm">连接钱包</button> : null}
    {state.connected && server?.needsSignIn && server.configured ? <button onClick={() => void signIn()} disabled={signingIn} className="btn btn-outline mt-3 min-h-11 w-full text-sm">{signingIn ? "正在登录…" : "登录后查看可领额度"}</button> : null}
    <button onClick={() => void claim()} disabled={Boolean(reason) || !confirmed || controller.busy || checking} className="btn btn-gold mt-3 min-h-11 w-full text-sm">{checking ? "正在核对领取信息并申请签名" : controller.busy ? "等待钱包 / 链上确认" : reason || (mode === 0 ? "确认领取 50%" : "授权 USDT 并领取 70%")}</button>
    {lastClaim ? <p className="mt-3 text-xs leading-6 text-up">领取已确认：本次到账 {formatAssetAmount(BigInt(lastClaim.payout), data?.tokenDecimals ?? 18)} CaBi（{lastClaim.mode === 0 ? "50%" : "70%"}）。可领额度已刷新。</p> : null}
    {error ? <p role="alert" className="mt-3 text-xs leading-6 text-down">{error}</p> : null}
    <TransactionFeedback controller={controller} />
  </Card>;
}
