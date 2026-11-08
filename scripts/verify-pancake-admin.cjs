/* eslint-disable @typescript-eslint/no-require-imports -- Isolated React DOM verification. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const viem=require('viem');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost:3000/admin/contracts'});
global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
Object.defineProperty(global,'navigator',{configurable:true,value:dom.window.navigator});
const React=require('react');
const {createRoot}=require('react-dom/client');
const A='0x1111111111111111111111111111111111111111',B='0x2222222222222222222222222222222222222222',TOKEN='0x3333333333333333333333333333333333333333',FIRST='0x4444444444444444444444444444444444444444',SECOND='0x5555555555555555555555555555555555555555',NEW_FIRST='0x6666666666666666666666666666666666666666',NEW_SECOND='0x7777777777777777777777777777777777777777';
const store={state:{connected:true,address:A,chainId:56},connect(){throw new Error('Unexpected wallet connect');}};
const d={owner:A,pendingOwner:viem.zeroAddress,bound:true,liquid:true,pair:B,distributionReceiver:FIRST,buybackPool:SECOND,threshold:viem.parseUnits('2500',18),maxAmount:viem.parseUnits('7500',18),slippageBps:100n,automatic:false,accruedTokens:0n,pendingTotal:0n,pendingAmount:0n,usdtDecimals:18};
const t={maxWalletAmount:viem.parseUnits('300000',18),decimals:18,totalSupply:viem.parseUnits('1000000000',18)};
const writes=[];
const controller={busy:false,transaction:null,run:async request=>{writes.push(request);return '0x'+'1'.repeat(64);},resume:async()=>undefined,clear(){}};
const wrappers=({children})=>React.createElement('section',null,children);
const ui={Badge:wrappers,Card:wrappers,PageStack:wrappers,PageHeader:({title,desc})=>React.createElement('header',null,React.createElement('h1',null,title),React.createElement('p',null,desc)),ContractRow:({address})=>React.createElement('p',null,address),DataRow:({label,value})=>React.createElement('p',null,label+': ',value)};
const filename=path.resolve(__dirname,'../src/components/admin/pancake-tax-settings.tsx');
const runtimeModule={exports:{}};
const query={status:'ready',data:d,refresh(){}};
const tokenQuery={status:'ready',data:t,refresh(){}};
const replacements={react:React,viem,'./chain-confirm':{ChainConfirmModal:({open,onCancel,onConfirm})=>open?React.createElement('div',null,React.createElement('button',{'aria-label':'取消链上操作',onClick:onCancel},'取消'),React.createElement('button',{'aria-label':'确认执行链上操作',onClick:onConfirm},'确认')):null},'./pool-burn-settings':{PoolBurnSettings:()=>null},'@/lib/store':{useStore:()=>store},'@/lib/chain-config':{chainConfig:{id:56,shortName:'BSC'},contracts:{token:TOKEN},getExplorerAddressUrl:address=>'http://explorer.fixture/'+address},'@/lib/chain-data':{tokenAbi:[],useTokenData:()=>tokenQuery},'@/lib/pancake-data':{pancakeClient:{readContract(){throw new Error('Unexpected RPC access');}},pancakeTaxAbi:[],usePancakeTaxData:()=>query},'@/lib/contract-transactions':{TransactionFeedback:()=>null,useContractTransaction:()=>controller},'@/lib/amounts':{formatAssetAmount:(amount,decimals)=>viem.formatUnits(amount,decimals)},'@/lib/constants':{PAYOUT_SPLIT_BPS:5000},'@/components/dapp/ui':ui,'@/components/dapp/service-query-notice':{ServiceQueryNotice:()=>null}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{module:runtimeModule,exports:runtimeModule.exports,require:name=>Object.hasOwn(replacements,name)?replacements[name]:require(name),window:dom.window,Event:dom.window.Event,setTimeout,clearTimeout,console},{filename});
const Component=runtimeModule.exports.default,root=createRoot(document.getElementById('root'));
let checks=0;
function pass(name){checks++;console.log('PASS '+name);}
const pause=()=>new Promise(resolve=>setTimeout(resolve,5));
async function render(){await React.act(async()=>{root.render(React.createElement(Component));await pause();});}
function aria(label){const value=document.querySelector('[aria-label="'+label+'"]');assert(value,'Missing input '+label);return value;}
function labelled(text){const label=Array.from(document.querySelectorAll('label')).find(el=>el.textContent.includes(text));assert(label,'Missing label '+text);const input=label.querySelector('input');assert(input,'Missing input in label '+text);return input;}
function button(text){const found=Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()===text);assert(found,'Missing button '+text);return found;}
async function click(element){await React.act(async()=>{element.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));await pause();});}
async function clickAria(label){const element=document.querySelector('[aria-label="'+label+'"]');assert(element,'Missing control '+label);await click(element);}
async function enter(input,value){await React.act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await pause();});}
function fields(){return {distribution:aria('新的分配地址'),buyback:aria('新的回购池地址'),limit:aria('新的持仓上限'),threshold:labelled('触发阈值'),maximum:labelled('单批上限'),slippage:labelled('最大滑点'),automatic:labelled('开启后续卖出阶段自动处理')};}
const mutatingButtons=['确认两个收款地址','确认持仓上限','确认兑换参数'];
function expectBlankDisabled(){const f=fields();for(const key of ['distribution','buyback','limit','threshold','maximum','slippage']){assert.equal(f[key].value,'',key+' should be blank');assert.equal(f[key].disabled,true,key+' should require explicit load');}assert.equal(f.automatic.checked,false);assert.equal(f.automatic.disabled,true);for(const text of mutatingButtons)assert.equal(button(text).disabled,true,text+' should require explicit load');}
function expectValues(values){const f=fields();for(const [key,value] of Object.entries(values)){assert.equal(key==='automatic'?f[key].checked:f[key].value,value,key+' differs');}}
async function main(){
 await render();expectBlankDisabled();assert.equal(writes.length,0);pass('ready owner sees blank disabled management forms until explicit chain load');
 await click(button('载入当前链上数值到表单'));expectValues({distribution:FIRST,buyback:SECOND,limit:'300000',threshold:'2500',maximum:'7500',slippage:'1',automatic:false});for(const text of mutatingButtons)assert.equal(button(text).disabled,false);pass('explicit load uses on-chain fixed 50/50 receivers, thresholds, slippage and disabled auto setting');
 await enter(fields().threshold,'2600');await enter(fields().limit,'320000');expectValues({threshold:'2600',limit:'320000'});
 Object.assign(d,{threshold:viem.parseUnits('4000',18),maxAmount:viem.parseUnits('12000',18),slippageBps:200n,automatic:true,distributionReceiver:NEW_FIRST,buybackPool:NEW_SECOND});t.maxWalletAmount=viem.parseUnits('500000',18);await render();expectValues({threshold:'2600',maximum:'7500',slippage:'1',automatic:false,distribution:FIRST,buyback:SECOND,limit:'320000'});pass('subsequent chain polling preserves edited drafts and initial loaded settings');
 await click(button('载入当前链上数值到表单'));expectValues({threshold:'4000',maximum:'12000',slippage:'2',automatic:true,distribution:NEW_FIRST,buyback:NEW_SECOND,limit:'500000'});pass('explicit reload replaces drafts with latest real chain values');
 store.state={...store.state,address:B};await render();expectBlankDisabled();await click(button('载入当前链上数值到表单'));for(const text of mutatingButtons){assert.equal(button(text).disabled,true,'nonowner '+text);await click(button(text));}assert.equal(writes.length,0);pass('account switch discards drafts and nonowner cannot submit loaded settings');
 store.state={...store.state,address:A,chainId:97};await render();expectBlankDisabled();await click(button('载入当前链上数值到表单'));for(const text of mutatingButtons)assert.equal(button(text).disabled,true);assert.equal(writes.length,0);pass('wrong-network identity has fresh drafts and cannot submit');
 store.state={...store.state,chainId:56};await render();expectBlankDisabled();await click(button('载入当前链上数值到表单'));await click(button('确认两个收款地址'));assert.equal(writes.length,0);assert(document.querySelector('[aria-label="确认执行链上操作"]'),'confirmation modal should open');await clickAria('取消链上操作');assert.equal(writes.length,0);assert.equal(document.querySelector('[aria-label="确认执行链上操作"]'),null);await click(button('确认两个收款地址'));await clickAria('确认执行链上操作');assert.equal(writes.length,1);assert.equal(writes[0].functionName,'setTaxReceivers');assert.equal(writes[0].args[0],NEW_FIRST);assert.equal(writes[0].args[1],NEW_SECOND);assert.equal(Array.from(document.querySelectorAll('button')).some(el=>el.textContent.trim()==='确认分配比例'),false);pass('confirmation modal gates the receiver write; no ratio control remains and confirm submits both addresses');
 store.state={...store.state,connected:false};await render();expectBlankDisabled();assert.equal(writes.length,1);pass('disconnect clears loaded form state and disables mutations');
 store.state={...store.state,connected:true};t.walletLimitEnabled=false;t.maxWalletAmount=t.totalSupply;await render();assert(document.body.textContent.includes('永久不限制'));assert.equal(document.querySelector('[aria-label="新的持仓上限"]'),null);assert.equal(document.querySelector('[aria-label="持仓豁免钱包或资金池"]'),null);assert.equal(writes.length,1);pass('新版无上限代币展示永久不限制，不提供上限或豁免编辑入口');
 console.log(checks+' isolated Pancake administration UI checks passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await React.act(async()=>root.unmount());dom.window.close();});

