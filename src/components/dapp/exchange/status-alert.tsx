"use client";
import { Ban } from "lucide-react";
import { useRedemptionConfig } from "@/lib/redemption-client";
import { Notice } from "@/components/dapp/ui";
export function ExchangeClosedAlert(){const {data,error,loading}=useRedemptionConfig();if(data?.enabled)return null;return <Notice tone="gray" icon={Ban}><p className="text-sm font-medium text-strong">{loading?"正在读取兑换服务":error?"兑换服务查询失败":data?.message||"兑换暂未开放"}</p><p className="mt-1 text-xs leading-6 text-mute">兑换由后台运营开关控制；代币转入指定收款地址后不可撤回，收货信息由后台用于发货。</p></Notice>;}
