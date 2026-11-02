/* eslint-disable @typescript-eslint/no-require-imports -- Isolated data reader, no public RPC. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),viem=require('viem');
const TOKEN='0x1111111111111111111111111111111111111111',PAIR='0x2222222222222222222222222222222222222222',results=[];
const filename=path.resolve(__dirname,'../src/lib/pool-burn-data.ts'),source=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function setup(patch={},options={}){
 const calls=[],values={tradingPair:PAIR,POOL_BURN_INTERVAL:28800n,POOL_BURN_BPS:100n,lastPoolBurnTime:100n,totalPoolBurned:500n,previewPoolBurn:[1000n,28900n,true],...patch};
 const client={getChainId:async()=>options.wrongChain?97:56,getBlockNumber:async({cacheTime})=>{assert.equal(cacheTime,0);return 123n;},readContract:async request=>{calls.push(request);assert.equal(request.blockNumber,123n);if(options.unsupported)throw new Error('selector');return values[request.functionName];},getBlock:async({blockNumber})=>{assert.equal(blockNumber,123n);return{timestamp:options.timestamp??30000n};}};
 const m={exports:{}};vm.runInNewContext(source,{module:m,exports:m.exports,require:name=>name==='react'?{useMemo:f=>f()}:name==='viem'?viem:name==='./chain-config'?{chainConfig:{id:56},chainConfigurationValid:!options.badConfig,contracts:{token:options.unconfigured?undefined:TOKEN},tradingMode:options.legacy?'gateway':'pancake'}:name==='./pancake-data'?{pancakeClient:client}:require(name),Error,setInterval,clearInterval});return{...m.exports,calls};
}
const pass=name=>{results.push(name);console.log('PASS '+name);};
async function main(){
 const reader=setup(),d=await reader.fetchPoolBurnData();assert.equal(d.due,true);assert.equal(d.amount,1000n);assert.equal(d.nextBurn,28900n);assert.equal(reader.calls.length,6);
 pass('pool burn reads pin interval, rate, amount, accounting and chain timestamp to one fresh block');
 const idle=await setup({previewPoolBurn:[1000n,28900n,false]},{timestamp:28899n}).fetchPoolBurnData();assert.equal(idle.due,false);
 const noPair=await setup({tradingPair:viem.zeroAddress,lastPoolBurnTime:0n,previewPoolBurn:[0n,0n,false]}).fetchPoolBurnData();assert.equal(noPair.pair,viem.zeroAddress);
 pass('not-yet-due and unconfigured pair states remain read-only without inventing a burn');
 for(const patch of [{POOL_BURN_INTERVAL:86400n},{POOL_BURN_BPS:300n},{previewPoolBurn:[1000n,28901n,true]},{previewPoolBurn:[0n,28900n,true]},{lastPoolBurnTime:40000n},{totalPoolBurned:-1n},{previewPoolBurn:[-1n,28900n,true]},{tradingPair:viem.zeroAddress}])await assert.rejects(setup(patch).fetchPoolBurnData());
 await assert.rejects(setup({}, {timestamp:10000n}).fetchPoolBurnData());
 pass('wrong burn rate, interval, clock and inconsistent due flags fail closed');
 for(const options of [{wrongChain:true},{badConfig:true},{unconfigured:true},{legacy:true},{unsupported:true}])await assert.rejects(setup({},options).fetchPoolBurnData());
 pass('old contract, wrong network and absent configuration cannot enable the new action');
 const encoded=viem.encodeFunctionData({abi:reader.poolBurnAbi,functionName:'burnPool'});assert.equal(viem.decodeFunctionData({abi:reader.poolBurnAbi,data:encoded}).functionName,'burnPool');
 pass('production burn ABI contains only a parameterless, nonpayable execution call');
 console.log(results.length+' pool burn data checks passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
