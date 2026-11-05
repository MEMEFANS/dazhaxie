"use client";
import { useMemo, useSyncExternalStore } from "react";
import { createPublicClient, fallback, http, isAddress, getAddress, parseAbi, zeroAddress, type Address } from "viem";
import { appChain, chainConfig, chainConfigurationValid, contracts, tradingMode } from "./chain-config";
export const pancakeTaxAbi = parseAbi([
  "function owner() view returns (address)", "function pendingOwner() view returns (address)",
  "function usdt() view returns (address)", "function dexRouter() view returns (address)", "function tradingPair() view returns (address)",
  "function distributionReceiver() view returns (address)", "function buybackPool() view returns (address)",
  "function swapThreshold() view returns (uint256)", "function maxSwapAmount() view returns (uint256)",
  "function swapSlippageBps() view returns (uint256)", "function autoSwapEnabled() view returns (bool)",
  "function taxTokenBalance() view returns (uint256)", "function totalPendingPayouts() view returns (uint256)",
  "function pendingPayouts(address) view returns (uint256)", "function previewTaxSwap(uint256) view returns (uint256,uint256)",
  "function setTaxReceivers(address,address)",
  "function setSwapSettings(uint256,uint256,uint256,bool)", "function processTax(uint256,uint256,uint256) returns (uint256)",
  "function claimPayout(address)", "function setMaxWalletExempt(address,bool)",
  "function transferOwnership(address)", "function acceptOwnership()",
]);
const assetAbi = parseAbi(["function decimals() view returns (uint8)","function balanceOf(address) view returns (uint256)"]);
const pairAbi = parseAbi(["function token0() view returns (address)","function token1() view returns (address)","function getReserves() view returns (uint112,uint112,uint32)"]);
export const pancakeClient = createPublicClient({chain:appChain,transport:fallback(chainConfig.rpcUrls.map(url=>http(url,{timeout:10_000,retryCount:0})),{retryCount:0})});
export interface PancakeTaxData {owner:Address;pendingOwner:Address;usdt:Address;router:Address;pair:Address;distributionReceiver:Address;buybackPool:Address;threshold:bigint;maxAmount:bigint;slippageBps:bigint;automatic:boolean;accruedTokens:bigint;pendingTotal:bigint;pendingAmount?:bigint;usdtDecimals:number;bound:boolean;liquid:boolean;}
type Snapshot={status:"unconfigured"|"loading"|"error"|"ready";data?:PancakeTaxData;error?:string};
type Entry={initial:Snapshot;snapshot:Snapshot;listeners:Set<()=>void>;subscribe:(listener:()=>void)=>()=>void;refresh:()=>void};
const entries=new Map<string,Entry>();
async function load(account?:Address):Promise<PancakeTaxData>{
  const address=contracts.token!;
  if(!chainConfigurationValid||await pancakeClient.getChainId()!==chainConfig.id)throw new Error("RPC 网络与项目配置不一致。");
  const blockNumber=await pancakeClient.getBlockNumber({cacheTime:0});
  const code=await pancakeClient.getCode({address,blockNumber});if(!code||code==="0x")throw new Error("当前网络尚未找到 CaBi 合约。");
  const names=["owner","pendingOwner","usdt","dexRouter","tradingPair","distributionReceiver","buybackPool","swapThreshold","maxSwapAmount","swapSlippageBps","autoSwapEnabled","taxTokenBalance","totalPendingPayouts"] as const;
  const [owner,pendingOwner,usdt,router,pair,distributionReceiver,buybackPool,threshold,maxAmount,slippageBps,automatic,accruedTokens,pendingTotal]=await Promise.all(names.map(functionName=>pancakeClient.readContract({address,abi:pancakeTaxAbi,functionName,blockNumber}))) as [Address,Address,Address,Address,Address,Address,Address,bigint,bigint,bigint,boolean,bigint,bigint];
  const bound=pair!==zeroAddress&&router!==zeroAddress&&usdt!==zeroAddress;let liquid=false,usdtDecimals=18;
  if(bound){
    if(!contracts.usdt||usdt.toLowerCase()!==contracts.usdt.toLowerCase())throw new Error("代币绑定 USDT 与网站配置不一致，已关闭交易入口。");
    const [first,second,reserves,decimals]=await Promise.all([pancakeClient.readContract({address:pair,abi:pairAbi,functionName:"token0",blockNumber}),pancakeClient.readContract({address:pair,abi:pairAbi,functionName:"token1",blockNumber}),pancakeClient.readContract({address:pair,abi:pairAbi,functionName:"getReserves",blockNumber}),pancakeClient.readContract({address:usdt,abi:assetAbi,functionName:"decimals",blockNumber})]);
    const assets=[first.toLowerCase(),second.toLowerCase()];if(!assets.includes(address.toLowerCase())||!assets.includes(usdt.toLowerCase()))throw new Error("交易对资产不匹配。");
    liquid=reserves[0]>0n&&reserves[1]>0n;usdtDecimals=decimals;
  }
  const pendingAmount=account?await pancakeClient.readContract({address,abi:pancakeTaxAbi,functionName:"pendingPayouts",args:[account],blockNumber}):undefined;
  return {owner,pendingOwner,usdt,router,pair,distributionReceiver,buybackPool,threshold,maxAmount,slippageBps,automatic,accruedTokens,pendingTotal,pendingAmount,usdtDecimals,bound,liquid};
}
function entryFor(account?:string):Entry{
 const key=`${chainConfig.id}:${contracts.token||""}:${account?.toLowerCase()||"public"}`;const entry=entries.get(key);if(entry)return entry;
 const configured=tradingMode==="pancake"&&Boolean(contracts.token),valid=!account||isAddress(account,{strict:false});const initial:Snapshot={status:!valid?"error":configured?"loading":"unconfigured",...(!valid?{error:"钱包地址无效"}:{})};
 let active=false,timer:ReturnType<typeof setInterval>|undefined;const next:Entry={initial,snapshot:initial,listeners:new Set(),subscribe:()=>()=>{},refresh:()=>{}};const publish=(snapshot:Snapshot)=>{next.snapshot=snapshot;next.listeners.forEach(fn=>fn());};
 next.refresh=()=>{if(!configured||!valid||active)return;active=true;publish({status:"loading"});void load(account?getAddress(account.toLowerCase()):undefined).then(data=>publish({status:"ready",data}),error=>publish({status:"error",error:error instanceof Error&&error.message.length<180?error.message:"薄饼交易税状态读取失败，请检查代币版本与网络配置。"})).finally(()=>{active=false;});};
 next.subscribe=listener=>{next.listeners.add(listener);if(next.listeners.size===1&&configured&&valid){next.refresh();timer=setInterval(next.refresh,30_000);window.addEventListener("cabi-chain-updated",next.refresh);}return()=>{next.listeners.delete(listener);if(!next.listeners.size&&timer){clearInterval(timer);timer=undefined;window.removeEventListener("cabi-chain-updated",next.refresh);}};};entries.set(key,next);return next;
}
export function usePancakeTaxData(account?:string){const entry=useMemo(()=>entryFor(account),[account]);return {...useSyncExternalStore(entry.subscribe,()=>entry.snapshot,()=>entry.initial),refresh:entry.refresh};}
