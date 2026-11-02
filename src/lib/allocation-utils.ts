import { getAddress,isAddress,parseUnits,zeroAddress,type Address } from "viem";
export function holdingAllows(balance:bigint,amount:bigint,limit:bigint,exempt:boolean){return exempt||amount===0n||balance+amount<=limit;}
export function parseAllocationLines(text:string,decimals:number,wholeShares=false,allowZero=false):{addresses:Address[];amounts:bigint[];total:bigint;errors:string[]}{
  const addresses:Address[]=[],amounts:bigint[]=[],errors:string[]=[],seen=new Set<string>();
  text.split(/\r?\n/).forEach((line,i)=>{if(!line.trim())return;const parts=line.trim().split(/[\s,，]+/);
    if(parts.length!==2||!isAddress(parts[0],{strict:false})||parts[0].toLowerCase()===zeroAddress){errors.push(`第 ${i+1} 行地址或格式无效`);return;}
    if(seen.has(parts[0].toLowerCase())){errors.push(`第 ${i+1} 行地址重复`);return;}
    try{if(!/^\d+(\.\d+)?$/.test(parts[1])||(wholeShares&&!/^\d+$/.test(parts[1]))||(parts[1].split(".")[1]?.length||0)>decimals)throw new Error();const amount=wholeShares?BigInt(parts[1]):parseUnits(parts[1],decimals);if(amount<0n||(!allowZero&&amount===0n))throw new Error();seen.add(parts[0].toLowerCase());addresses.push(getAddress(parts[0].toLowerCase()));amounts.push(amount);}catch{errors.push(`第 ${i+1} 行数量需为${allowZero?"非负数":"正数"}${wholeShares?"整数份额":"，且不能超过资产精度"}`);}
  });if(addresses.length>100)errors.push("单批最多 100 个地址，请分批提交");if(!addresses.length)errors.push("请填写至少一条有效记录");return {addresses,amounts,total:amounts.reduce((a,b)=>a+b,0n),errors};
}
