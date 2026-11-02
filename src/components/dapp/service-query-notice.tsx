"use client";
import { RefreshCw } from "lucide-react";
import type { ClaimPoolStatus } from "@/lib/claim-pool-data";
export function ServiceQueryNotice({status,error,refresh,label}:{status:ClaimPoolStatus;error?:string;refresh:()=>void;label:string}){
  if(status==="ready")return null;
  return <div role={status==="error"?"alert":"status"} className="mt-4 rounded-lg border border-dashed border-line bg-well p-4 text-xs leading-6 text-mute">{status==="unconfigured"?label+"合约尚未配置，部署并完成注资后开放。":status==="loading"?"正在查询"+label+"链上状态…":error||"查询失败"}{status==="error"?<button onClick={refresh} className="btn btn-outline ml-2 min-h-11 px-3 text-xs"><RefreshCw size={12}/>重试</button>:null}</div>;
}

