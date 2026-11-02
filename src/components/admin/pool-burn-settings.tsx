"use client";
import { useEffect, useRef, useState } from "react";
import { zeroAddress } from "viem";
import { useStore } from "@/lib/store";
import { chainConfig, contracts } from "@/lib/chain-config";
import { formatAssetAmount } from "@/lib/amounts";
import { fetchPoolBurnData, poolBurnAbi, usePoolBurnData } from "@/lib/pool-burn-data";
import { TransactionFeedback, useContractTransaction } from "@/lib/contract-transactions";
import { Card, DataRow } from "@/components/dapp/ui";
import { ServiceQueryNotice } from "@/components/dapp/service-query-notice";
import { ChainConfirmModal } from "./chain-confirm";
function beijing(timestamp:bigint){return timestamp>0n?new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(Number(timestamp)*1000))+" 北京时间":"尚未开始";}
export function PoolBurnSettings(){
  const {state}=useStore();
  return <PoolBurnForm key={[state.connected,state.address.toLowerCase(),state.chainId,contracts.token].join(":")}/>;
}
function PoolBurnForm(){
  const {state}=useStore(),query=usePoolBurnData(),d=query.data,tx=useContractTransaction("admin-pool-burn", { audit: true });
  const active=useRef(false),operation=useRef(false);
  const [checking,setChecking]=useState(false),[accepted,setAccepted]=useState(""),[error,setError]=useState(""),[confirming,setConfirming]=useState(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const key=[state.address,state.chainId,d?.pair,d?.amount,d?.lastBurn,d?.nextBurn,d?.due].join(":");
  const current=useRef<string|null>(null);
  useEffect(()=>{current.current=key;return()=>{current.current=null;};},[key]);
  const ready=query.status==="ready"&&!query.error&&Boolean(d&&d.pair!==zeroAddress&&d.due);
  const correct=state.connected&&state.chainId===chainConfig.id,confirmed=accepted===key,busy=checking||tx.busy;
  async function verify(){
    const fresh=await fetchPoolBurnData();
    if(!active.current||current.current!==key||!fresh.due||fresh.pair!==d?.pair||fresh.amount!==d?.amount||fresh.lastBurn!==d?.lastBurn||fresh.nextBurn!==d?.nextBurn)throw new Error("底池或销毁时间已变化，请刷新后重新确认。");
  }
  async function burn(){
    if(!contracts.token||!correct||!ready||!confirmed||busy||operation.current)return;
    operation.current=true;setChecking(true);setError("");
    try {
      await verify();
      const hash=await tx.run({address:contracts.token,abi:poolBurnAbi,functionName:"burnPool",args:[],description:"销毁底池 "+formatAssetAmount(d!.amount,18)+" CaBi（1%），报价资产不动",beforeSend:verify});
      if(active.current&&hash){setAccepted("");query.refresh();}
    }catch(cause){if(active.current){setAccepted("");setError(cause instanceof Error?cause.message:"销毁未完成，请刷新后重试。");}}
    finally{operation.current=false;if(active.current)setChecking(false);}
  }
  function requestBurn(){if(!contracts.token||!correct||!ready||!confirmed||busy||operation.current)return;setError("");setConfirming(true);}
  function confirmBurn(){setConfirming(false);void burn();}
  return <Card><h2 className="text-base font-semibold">底池定时销毁</h2>
    <p className="mt-2 text-xs leading-6 text-mute">每满 8 小时，可销毁当前绑定交易对内 1% CaBi 到黑洞，并同步储备。USDT / WBNB 和 LP 凭证不转出；不触发额外买卖税。每天三次按实时余额计算约 2.9701%，不会补扣错过的时段。</p>
    <ServiceQueryNotice {...query} label="底池销毁"/>
    <DataRow label="固定销毁规则" value="8 小时 / 1% CaBi"/>
    <DataRow label="累计底池销毁" value={d?formatAssetAmount(d.totalBurned,18)+" CaBi":"—"}/>
    <DataRow label="上次执行 / 初始计时" value={d?beijing(d.lastBurn):"—"}/>
    <DataRow label="下次最早执行" value={d?beijing(d.nextBurn):"—"}/>
    <DataRow label="本次预估销毁" value={d?formatAssetAmount(d.amount,18)+" CaBi":"—"}/>
    <DataRow label="执行状态" value={d?d.pair===zeroAddress?"等待交易对配置":d.due?"已到期，可执行":d.timestamp<d.nextBurn?"未到时间":"等待有效流动性及储备同步":"—"}/>
    <p className="mt-3 text-xs leading-6 text-mute">合约不会自己发送交易。部署后需运行定时执行服务；本页面也可由任意钱包触发到期销毁，执行钱包支付网络费。销毁会改变池内资产比例和市场价格。</p>
    <label className="mt-3 flex gap-2 text-xs leading-6 text-mute"><input type="checkbox" aria-label="确认底池代币销毁" checked={confirmed} onChange={event=>setAccepted(event.target.checked?key:"")} disabled={!ready||!correct||busy} className="mt-1.5 h-4 w-4 shrink-0"/>确认销毁池内显示的 CaBi 数量，报价资产保持在池中。</label>
    <div className="mt-3 flex flex-wrap gap-3"><button aria-label="执行到期底池销毁" onClick={requestBurn} disabled={!ready||!correct||!confirmed||busy} className="btn btn-gold min-h-11 px-4 text-xs">{busy?"正在校验 / 等待钱包确认…":"执行到期底池销毁"}</button><button onClick={query.refresh} disabled={busy} className="btn btn-outline min-h-11 px-4 text-xs">刷新销毁状态</button></div>
    <ChainConfirmModal open={confirming} title="执行到期底池销毁" rows={[{label:"本次销毁数量",from:"0 CaBi",to:d?formatAssetAmount(d.amount,18)+" CaBi":"—"},{label:"池内 CaBi 比例",from:"当前 100%",to:"减少约 1%"},{label:"报价资产 / LP 凭证",from:"留在池中",to:"不动"}]} consequence="销毁直接写入链上底池，提交后不可撤销；会改变池内资产比例和市场价格。" busy={busy} onCancel={()=>{if(!busy)setConfirming(false);}} onConfirm={confirmBurn}/>
    {error?<p role="alert" className="mt-3 text-xs text-down">{error}</p>:null}<TransactionFeedback controller={tx}/>
  </Card>;
}
