"use client";
import { useRef, useState } from "react";
import { isAddress } from "viem";
import { KeyRound } from "lucide-react";
import { Card, SectionTitle } from "@/components/dapp/ui";
import type { ReferralData } from "@/lib/referral";
export function ReferralRoots() {
  const [address,setAddress]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[result,setResult]=useState<ReferralData>();
  const operation=useRef(false);
  async function create(){
    if(operation.current||!isAddress(address,{strict:false}))return;
    operation.current=true;setBusy(true);setError("");setResult(undefined);
    try{
      const response=await fetch("/api/admin/referral-roots",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({address})});
      const body=await response.json();if(!response.ok)throw new Error(body.error||"创建失败");setResult(body.data);
    }catch(cause){setError(cause instanceof Error?cause.message:"创建失败，请重试");}
    finally{operation.current=false;setBusy(false);}
  }
  return <Card><SectionTitle icon={KeyRound} title="项目初始邀请码"/>
    <p className="text-xs leading-6 text-mute">首次运营时，为项目自己的真实钱包启用初始邀请码。普通用户填写邀请人提供的短码即可，无需逐个在后台设置。初始邀请人没有上级，不能再绑定他人。</p>
    <form onSubmit={event=>{event.preventDefault();void create();}} className="mt-4 flex flex-col gap-3 sm:flex-row">
      <input aria-label="项目初始邀请钱包" value={address} onChange={event=>{setAddress(event.target.value.trim());setResult(undefined);setError("");}} disabled={busy} maxLength={42} placeholder="项目钱包 0x…（仅后台初始化使用）" className="field min-h-11 min-w-0 flex-1 px-3 text-xs"/>
      <button disabled={busy||!isAddress(address,{strict:false})} className="btn btn-gold min-h-11 px-5 text-xs">{busy?"正在保存…":"启用 / 查看初始邀请码"}</button>
    </form>
    {result?<div role="status" className="mt-4 rounded-lg border border-line bg-well p-4"><p className="text-xs text-mute">初始邀请码（已保存到服务器）</p><p className="mt-2 select-all font-mono text-xl font-bold tracking-widest">{result.code}</p><p className="mt-2 break-all text-xs text-mute">{typeof window!=="undefined"?window.location.origin:""}/?ref={result.code}</p></div>:null}
    {error?<p role="alert" className="mt-3 text-xs text-down">{error}</p>:null}
  </Card>;
}
