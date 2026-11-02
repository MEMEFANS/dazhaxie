/* eslint-disable @typescript-eslint/no-require-imports -- Keeper logic with isolated clients, no private keys or broadcasts. */
const assert=require('node:assert/strict'),{settings,inspect,executeBurn,confirm}=require('./pool-burn-keeper.cjs'),{encodeFunctionData,parseAbi}=require('viem');
const TOKEN='0x1111111111111111111111111111111111111111',QUOTE='0x2222222222222222222222222222222222222222',PAIR='0x3333333333333333333333333333333333333333',ACCOUNT='0x4444444444444444444444444444444444444444',HASH='0x'+'5'.repeat(64),results=[];
const env={NEXT_PUBLIC_CHAIN_ID:'97',NEXT_PUBLIC_TOKEN_ADDRESS:TOKEN,NEXT_PUBLIC_USDT_ADDRESS:QUOTE,POOL_BURN_RPC_URL:'http://isolated.invalid'},config=settings(env);
const pass=name=>{results.push(name);console.log('PASS '+name);};
function fixture(options={}){const sends=[],saved=[],reads=[];const client={getChainId:async()=>options.wrongChain?56:97,getBlockNumber:async()=>123n,getCode:async()=>options.noCode?'0x':'0x6000',getBlock:async()=>({timestamp:30000n}),getGasPrice:async()=>options.expensive?6000000000n:1000000000n,readContract:async request=>{assert.equal(request.blockNumber,123n);reads.push(request);const values={POOL_BURN_INTERVAL:28800n,POOL_BURN_BPS:options.badRate?300n:100n,previewPoolBurn:[100n,options.future?40000n:28900n,!options.notDue],tradingPair:PAIR,usdt:options.wrongQuote?PAIR:QUOTE};return values[request.functionName];},simulateContract:async request=>{if(options.simulationFailure)throw new Error('state changed');return{request};},waitForTransactionReceipt:async()=>{if(options.timeout)throw new Error('timeout');return{status:options.reverted?'reverted':'success',transactionHash:HASH};},getTransaction:async()=>({from:ACCOUNT,to:options.wrongTarget?PAIR:TOKEN,input:encodeFunctionData({abi:parseAbi(['function burnPool()']),functionName:'burnPool'}),value:0n})};const wallet={writeContract:async request=>{sends.push(request);return HASH;}};return{client,wallet,sends,saved,reads};}
async function main(){
 assert.equal(config.maxGasPrice,5000000000n);assert.equal(settings({...env,POOL_BURN_MAX_GAS_PRICE_GWEI:'1.25'}).maxGasPrice,1250000000n);
 for(const patch of [{NEXT_PUBLIC_CHAIN_ID:'1'},{NEXT_PUBLIC_TOKEN_ADDRESS:'bad'},{NEXT_PUBLIC_USDT_ADDRESS:''},{POOL_BURN_RPC_URL:'ftp://invalid'},{POOL_BURN_MAX_GAS_PRICE_GWEI:'0'},{POOL_BURN_MAX_GAS_PRICE_GWEI:'invalid'}])assert.throws(()=>settings({...env,...patch}));
 pass('keeper requires explicit chain, assets and RPC configuration with a positive gas ceiling');
 let f=fixture();const read=await inspect(f.client,config);assert.equal(read.due,true);assert.equal(f.sends.length,0);assert.equal(f.reads.length,5);
 pass('dry inspection is read-only and checks fixed policy and bound quote asset');
 for(const options of [{wrongChain:true},{noCode:true},{badRate:true},{wrongQuote:true},{future:true}]){f=fixture(options);await assert.rejects(executeBurn(f.client,f.wallet,{address:ACCOUNT},config,hash=>f.saved.push(hash)));assert.equal(f.sends.length,0);}
 pass('wrong chain, assets, contract policy or inconsistent time prevents broadcasting');
 f=fixture({notDue:true});assert.equal((await executeBurn(f.client,f.wallet,{address:ACCOUNT},config,hash=>f.saved.push(hash))).status,'not-due');assert.equal(f.sends.length,0);
 for(const options of [{expensive:true},{simulationFailure:true}]){f=fixture(options);await assert.rejects(executeBurn(f.client,f.wallet,{address:ACCOUNT},config,hash=>f.saved.push(hash)));assert.equal(f.sends.length,0);}
 pass('not-due, expensive gas and failed simulation never send a transaction');
 f=fixture();const result=await executeBurn(f.client,f.wallet,{address:ACCOUNT},config,hash=>f.saved.push(hash));assert.equal(result.status,'broadcast');assert.equal(f.sends.length,1);assert.deepEqual(f.saved,[HASH]);assert.equal(f.sends[0].functionName,'burnPool');assert.equal(f.sends[0].gasPrice,1000000000n);
 assert.equal((await confirm(f.client,config,{address:ACCOUNT},HASH)).status,'confirmed');
 pass('successful execution sends only burnPool, saves its hash and validates confirmed calldata and sender');
 f=fixture({timeout:true});await assert.rejects(confirm(f.client,config,{address:ACCOUNT},HASH));assert.equal(f.sends.length,0);f=fixture({wrongTarget:true});await assert.rejects(confirm(f.client,config,{address:ACCOUNT},HASH));f=fixture({wrongChain:true});await assert.rejects(confirm(f.client,config,{address:ACCOUNT},HASH));f=fixture({reverted:true});assert.equal((await confirm(f.client,config,{address:ACCOUNT},HASH)).status,'reverted');
 pass('timeout remains pending, foreign transactions reject and reverted receipts never report a burn');
 console.log(results.length+' pool burn keeper checks passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
