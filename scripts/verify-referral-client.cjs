/* eslint-disable @typescript-eslint/no-require-imports -- Actual client module with isolated React and HTTP fixtures. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),{JSDOM}=require('jsdom'),viem=require('viem');
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost:3000'});global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;Object.defineProperty(global,'navigator',{configurable:true,value:dom.window.navigator});
const React=require('react'),{createRoot}=require('react-dom/client');
const A='0x1111111111111111111111111111111111111111',B='0x2222222222222222222222222222222222222222',P='0x3333333333333333333333333333333333333333';
const code='ABCD2345',parent='BCDE3456',results=[],calls=[],signed=[],methods=[];let account=A,connected=true,network=97,stillCurrent=true,deferred,sessionAccount=A,sessionChain=56,payload,fail=false,mode='normal',challengeAddress=A;
const data=()=>({account,code,referrerCode:parent,referrer:P,bound:true,root:false});
const config={appChain:{id:56},chainConfig:{id:56}};
const provider={request:async args=>{methods.push(args.method);if(args.method==='personal_sign'){signed.push(args);if(deferred)await deferred;return '0x'+'1'.repeat(130);}throw new Error('Unexpected wallet request '+args.method);}};
const wallet={getConnection:()=>connected?{address:account,provider,chainId:network}:null,getChainId:async()=>network};
async function fetchMock(url,options){calls.push({url,options});if(fail)throw new Error('Offline');
 if(url==='/api/referral/auth/challenge')return{ok:true,json:async()=>({id:'1'.repeat(48),message:'free CaBi sign in',address:challengeAddress,chainId:56})};
 if(url==='/api/referral/auth/verify')return{ok:true,json:async()=>({session:{address:sessionAccount,chainId:sessionChain}})};
 if(options.method==='POST')return{ok:mode!=='error',json:async()=>mode==='error'?{error:'邀请码不存在'}:{data:payload||data()}};
 if(deferred){const held=deferred;return await held;}
 return{ok:true,json:async()=>({session:sessionAccount?{address:sessionAccount,chainId:sessionChain}:null,data:payload||data()})};
}
const filename=path.resolve(__dirname,'../src/lib/referral-data.ts'),m={exports:{}},source=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
vm.runInNewContext(source,{module:m,exports:m.exports,require:name=>name==='react'?React:name==='viem'?viem:name==='./chain-config'?config:name==='./wallet'?wallet:name==='./referral'?{}:require(name),fetch:fetchMock,window:dom.window,Event:dom.window.Event,Error,setTimeout,clearTimeout});
const client=m.exports,pass=name=>{results.push(name);console.log('PASS '+name);},pause=()=>new Promise(resolve=>setTimeout(resolve,5));
let snapshot;const root=createRoot(document.getElementById('root'));
function Probe({address}){snapshot=client.useReferralData(address);return React.createElement('p',null,snapshot.status+':'+(snapshot.data?.account||''));}
async function render(address){await React.act(async()=>{root.render(React.createElement(Probe,{address}));await pause();});await React.act(async()=>{await pause();});}
async function main(){
 const first=await client.fetchReferralData(A);assert.equal(first.referrerCode,parent);assert.equal(calls[0].url,'/api/referral');assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.credentials,'same-origin');
 sessionAccount=B;assert.equal(await client.fetchReferralData(A),undefined);sessionAccount=null;assert.equal(await client.fetchReferralData(A),undefined);sessionAccount=A;sessionChain=97;assert.equal(await client.fetchReferralData(A),undefined);sessionChain=56;payload={...data(),account:B};await assert.rejects(client.fetchReferralData(A),/不一致/);payload=undefined;
 pass('client reads only server session data and rejects another account, another chain or malformed identity');
 let refreshes=0;window.addEventListener('cabi-referral-updated',()=>refreshes++);
 calls.length=0;await client.loginReferral(A,()=>stillCurrent);assert.equal(signed.length,1);assert.deepEqual(methods,['personal_sign']);assert.equal(calls.filter(x=>x.url.endsWith('/verify')).length,1);assert.equal(refreshes,1);
 pass('free login uses personal_sign only, works without network switching and verifies the session on server');
 stillCurrent=false;await assert.rejects(client.loginReferral(A,()=>stillCurrent),/钱包已切换/);stillCurrent=true;challengeAddress=B;const signatures=signed.length;await assert.rejects(client.loginReferral(A,()=>stillCurrent),/不一致/);assert.equal(signed.length,signatures);challengeAddress=A;
 pass('abandoned wallet state or a challenge for another wallet never opens the signer');
 let release;deferred=new Promise(resolve=>release=resolve);calls.length=0;const signing=client.loginReferral(A,()=>stillCurrent);await pause();stillCurrent=false;release();await assert.rejects(signing,/钱包已切换/);assert.equal(calls.filter(x=>x.url.endsWith('/verify')).length,0);deferred=undefined;stillCurrent=true;
 pass('wallet switch while signature is pending prevents session verification');
 const bound=await client.bindInvitation(A,parent);assert.equal(bound.referrerCode,parent);const body=JSON.parse(calls.at(-1).options.body);assert.equal(body.code,parent);assert.equal(body.account,A);mode='error';await assert.rejects(client.bindInvitation(A,parent),/不存在/);mode='normal';payload={...data(),account:B};await assert.rejects(client.bindInvitation(A,parent),/钱包已切换/);payload=undefined;
 pass('bind submits a short code to the server, surfaces server errors and rejects a response for another account');
 await render(A);assert.equal(snapshot.status,'ready');assert.equal(snapshot.data.account,A);
 let finish;deferred=new Promise(resolve=>finish=resolve);let refreshing;await React.act(async()=>{refreshing=snapshot.refresh();await pause();});deferred=undefined;account=B;sessionAccount=B;await render(B);assert.equal(snapshot.data.account,B);account=A;sessionAccount=A;await render(A);assert.equal(snapshot.data.code,code);
 await React.act(async()=>{finish({ok:true,json:async()=>({session:{address:A,chainId:56},data:{...data(),code:'ZZZZ9999'}})});await refreshing;await pause();});assert.equal(snapshot.data.code,code);
 pass('late reply from the abandoned A lifecycle cannot overwrite a new A session after A-B-A switches');
 fail=true;await React.act(async()=>{await snapshot.refresh();});assert.equal(snapshot.status,'error');assert.equal(snapshot.data,undefined);fail=false;await React.act(async()=>{await snapshot.refresh();});assert.equal(snapshot.status,'ready');
 pass('failed server refresh removes previously authorized data and a successful retry restores it');
 console.log(results.length+' server referral client checks passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await React.act(async()=>root.unmount());dom.window.close();});
