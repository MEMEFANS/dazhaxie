"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient, custom, getAddress, type Address } from "viem";
import { signMessage } from "viem/actions";
import { appChain, chainConfig } from "./chain-config";
import * as wallet from "./wallet";
import type { ReferralBinding, ReferralData } from "./referral";
export { parseInvitation } from "./referral";
export type { ReferralData } from "./referral";
export interface ReferralSnapshot { status: "loading" | "ready" | "error"; data?: ReferralData; binding?: ReferralBinding; error?: string; }
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
async function fetchReferralSnapshot(account: string): Promise<ReferralSnapshot> {
  const data = await fetchReferralData(account);
  if (data) return { status: "ready", data, binding: { account, chainId: chainConfig.id, bound: data.bound } };
  const binding = await request<ReferralBinding>(`/api/referral/status?account=${encodeURIComponent(account)}`);
  if (typeof binding.account !== "string" || binding.account.toLowerCase() !== account.toLowerCase() || binding.chainId !== chainConfig.id || typeof binding.bound !== "boolean") {
    throw new Error("邀请账户状态不一致，请重新查询");
  }
  return { status: "ready", binding };
}
export async function loginReferral(account:Address,stillCurrent:()=>boolean,code?:string) {
  const connection=wallet.getConnection(),chainId=await wallet.getChainId();
  const valid=()=>stillCurrent()&&wallet.getConnection()?.provider===connection?.provider&&wallet.getConnection()?.address.toLowerCase()===account.toLowerCase();
  if(!connection||!valid())throw new Error("钱包已切换，请重新登录");
  const challenge=await request<{id:string;message:string;address:string;chainId:number}>("/api/referral/auth/challenge",{method:"POST",body:JSON.stringify({address:account,code})});
  if(!valid()||challenge.address.toLowerCase()!==account.toLowerCase()||challenge.chainId!==chainConfig.id)throw new Error("登录请求与钱包不一致");
  const signer=createClient({chain:appChain,transport:custom(connection.provider)});
  const signature=await signMessage(signer,{account:getAddress(account.toLowerCase()),message:challenge.message});
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
// 绑定状态只控制提示。认证数据始终来自会话接口，不从 localStorage 恢复。
const snapshotCache=new Map<string,ReferralSnapshot>();
const LS_CACHE_KEY="cabi-referral-binding",LS_CACHE_TTL=24*3600_000;
const cacheKey=(account:string)=>`${chainConfig.id}:${account}`;
function readCachedSnapshot(account:string):ReferralSnapshot|undefined {
  if(typeof window==="undefined")return undefined;
  try{
    const parsed=JSON.parse(window.localStorage.getItem(`${LS_CACHE_KEY}:${cacheKey(account)}`)||"") as {binding?:ReferralBinding;at?:number};
    if(parsed.binding?.account!==account||parsed.binding.chainId!==chainConfig.id||parsed.binding.bound!==true||typeof parsed.at!=="number"||Date.now()-parsed.at>LS_CACHE_TTL)return undefined;
    return {status:"loading",binding:parsed.binding};
  }catch{return undefined;}
}
function writeCachedSnapshot(account:string,snapshot:ReferralSnapshot) {
  if(typeof window==="undefined")return;
  try{
    const key=`${LS_CACHE_KEY}:${cacheKey(account)}`;
    if(snapshot.status!=="ready")return;
    if(snapshot.binding?.bound)window.localStorage.setItem(key,JSON.stringify({binding:{...snapshot.binding,account},at:Date.now()}));
    else window.localStorage.removeItem(key);
  }catch{ /* 存储不可用时仅退化为可能的首屏闪动，不影响功能 */ }
}
export function useReferralData(account?:string) {
  const key=account?.toLowerCase();
  const context=useMemo(()=>({account:key}),[key]);
  const current=useRef<object|null>(null),sequence=useRef(0);
  const [saved,setSaved]=useState<{account:string;snapshot:ReferralSnapshot}|undefined>(()=>{
    if(!key)return undefined;
    const cached=snapshotCache.get(cacheKey(key))??readCachedSnapshot(key);
    if(cached){snapshotCache.set(cacheKey(key),cached);return {account:key,snapshot:cached};}
    return undefined;
  });
  const refresh=useCallback(async()=>{
    if(!context.account||current.current!==context)return;
    const id=++sequence.current;
    const settle=(snapshot:ReferralSnapshot)=>{if(current.current===context&&id===sequence.current){snapshotCache.set(cacheKey(context.account!),snapshot);writeCachedSnapshot(context.account!,snapshot);setSaved({account:context.account!,snapshot});}};
    try {
      settle(await fetchReferralSnapshot(context.account));
    } catch(cause) {
      const binding=(snapshotCache.get(cacheKey(context.account))??readCachedSnapshot(context.account))?.binding;
      settle({status:"error",binding,error:cause instanceof Error?cause.message:"邀请服务查询失败"});
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
