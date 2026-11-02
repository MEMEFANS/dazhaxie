"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createWalletClient, custom, getAddress, type Address } from "viem";
import { appChain, chainConfig } from "./chain-config";
import * as wallet from "./wallet";
import type { ReferralData } from "./referral";
export { parseInvitation } from "./referral";
export type { ReferralData } from "./referral";
export interface ReferralSnapshot { status: "loading" | "ready" | "error"; data?: ReferralData; error?: string; }
async function request<T>(url:string,options?:RequestInit):Promise<T> {
  const response=await fetch(url,{cache:"no-store",credentials:"same-origin",...options,headers:{"Content-Type":"application/json",...options?.headers}});
  const body=await response.json();
  if(!response.ok||body.error)throw new Error(body.error||"邀请服务暂不可用，请重试");
  return body as T;
}
export async function fetchReferralData(account:string):Promise<ReferralData|undefined> {
  const result=await request<{session:{address:string;chainId:number}|null;data:ReferralData|null}>("/api/referral");
  if(!result.session||result.session.address.toLowerCase()!==account.toLowerCase()||result.session.chainId!==chainConfig.id)return undefined;
  if(!result.data||result.data.account.toLowerCase()!==account.toLowerCase())throw new Error("邀请账户不一致，请重新登录");
  return result.data;
}
export async function loginReferral(account:Address,stillCurrent:()=>boolean,code?:string) {
  const connection=wallet.getConnection(),chainId=await wallet.getChainId();
  const valid=()=>stillCurrent()&&wallet.getConnection()?.provider===connection?.provider&&wallet.getConnection()?.address.toLowerCase()===account.toLowerCase();
  if(!connection||!valid())throw new Error("钱包已切换，请重新登录");
  const challenge=await request<{id:string;message:string;address:string;chainId:number}>("/api/referral/auth/challenge",{method:"POST",body:JSON.stringify({address:account,code})});
  if(!valid()||challenge.address.toLowerCase()!==account.toLowerCase()||challenge.chainId!==chainConfig.id)throw new Error("登录请求与钱包不一致");
  const signer=createWalletClient({chain:appChain,transport:custom(connection.provider)});
  const signature=await signer.signMessage({account:getAddress(account.toLowerCase()),message:challenge.message});
  if(!valid()||await wallet.getChainId()!==chainId)throw new Error("钱包已切换，请重新登录");
  await request("/api/referral/auth/verify",{method:"POST",body:JSON.stringify({id:challenge.id,signature})});
  if(!valid())throw new Error("钱包已切换，请重新登录");
  refreshReferralData();
}
export async function bindInvitation(account:string,code:string):Promise<ReferralData> {
  const result=await request<{data:ReferralData}>("/api/referral",{method:"POST",body:JSON.stringify({account,code})});
  if(result.data.account.toLowerCase()!==account.toLowerCase())throw new Error("钱包已切换，请重新登录");
  refreshReferralData();return result.data;
}
export function refreshReferralData() { if(typeof window!=="undefined")window.dispatchEvent(new Event("cabi-referral-updated")); }
// 模块级快照缓存：软路由切换重挂载时立即恢复，避免门禁弹窗闪烁
const snapshotCache=new Map<string,ReferralSnapshot>();
// localStorage 持久化：整页刷新后模块缓存丢失，硬导航/首屏也能同步恢复「已绑定」，弹窗不闪
const LS_CACHE_KEY="cabi-referral-snapshot",LS_CACHE_TTL=24*3600_000;
function readCachedSnapshot(account:string):ReferralSnapshot|undefined {
  if(typeof window==="undefined")return undefined;
  try{
    const parsed=JSON.parse(window.localStorage.getItem(LS_CACHE_KEY)||"") as {account?:string;data?:ReferralData;at?:number};
    if(parsed.account!==account||!parsed.data?.bound||typeof parsed.at!=="number"||Date.now()-parsed.at>LS_CACHE_TTL)return undefined;
    return {status:"ready",data:parsed.data};
  }catch{return undefined;}
}
function writeCachedSnapshot(account:string,snapshot:ReferralSnapshot) {
  if(typeof window==="undefined")return;
  try{
    if(snapshot.status==="ready"&&snapshot.data?.bound)window.localStorage.setItem(LS_CACHE_KEY,JSON.stringify({account,data:snapshot.data,at:Date.now()}));
    else window.localStorage.removeItem(LS_CACHE_KEY);
  }catch{ /* 存储不可用时仅退化为可能的首屏闪动，不影响功能 */ }
}
export function useReferralData(account?:string) {
  const key=account?.toLowerCase();
  const context=useMemo(()=>({account:key}),[key]);
  const current=useRef<object|null>(null),sequence=useRef(0);
  const [saved,setSaved]=useState<{account:string;snapshot:ReferralSnapshot}|undefined>(()=>{
    if(!key)return undefined;
    const cached=snapshotCache.get(key)??readCachedSnapshot(key);
    if(cached){snapshotCache.set(key,cached);return {account:key,snapshot:cached};}
    return undefined;
  });
  const refresh=useCallback(async()=>{
    if(!context.account||current.current!==context)return;
    const id=++sequence.current;
    const settle=(snapshot:ReferralSnapshot)=>{if(current.current===context&&id===sequence.current){snapshotCache.set(context.account!,snapshot);writeCachedSnapshot(context.account!,snapshot);setSaved({account:context.account!,snapshot});}};
    try {
      const data=await fetchReferralData(context.account);
      settle({status:"ready",data});
    } catch(cause) {
      settle({status:"error",error:cause instanceof Error?cause.message:"邀请服务查询失败"});
    }
  },[context]);
  useEffect(()=>{
    current.current=context;
    sequence.current++;
    const initial=window.setTimeout(()=>void refresh(),0),timer=window.setInterval(()=>void refresh(),30_000);
    window.addEventListener("cabi-referral-updated",refresh);
    return()=>{current.current=null;window.clearTimeout(initial);window.clearInterval(timer);window.removeEventListener("cabi-referral-updated",refresh);};
  },[context,refresh]);
  const snapshot:ReferralSnapshot=saved!==undefined&&saved.account===key?saved.snapshot:{status:key?"loading":"ready"};
  return {...snapshot,refresh};
}
