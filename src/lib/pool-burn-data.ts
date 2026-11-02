"use client";
import { useMemo, useSyncExternalStore } from "react";
import { parseAbi, zeroAddress, type Address } from "viem";
import { chainConfig, chainConfigurationValid, contracts, tradingMode } from "./chain-config";
import { pancakeClient } from "./pancake-data";
export const poolBurnAbi = parseAbi([
  "function POOL_BURN_INTERVAL() view returns (uint256)",
  "function POOL_BURN_BPS() view returns (uint256)",
  "function tradingPair() view returns (address)",
  "function lastPoolBurnTime() view returns (uint256)",
  "function totalPoolBurned() view returns (uint256)",
  "function previewPoolBurn() view returns (uint256 amount,uint256 nextBurnAt,bool due)",
  "function burnPool() returns (uint256)",
]);
export interface PoolBurnData {pair:Address;interval:bigint;rateBps:bigint;lastBurn:bigint;totalBurned:bigint;amount:bigint;nextBurn:bigint;due:boolean;timestamp:bigint;}
type Snapshot={status:"unconfigured"|"loading"|"ready"|"error";data?:PoolBurnData;error?:string};
export async function fetchPoolBurnData():Promise<PoolBurnData>{
  const address=contracts.token;
  if(!address||tradingMode!=="pancake")throw new Error("当前尚未配置新版代币。");
  if(!chainConfigurationValid||await pancakeClient.getChainId()!==chainConfig.id)throw new Error("RPC 网络与项目配置不一致。");
  const blockNumber=await pancakeClient.getBlockNumber({cacheTime:0});
  const names=["tradingPair","POOL_BURN_INTERVAL","POOL_BURN_BPS","lastPoolBurnTime","totalPoolBurned","previewPoolBurn"] as const;
  const [pair,interval,rateBps,lastBurn,totalBurned,preview]=await Promise.all(names.map(functionName=>pancakeClient.readContract({address,abi:poolBurnAbi,functionName,blockNumber}))) as [Address,bigint,bigint,bigint,bigint,readonly[bigint,bigint,boolean]];
  const block=await pancakeClient.getBlock({blockNumber});
  const [amount,nextBurn,due]=preview;
  if(interval!==28800n||rateBps!==100n||amount<0n||totalBurned<0n||lastBurn<0n||lastBurn>block.timestamp
    ||(pair===zeroAddress?(nextBurn!==0n||lastBurn!==0n||due||amount!==0n):(nextBurn!==lastBurn+interval))
    ||(due&&(amount===0n||block.timestamp<nextBurn)))throw new Error("底池销毁参数或时间校验失败。");
  return{pair,interval,rateBps,lastBurn,totalBurned,amount,nextBurn,due,timestamp:block.timestamp};
}
type Entry={initial:Snapshot;snapshot:Snapshot;refresh:()=>void;subscribe:(listener:()=>void)=>()=>void};
const entries=new Map<string,Entry>();
function entryFor():Entry{
  const key=chainConfig.id+":"+contracts.token;const existing=entries.get(key);if(existing)return existing;
  const configured=Boolean(contracts.token)&&tradingMode==="pancake",initial:Snapshot={status:configured?"loading":"unconfigured"};
  const listeners=new Set<()=>void>();let busy=false,timer:ReturnType<typeof setInterval>|undefined;
  const publish=(snapshot:Snapshot)=>{entry.snapshot=snapshot;listeners.forEach(fn=>fn());};
  const entry:Entry={initial,snapshot:initial,refresh:()=>{
    if(!configured||busy)return;busy=true;publish({status:"loading"});
    void fetchPoolBurnData().then(data=>publish({status:"ready",data}),()=>publish({status:"error",error:"底池销毁状态暂不可用，请核对新版合约与网络。旧部署不会自动获得此功能。"})).finally(()=>{busy=false;});
  },subscribe:listener=>{
    listeners.add(listener);if(listeners.size===1&&configured){entry.refresh();timer=setInterval(entry.refresh,30_000);window.addEventListener("cabi-chain-updated",entry.refresh);}
    return()=>{listeners.delete(listener);if(!listeners.size){if(timer)clearInterval(timer);window.removeEventListener("cabi-chain-updated",entry.refresh);}};
  }};entries.set(key,entry);return entry;
}
export function usePoolBurnData(){const entry=useMemo(()=>entryFor(),[]);return{...useSyncExternalStore(entry.subscribe,()=>entry.snapshot,()=>entry.initial),refresh:entry.refresh};}
