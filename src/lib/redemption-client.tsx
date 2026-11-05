"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createWalletClient, custom, getAddress } from "viem";
import { appChain, chainConfig } from "./chain-config";
import { useStore } from "./store";
import * as wallet from "./wallet";
import type { RedemptionConfig, RedemptionOrder } from "./redemption";
import { fetchSharedConfig } from "./shared-config-request";
export async function redemptionRequest<T>(url:string, options?:RequestInit):Promise<T> {
  const response=await fetch(url,{cache:"no-store",...options,headers:{"Content-Type":"application/json",...options?.headers}});
  const body=await response.json();
  if(!response.ok || body.error) throw new Error(body.error || "服务暂时不可用，请稍后重试");
  return body as T;
}
export function notifyRedemptionChanged() { window.dispatchEvent(new Event("cabi-redemption-updated")); }
export function useRedemptionConfig() {
  const [data,setData]=useState<RedemptionConfig>(); const [error,setError]=useState(""); const [loading,setLoading]=useState(true);
  const mounted=useRef(false);
  const refresh=useCallback(async()=>{
    try {const next=await fetchSharedConfig<RedemptionConfig>("/api/redemption/config","兑换配置读取失败");if(mounted.current){setData(next);setError("");}}
    catch(e){if(mounted.current){setError(e instanceof Error?e.message:"兑换配置读取失败");setData(undefined);}}
    finally{if(mounted.current)setLoading(false);}
  },[]);
  useEffect(()=>{mounted.current=true;const initial=window.setTimeout(()=>void refresh(),0);const timer=window.setInterval(()=>void refresh(),30_000);window.addEventListener("cabi-redemption-updated",refresh);window.addEventListener("cabi-operational-settings-updated",refresh);return()=>{mounted.current=false;window.clearTimeout(initial);window.clearInterval(timer);window.removeEventListener("cabi-redemption-updated",refresh);window.removeEventListener("cabi-operational-settings-updated",refresh);};},[refresh]);
  return {data,error,loading,refresh,status:loading?"loading" as const:error?"error" as const:data?.configured?"ready" as const:"unconfigured" as const};
}
export function useRedemptionAccount() {
  const {state}=useStore();const identity=`${state.address.toLowerCase()}:${state.chainId}`;const identityRef=useRef(identity);
  useEffect(()=>{identityRef.current=identity;},[identity]);
  const [snapshot,setSnapshot]=useState<{identity:string;authenticated:boolean;orders:RedemptionOrder[]}>({identity,authenticated:false,orders:[]});
  const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  const current=snapshot.identity===identity?snapshot:{identity,authenticated:false,orders:[]};
  const refresh=useCallback(async()=>{
    if(!state.connected)return;
    const expected=identity;
    try {
      const {session}=await redemptionRequest<{session:{address:string;chainId:number}|null}>("/api/redemption/auth/session");
      const authenticated=Boolean(session&&session.address.toLowerCase()===state.address.toLowerCase()&&session.chainId===state.chainId);
      const orders=authenticated?(await redemptionRequest<{orders:RedemptionOrder[]}>("/api/redemption/orders")).orders:[];
      if(identityRef.current===expected){setSnapshot({identity:expected,authenticated,orders});setError("");}
    }catch(e){if(identityRef.current===expected)setError(e instanceof Error?e.message:"订单查询失败");}
  },[identity,state.address,state.chainId,state.connected]);
  useEffect(()=>{const initial=window.setTimeout(()=>void refresh(),0);window.addEventListener("cabi-redemption-updated",refresh);return()=>{window.clearTimeout(initial);window.removeEventListener("cabi-redemption-updated",refresh);};},[refresh]);
  async function login(){
    setBusy(true);setError("");const expected=identity;
    try{const connection=wallet.getConnection();if(!connection||await wallet.getChainId()!==chainConfig.id)throw new Error(`请连接并切换到 ${chainConfig.shortName}`);
      const challenge=await redemptionRequest<{id:string;message:string;address:string;chainId:number}>("/api/redemption/auth/challenge",{method:"POST",body:JSON.stringify({address:state.address})});
      if(challenge.chainId!==chainConfig.id||challenge.address.toLowerCase()!==state.address.toLowerCase())throw new Error("签名请求与钱包不一致");
      const signer=createWalletClient({chain:appChain,transport:custom(connection.provider)});
      const signature=await signer.signMessage({account:getAddress(state.address.toLowerCase()),message:challenge.message});
      if(identityRef.current!==expected||await wallet.getChainId()!==chainConfig.id||wallet.getConnection()?.address.toLowerCase()!==state.address.toLowerCase())throw new Error("钱包已经切换，请重新签名");
      await redemptionRequest("/api/redemption/auth/verify",{method:"POST",body:JSON.stringify({id:challenge.id,signature})});await refresh();notifyRedemptionChanged();
    }catch(e){setError(e instanceof Error?/rejected|denied|4001/i.test(e.message)?"已取消签名登录":e.message:"签名登录失败");}finally{setBusy(false);}
  }
  return {...current,error,busy,login,refresh};
}
