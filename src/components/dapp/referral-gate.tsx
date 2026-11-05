"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { KeyRound, Wallet } from "lucide-react";
import type { Address } from "viem";
import { useStore } from "@/lib/store";
import { chainConfig } from "@/lib/chain-config";
import { bindInvitation, loginReferral, parseInvitation, useReferralData } from "@/lib/referral-data";

export function ReferralGate({children}:{children:ReactNode}) {
  const {state}=useStore();
  return <ReferralGateForm key={[state.connected,state.address.toLowerCase()].join(":")}>{children}</ReferralGateForm>;
}
function ReferralGateForm({children}:{children:ReactNode}) {
  const pathname=usePathname();
  const {state,hydrated,restored,connecting,connect,disconnect}=useStore();
  const query=useReferralData(hydrated&&state.connected?state.address:undefined);
  const [input,setInput]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const active=useRef(false),operation=useRef(false);
  const data=query.data,target=parseInvitation(input);
  const authenticated=query.status==="ready"&&Boolean(data&&data.account.toLowerCase()===state.address.toLowerCase());
  const bindingMatches=query.binding?.account.toLowerCase()===state.address.toLowerCase()&&query.binding?.chainId===chainConfig.id;
  const bound=hydrated&&state.connected&&Boolean(authenticated&&data?.bound||bindingMatches&&query.binding?.bound);
  const self=Boolean(target&&target===data?.code);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  useEffect(()=>{
    const timer=window.setTimeout(()=>{const values=new URLSearchParams(window.location.search).getAll("ref");if(values.length===1)setInput(values[0]);},0);
    return()=>window.clearTimeout(timer);
  },[pathname]);
  const gateReady=hydrated&&restored&&(!state.connected||query.status!=="loading");
  const showGate=gateReady&&!bound;
  useEffect(()=>{
    if(!showGate)return;const previous=document.body.style.overflow;document.body.style.overflow="hidden";
    return()=>{document.body.style.overflow=previous;};
  },[showGate]);
  async function enter(){
    // 已绑定账户只恢复登录，不把当前链接的邀请码带入签名或修改推荐关系。
    if(operation.current||!state.connected||bound&&authenticated||!bound&&(!target||self))return;
    operation.current=true;setBusy(true);setError("");
    try{
      if(authenticated&&target)await bindInvitation(state.address,target);
      else await loginReferral(state.address as Address,()=>active.current,bound?undefined:target);
      if(active.current)await query.refresh();
    }
    catch(cause){if(active.current)setError(cause instanceof Error?/rejected|denied|4001/i.test(cause.message)?"已取消签名，可重新操作":cause.message:bound?"登录未完成，请重试":"绑定未完成，请重试");}
    finally{if(active.current){operation.current=false;setBusy(false);}}
  }
  if(bound)return <>
    {gateReady&&!authenticated?<div role="status" className="border-b border-line bg-[#fff7e6] px-4 py-3 text-plum" data-referral-session="pending">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-xs leading-6">邀请关系已绑定，无需重复填写。{query.status==="error"?"账户状态暂未刷新，请重试。":"签名登录后可使用认购等账户功能，无需 Gas。"}</p>
        {query.status==="error"?<button onClick={()=>void query.refresh()} disabled={busy} className="btn btn-outline min-h-11 px-4 text-xs">重新查询</button>:<button onClick={()=>void enter()} disabled={busy} className="btn btn-gold min-h-11 px-4 text-xs">{busy?"等待钱包签名…":"签名登录"}</button>}
        {error?<p role="alert" className="w-full text-xs leading-6 text-down">{error}</p>:null}
      </div>
    </div>:null}
    {children}
  </>;
  // 验证期间同样不渲染任何遮罩：全屏层在钱包恢复的数百毫秒内就是用户感知的「闪一下」
  if(!gateReady)return <>{null}{children}</>;
  return <div className="fixed inset-0 z-[80] overflow-y-auto bg-plum/95 p-4 backdrop-blur-sm" data-referral-gate="locked">
    <section role="dialog" aria-modal="true" aria-labelledby="referral-gate-title" className="card mx-auto my-6 w-full max-w-[440px] overflow-hidden shadow-pop sm:my-12">
      <div className="relative h-36 bg-[#e6d1ff] sm:h-44"><Image src="/images/xiebit-invite-v4.webp" alt="邀请蟹友加入 CaBi" fill sizes="(max-width: 472px) calc(100vw - 34px), 438px" className="object-cover"/></div>
      <div className="p-6"><div className="flex items-center gap-2 text-gold"><KeyRound size={20}/><span className="kicker">JOIN THE CRAB CLUB</span></div>
        <h1 id="referral-gate-title" className="mt-3 text-xl font-semibold">{!state.connected?"连接钱包，进入蟹友之旅":query.status==="error"?"暂时无法读取账户":"输入邀请码，开启蟹友之旅"}</h1>
        <p className="mt-3 text-xs leading-6 text-mute">{!state.connected?"连接后会自动检查邀请关系，已绑定账户无需重复填写。":query.status==="error"?"请重新查询账户状态，已有邀请关系不会改变。":"邀请链接会自动填入邀请码；直接进入请向邀请人索取 8 位邀请码。"}</p>
        {!hydrated?<p role="status" className="mt-5 text-sm">正在初始化…</p>:!state.connected?<button onClick={connect} disabled={connecting} className="btn btn-gold mt-5 min-h-11 w-full text-sm"><Wallet size={15}/>{connecting?"正在连接钱包…":"连接钱包"}</button>:query.status==="loading"?<p role="status" className="mt-5 text-xs leading-6 text-mute">正在读取邀请账户…</p>:query.status==="error"?<div className="mt-5"><p role="alert" className="text-xs text-down">{query.error}</p><button onClick={()=>void query.refresh()} disabled={busy} className="btn btn-outline mt-3 min-h-11 px-4 text-xs">重新查询</button></div>:<form onSubmit={event=>{event.preventDefault();void enter();}} className="mt-5">
          <label htmlFor="referral-input" className="text-xs font-medium">邀请码 / 邀请链接</label>
          <input id="referral-input" aria-label="邀请码" value={input} onChange={event=>{setInput(event.target.value);setError("");}} disabled={busy} maxLength={4096} placeholder="输入 8 位邀请码或粘贴邀请链接" autoComplete="off" spellCheck={false} className="field mt-2 min-h-12 w-full px-3 text-sm"/>
          {input&&(!target||self)?<p role="alert" className="mt-2 text-xs leading-6 text-down">{self?"不能绑定自己的邀请码":"请输入有效的 8 位邀请码或邀请链接"}</p>:target?<p className="mt-2 text-xs leading-6 text-mute">邀请码：<strong>{target}</strong></p>:null}
          <button type="submit" disabled={!target||self||busy} className="btn btn-gold mt-4 min-h-11 w-full text-sm">{busy?"正在处理…":authenticated?"绑定并进入":"签名一次，绑定并进入"}</button>
        </form>}
        {error?<p role="alert" className="mt-3 text-xs leading-6 text-down">{error}</p>:null}
        {state.connected?<button onClick={disconnect} disabled={busy} className="btn btn-outline mt-4 min-h-11 w-full text-xs">断开钱包 / 更换账户</button>:null}
      </div>
    </section>
  </div>;
}
