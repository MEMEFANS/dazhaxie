/* eslint-disable @typescript-eslint/no-require-imports -- Isolated RPC fixtures; no public nodes or real transactions. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(file,replacements={}){const m={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{module:m,exports:m.exports,require:n=>n==='server-only'?{}:Object.hasOwn(replacements,n)?replacements[n]:require(n),fetch,Request,Response,Buffer,AbortSignal,URL,Date,process,console,setTimeout,clearTimeout});return m.exports;}
const {createRpcRelay,validRpcRequest}=load('src/lib/server/rpc-relay.ts');
const addr='0x1111111111111111111111111111111111111111',hash='0x'+'ab'.repeat(32);
const rpc=(id,method='eth_call',params=[{to:addr,data:'0x18160ddd'},'latest'])=>({jsonrpc:'2.0',id,method,params});
async function main(){
 for(const method of ['eth_sendRawTransaction','eth_sendTransaction','personal_sign','debug_traceCall','eth_getLogs'])assert.equal(validRpcRequest(rpc(1,method,[])),false);
 assert.equal(validRpcRequest(rpc(1,'eth_call',[{to:'http://bad'},'latest'])),false);
 assert.equal(validRpcRequest(rpc(1,'eth_call',[{to:addr,gas:'0xffffffff'},'latest'])),false);
 let calls=[],wrong=false,fail=false,result='0x1234',missing=false;
 const upstream=async(url,options)=>{const r=JSON.parse(options.body);calls.push({url,...r});await new Promise(resolve=>setTimeout(resolve,2));if(url==='first'&&fail)throw Error('timeout');return Response.json({jsonrpc:'2.0',id:r.id,...(r.method==='eth_chainId'?{result:url==='first'&&wrong?'0x61':'0x38'}:result==='revert'?{error:{code:3,message:'execution reverted',data:'0xdead'}}:{result:missing?null:result})});};
 const relay=createRpcRelay(['first','second'],56,upstream);
 const simultaneous=await Promise.all([relay(rpc(1)),relay(rpc(2)),relay(rpc(3))]);
 assert(simultaneous.every(r=>r.result==='0x1234'));assert.equal(calls.filter(r=>r.method==='eth_call').length,1);assert.equal(calls.filter(r=>r.method==='eth_chainId').length,1);
 await relay(rpc(4));assert.equal(calls.length,2);console.log('PASS duplicate reads share one upstream call and cached replies');
 wrong=true;calls=[];const failover=createRpcRelay(['first','second'],56,upstream);await failover(rpc(5));assert(!calls.some(c=>c.url==='first'&&c.method==='eth_call'));assert(calls.some(c=>c.url==='second'&&c.method==='eth_call'));
 wrong=false;fail=true;calls=[];await createRpcRelay(['first','second'],56,upstream)(rpc(6));assert(calls.some(c=>c.url==='second'));console.log('PASS wrong-chain nodes and unavailable nodes fail over');
 fail=false;result='revert';calls=[];const revert=createRpcRelay(['first'],56,upstream);const error=await revert(rpc(7));assert.equal(error.error.code,3);assert.equal(error.error.data,'0xdead');await revert(rpc(8));assert.equal(calls.filter(r=>r.method==='eth_call').length,2);console.log('PASS simulation reverts preserve error data and are never cached');
 result='0x1234';missing=true;calls=[];const receipts=createRpcRelay(['first'],56,upstream);await receipts(rpc(9,'eth_getTransactionReceipt',[hash]));missing=false;assert.equal((await receipts(rpc(10,'eth_getTransactionReceipt',[hash]))).result,'0x1234');assert.equal(calls.filter(r=>r.method==='eth_getTransactionReceipt').length,2);console.log('PASS pending transaction receipts are fetched again');
 const route=load('src/app/api/rpc/route.ts',{'@/lib/chain-config':{chainConfig:{id:56,rpcUrls:['first']},chainConfigurationValid:true},'@/lib/server/rpc-relay':{validRpcRequest,createRpcRelay:()=>relay}});
 const post=(body,origin='http://localhost')=>route.POST(new Request('http://localhost/api/rpc',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)}));
 const originalOrigin=process.env.APP_ORIGIN;delete process.env.APP_ORIGIN;
 try{assert.equal((await post(rpc(1),'https://other.test')).status,403);const n=calls.length;assert.equal((await post([rpc(1),rpc(2,'eth_sendRawTransaction',['0x1234'])])).status,400);assert.equal(calls.length,n);const batch=await(await post([rpc('a'),rpc('b')])).json();assert.equal(batch[0].id,'a');assert.equal(batch[1].id,'b');assert.equal((await post(Array(41).fill(rpc(1)))).status,400);console.log('PASS HTTP relay rejects writes, foreign origins and oversized batches; response IDs remain correct');}finally{if(originalOrigin===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=originalOrigin;}
 const chains={56:{id:56},97:{id:97}};const clientSource=fs.readFileSync('src/lib/chain-config.ts','utf8');const m={exports:{}};vm.runInNewContext(ts.transpileModule(clientSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:n=>n==='viem/chains'?{bsc:chains[56],bscTestnet:chains[97]}:require(n),window:{},process,URL});assert.equal(m.exports.chainConfig.rpcUrls[0],'/api/rpc');assert(m.exports.CHAIN_PRESETS[56].rpcUrls[0].startsWith('https://'));console.log('PASS browser RPC stays on the website while wallet network URLs remain public HTTPS');
}
main().catch(e=>{console.error(e);process.exitCode=1;});

