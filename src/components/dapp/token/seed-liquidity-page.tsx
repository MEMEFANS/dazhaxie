"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { erc20Abi, getAddress, isAddress, zeroAddress } from "viem";
import { useStore } from "@/lib/store";
import { chainConfig, contracts, getExplorerAddressUrl } from "@/lib/chain-config";
import { fetchSeedLiquidityData, seedPoolAbi, type SeedLiquidityData } from "@/lib/seed-liquidity";
import { useContractTransaction, TransactionFeedback, type ContractRequest } from "@/lib/contract-transactions";
import { formatAssetAmount } from "@/lib/amounts";
import { Badge, Card, DataRow, PageHeader, PageStack } from "@/components/dapp/ui";

const same = (a: string | undefined, b: string | undefined) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
type Action = "designate" | "fund" | "approveToken" | "approveUsdt" | "seed";

export default function SeedLiquidityPage() {
  const { state } = useStore();
  return <SeedForm key={[state.connected, state.address.toLowerCase(), state.chainId, contracts.token, contracts.claimPool].join(":")} />;
}

function SeedForm() {
  const { state, connect } = useStore();
  const tx = useContractTransaction("initial-liquidity");
  const [data, setData] = useState<SeedLiquidityData>(), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [providerInput, setProviderInput] = useState("");
  const [working, setWorking] = useState(false);
  const active = useRef(false), operation = useRef(false);
  const refresh = useCallback(async () => {
    if (!active.current) return;
    setLoading(true);
    try { const next = await fetchSeedLiquidityData(); if (active.current) { setData(next); setError(""); } }
    catch { if (active.current) { setData(undefined); setError("首次加池信息暂不可用，请确认网站已切换到新版合约后刷新。"); } }
    finally { if (active.current) setLoading(false); }
  }, []);
  useEffect(() => {
    active.current = true;
    const initialLoad = window.setTimeout(() => void refresh(), 0);
    return () => { active.current = false; window.clearTimeout(initialLoad); };
  }, [refresh]);
  const correct = state.connected && state.chainId === chainConfig.id;
  const owner = correct && same(state.address, data?.owner);
  const provider = correct && same(state.address, data?.seedProvider);
  const busy = working || tx.busy || loading;
  const designated = Boolean(data && data.seedProvider !== zeroAddress);
  const tokenApproved = Boolean(data && data.tokenAllowance === data.tokenAmount);
  const usdtApproved = Boolean(data && data.usdtAllowance === data.usdtAmount);
  const canSeed = Boolean(provider && data?.liquidityEnabled && !data.tradingOpen && !data.seeded && tokenApproved && usdtApproved && data.tokenBalance >= data.tokenAmount && data.usdtBalance >= data.usdtAmount);

  async function act(action: Action) {
    if (!correct || busy || operation.current) return;
    operation.current = true; setWorking(true); setError("");
    try {
      const fresh = await fetchSeedLiquidityData();
      if (!active.current) return;
      setData(fresh);
      const isOwner = same(state.address, fresh.owner), isProvider = same(state.address, fresh.seedProvider);
      let request: ContractRequest;
      if (action === "designate") {
        if (!isOwner || fresh.liquidityEnabled || fresh.seeded) throw new Error("仅管理员可在开启组 LP 前指定出资钱包。");
        if (!isAddress(providerInput.trim(), { strict: false }) || providerInput.trim().toLowerCase() === zeroAddress) throw new Error("请输入完整的非零出资钱包地址。");
        const next = getAddress(providerInput.trim().toLowerCase());
        request = { address: fresh.pool, abi: seedPoolAbi, functionName: "setSeedProvider", args: [next], description: `指定首次加池钱包 ${next}；初始 LP 归该钱包` };
      } else if (action === "fund") {
        if (!isOwner || fresh.seedProvider === zeroAddress || fresh.seeded) throw new Error("请由管理员先指定首次加池钱包。");
        const amount = fresh.tokenAmount - fresh.tokenBalance;
        if (amount <= 0n) throw new Error("出资钱包已有足额 CaBi。");
        if (fresh.ownerTokenBalance < amount) throw new Error("管理员的新 CaBi 余额不足。");
        request = { address: fresh.token, abi: erc20Abi, functionName: "transfer", args: [fresh.seedProvider, amount], description: `向出资钱包 ${fresh.seedProvider} 转入 ${formatAssetAmount(amount, 18)} 新 CaBi` };
      } else {
        if (!isProvider) throw new Error("请连接管理员指定的首次加池钱包。");
        if (fresh.seeded) throw new Error("初始池已建立，无需重复加池。");
        if (fresh.tradingOpen) throw new Error("首次加池阶段已结束。");
        if (action === "approveToken" || action === "approveUsdt") {
          const isToken = action === "approveToken", amount = isToken ? fresh.tokenAmount : fresh.usdtAmount;
          request = { address: isToken ? fresh.token : fresh.usdt, abi: erc20Abi, functionName: "approve", args: [fresh.pool, amount], description: isToken ? "授权新池使用 70,000 CaBi" : "授权新池使用 100 USDT" };
        } else {
          if (!fresh.liquidityEnabled) throw new Error("请等待管理员开启组 LP。");
          if (fresh.tokenAllowance !== fresh.tokenAmount || fresh.usdtAllowance !== fresh.usdtAmount) throw new Error("请先完成两项精确授权。");
          if (fresh.tokenBalance < fresh.tokenAmount || fresh.usdtBalance < fresh.usdtAmount) throw new Error("出资钱包需要 70,000 新 CaBi 和 100 USDT。");
          request = { address: fresh.pool, abi: seedPoolAbi, functionName: "seedLiquidity", args: [fresh.tokenAmount, fresh.usdtAmount, fresh.minimumLp, fresh.now + 1200n], description: `投入 100 USDT＋70,000 CaBi，初始 LP 转入 ${fresh.seedProvider}` };
        }
      }
      request.beforeSend = async () => {
        const current = await fetchSeedLiquidityData();
        if (!same(current.seedProvider, fresh.seedProvider) || current.seeded) throw new Error("出资钱包或加池状态已变化，请重新核对。");
        if (action === "fund" && current.tokenBalance !== fresh.tokenBalance) throw new Error("出资钱包余额已变化，请重新核对转入数量。");
      };
      await tx.run(request);
      if (active.current) await refresh();
    } catch (cause) { if (active.current) setError(cause instanceof Error && cause.message.length < 180 ? cause.message : "操作未完成，请刷新并核对钱包状态。"); }
    finally { operation.current = false; if (active.current) setWorking(false); }
  }

  return <PageStack>
    <PageHeader eyebrow="INITIAL LIQUIDITY" title="首次建立 CaBi 流动性" desc="指定钱包出资，初始 LP 凭证由出资钱包持有" />
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3"><Badge tone={data?.seeded ? "green" : "gray"}>{data?.seeded ? "初始池已建立" : !designated ? "待指定出资钱包" : data?.liquidityEnabled ? "等待出资钱包加池" : "等待管理员开放"}</Badge><button className="btn btn-outline min-h-11 px-4 text-xs" onClick={() => void refresh()} disabled={busy}>刷新状态</button></div>
      <div className="mt-4"><DataRow label="首次投入" value="100 USDT ＋ 70,000 CaBi" /><DataRow label="初始 LP 接收钱包" value={designated ? data!.seedProvider : "管理员稍后设置"} /><DataRow label="当前钱包" value={state.connected ? state.address : "尚未连接"} /></div>
      <p className="mt-3 text-xs leading-6 text-mute">首次加池需要出资钱包确认两笔授权和一笔加池交易，并支付 BNB 手续费。初始 LP 不进入项目领取池。</p>
      {!state.connected ? <button onClick={() => void connect()} className="btn btn-gold mt-4 min-h-11 w-full">连接钱包</button> : !correct ? <p className="mt-3 text-sm text-warn">请在钱包切换到 {chainConfig.shortName}。</p> : null}
    </Card>
    {owner && data && !data.liquidityEnabled && !data.seeded ? <Card>
      <h2 className="font-semibold">指定首次加池钱包</h2><p className="mt-2 text-xs leading-6 text-mute">开启组 LP 前可修改；开启后固定。设置出资钱包不会移交管理员权限。</p>
      <input className="field mt-4 min-h-11 w-full px-3 text-sm" aria-label="首次加池钱包地址" placeholder="0x 开头的完整钱包地址" value={providerInput} onChange={e => setProviderInput(e.target.value)} disabled={busy} />
      <button className="btn btn-gold mt-3 min-h-11 w-full" disabled={busy || !providerInput.trim()} onClick={() => void act("designate")}>确认指定钱包</button>
    </Card> : null}
    {owner && data && designated && !data.seeded && !same(data.seedProvider, data.owner) && data.tokenBalance < data.tokenAmount ? <Card>
      <h2 className="font-semibold">给出资钱包准备新 CaBi</h2><p className="mt-2 break-all text-xs leading-6 text-mute">接收地址：{data.seedProvider}</p>
      <p className="mt-2 text-xs leading-6 text-mute">该钱包还需 {formatAssetAmount(data.tokenAmount - data.tokenBalance, 18)} 枚新 CaBi。确认后从管理员钱包转入，USDT 由出资钱包自行准备。</p>
      <button className="btn btn-outline mt-3 min-h-11 w-full" disabled={busy} onClick={() => void act("fund")}>转入所需新 CaBi</button>
    </Card> : null}
    {data && designated ? <Card>
      <h2 className="font-semibold">出资钱包操作</h2><div className="mt-3"><DataRow label="CaBi 余额" value={formatAssetAmount(data.tokenBalance, 18)} /><DataRow label="USDT 余额" value={formatAssetAmount(data.usdtBalance, data.decimals)} /><DataRow label="已持有初始 LP" value={formatAssetAmount(data.lpBalance, 18)} /></div>
      {data.seeded ? <p className="mt-3 text-sm text-up">初始流动性已建立，LP 凭证由出资钱包保管。</p> : <div className="mt-4 grid gap-3">
        <button className="btn btn-outline min-h-12 px-4" disabled={busy || !provider || tokenApproved || data.tradingOpen} onClick={() => void act("approveToken")}>{tokenApproved ? "CaBi 授权已完成" : "1. 授权 70,000 CaBi"}</button>
        <button className="btn btn-outline min-h-12 px-4" disabled={busy || !provider || usdtApproved || data.tradingOpen} onClick={() => void act("approveUsdt")}>{usdtApproved ? "USDT 授权已完成" : "2. 授权 100 USDT"}</button>
        <button className="btn btn-gold min-h-12 px-4" disabled={busy || !canSeed} onClick={() => void act("seed")}>3. 加入初始 LP</button>
        {!provider ? <p className="text-xs leading-6 text-mute">请使用上方指定的出资钱包操作。</p> : !data.liquidityEnabled ? <p className="text-xs leading-6 text-mute">授权后等待管理员设置时间并开启组 LP。</p> : data.tokenBalance < data.tokenAmount || data.usdtBalance < data.usdtAmount ? <p className="text-xs leading-6 text-warn">出资钱包需备好 70,000 新 CaBi 和 100 USDT。</p> : null}
      </div>}
      <a className="mt-4 block break-all text-xs text-gold" href={getExplorerAddressUrl(data.pair)} target="_blank" rel="noopener noreferrer">查看 CaBi／USDT 交易对</a>
    </Card> : null}
    {error ? <p className="text-sm leading-6 text-down" role="alert">{error}</p> : null}
    <TransactionFeedback controller={tx} />
    <Link href="/dapp/token" className="block py-2 text-center text-sm text-mute">返回代币中心</Link>
  </PageStack>;
}
