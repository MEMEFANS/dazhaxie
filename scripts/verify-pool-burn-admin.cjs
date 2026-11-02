/* eslint-disable @typescript-eslint/no-require-imports -- Actual React administration component with isolated chain fixtures. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),viem=require('viem'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost:3000/admin/contracts'});global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;Object.defineProperty(global,'navigator',{configurable:true,value:dom.window.navigator});
const React=require('react'),{createRoot}=require('react-dom/client');
const A='0x1111111111111111111111111111111111111111',B='0x2222222222222222222222222222222222222222',TOKEN='0x3333333333333333333333333333333333333333',PAIR='0x4444444444444444444444444444444444444444',writes=[],results=[];
const state={connected:true,address:A,chainId:56},query={status:'ready',data:undefined,refresh(){refreshes++;}},tx={busy:false,run:async request=>{if(request.beforeSend)await request.beforeSend();writes.push(request);return hash;}};
let fresh,deferred,refreshes=0,version=0,hash;
const filename=path.resolve(__dirname,'../src/components/admin/pool-burn-settings.tsx'),m={exports:{}};
const box=({children})=>React.createElement('section',null,children),config={chainConfig:{id:56},contracts:{token:TOKEN}};
const replacements={react:React,viem,'@/lib/store':{useStore:()=>({state})},'@/lib/chain-config':config,'@/lib/amounts':{formatAssetAmount:(n,d)=>viem.formatUnits(n,d)},'@/lib/pool-burn-data':{poolBurnAbi:viem.parseAbi(['function burnPool() returns(uint256)']),usePoolBurnData:()=>query,fetchPoolBurnData:async()=>{if(deferred)await deferred;return fresh;}},'@/lib/contract-transactions':{useContractTransaction:()=>tx,TransactionFeedback:()=>null},'@/components/dapp/ui':{Card:box,DataRow:({label,value})=>React.createElement('p',null,label+': '+value)},'@/components/dapp/service-query-notice':{ServiceQueryNotice:()=>null},'./chain-confirm':{ChainConfirmModal:({open,onCancel,onConfirm})=>open?React.createElement('div',null,React.createElement('button',{'aria-label':'取消链上操作',onClick:onCancel},'取消'),React.createElement('button',{'aria-label':'确认执行链上操作',onClick:onConfirm},'确认')):null}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{module:m,exports:m.exports,require:name=>Object.hasOwn(replacements,name)?replacements[name]:require(name),Error,Intl,Date,window:dom.window,console,setTimeout,clearTimeout});
const root=createRoot(document.getElementById('root')),pause=()=>new Promise(resolve=>setTimeout(resolve,3));
async function render(){await React.act(async()=>{root.render(React.createElement(m.exports.PoolBurnSettings,{key:version}));await pause();});}
async function reset(){Object.assign(state,{connected:true,address:A,chainId:56});query.status='ready';delete query.error;query.data={pair:PAIR,interval:28800n,rateBps:100n,lastBurn:100n,nextBurn:28900n,totalBurned:1000n,amount:100n*10n**18n,due:true,timestamp:30000n};fresh={...query.data};deferred=undefined;refreshes=0;writes.length=0;hash='0x'+'1'.repeat(64);tx.busy=false;version++;await render();}
const consent=()=>document.querySelector('[aria-label="确认底池代币销毁"]'),action=()=>document.querySelector('[aria-label="执行到期底池销毁"]');
async function click(element){await React.act(async()=>{element.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));await pause();});}
async function confirmChain(){const element=document.querySelector('[aria-label="确认执行链上操作"]');assert(element,'Missing chain confirmation');await click(element);}
const pass=name=>{results.push(name);console.log('PASS '+name);};
async function main(){
 await reset();assert(document.body.textContent.includes('8 小时 / 1% CaBi'));assert(document.body.textContent.includes('北京时间'));assert.equal(action().disabled,true);await click(consent());assert.equal(action().disabled,false);await click(action());assert.equal(writes.length,0);assert(document.querySelector('[aria-label="确认执行链上操作"]'),'confirmation modal should open');await click(document.querySelector('[aria-label="取消链上操作"]'));assert.equal(writes.length,0);await click(action());await confirmChain();assert.equal(writes.length,1);assert.equal(writes[0].functionName,'burnPool');assert.equal(writes[0].approval,undefined);assert.equal(writes[0].args.length,0);assert(refreshes>0);assert.equal(consent().checked,false);
 pass('explicit confirmed burn uses parameterless burnPool without asset approval and refreshes authoritative data');
 for(const change of [{connected:false},{chainId:97}]){await reset();Object.assign(state,change);await render();assert.equal(consent().disabled,true);assert.equal(action().disabled,true);}
 pass('disconnected and wrong-network wallets cannot trigger pool burns');
 await reset();state.address=B;await render();await click(consent());await click(action());await confirmChain();assert.equal(writes.length,1);
 pass('any correct-network wallet can execute the permissionless interval without token-owner authority');
 for(const patch of [{due:false},{pair:viem.zeroAddress}]){await reset();Object.assign(query.data,patch);await render();assert.equal(action().disabled,true);assert.equal(consent().disabled,true);}
 for(const status of ['loading','error']){await reset();query.status=status;await render();assert.equal(action().disabled,true);}await reset();query.error='stale';await render();assert.equal(action().disabled,true);
 pass('not-due, no pair, loading and failed snapshots cannot use stale data to burn');
 for(const patch of [{amount:101n},{lastBurn:101n},{nextBurn:28901n},{pair:B},{due:false}]){await reset();await click(consent());Object.assign(query.data,patch);await render();assert.equal(consent().checked,false);assert.equal(action().disabled,true);}
 pass('pool amount, period and pair changes revoke earlier burn confirmation');
 for(const patch of [{amount:101n},{lastBurn:101n},{pair:B},{due:false}]){await reset();fresh={...fresh,...patch};await click(consent());await click(action());await confirmChain();assert.equal(writes.length,0);assert(document.body.textContent.includes('已变化'));assert.equal(consent().checked,false);}
 pass('fresh pre-sign verification rejects stale amounts or periods before opening transaction signing');
 await reset();await click(consent());let release;deferred=new Promise(resolve=>release=resolve);await click(action());await confirmChain();assert.equal(writes.length,0);state.address=B;await render();state.address=A;await render();await React.act(async()=>{release();await pause();});assert.equal(writes.length,0);assert.equal(consent().checked,false);
 pass('a delayed chain check cannot revive a burn after wallet A-B-A switching');
 await reset();await click(consent());tx.busy=true;await render();assert.equal(action().disabled,true);assert.equal(consent().disabled,true);
 await reset();hash=undefined;await click(consent());await click(action());await confirmChain();assert.equal(refreshes,0);
 pass('pending or cancelled transactions cannot be reported as a completed pool burn');
 console.log(results.length+' pool burn admin DOM checks passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await React.act(async()=>root.unmount());dom.window.close();});
