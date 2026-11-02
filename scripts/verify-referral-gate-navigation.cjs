/* eslint-disable @typescript-eslint/no-require-imports -- Actual React DOM route-transition check. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),{JSDOM}=require('jsdom');
const ROOT=path.resolve(__dirname,'..'),A='0x1111111111111111111111111111111111111111',B='0x2222222222222222222222222222222222222222';
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost:3000/'});global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;Object.defineProperty(global,'navigator',{configurable:true,value:dom.window.navigator});
const React=require('react'),{createRoot}=require('react-dom/client'),state={connected:true,address:A,chainId:56},store={state,hydrated:true,restored:true,connecting:false,connect(){},disconnect(){}};
const boundData={account:A,code:'ABCD2345',referrer:'0x3333333333333333333333333333333333333333',referrerCode:'BCDE3456',bound:true,root:false};
let pathname='/',queryMounts=0;
function load(file,replacements={}){const m={exports:{}},js=ts.transpileModule(fs.readFileSync(path.join(ROOT,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;vm.runInNewContext(js,{module:m,exports:m.exports,require:name=>Object.hasOwn(replacements,name)?replacements[name]:require(name),window:dom.window,document:dom.window.document,URL:dom.window.URL,URLSearchParams:dom.window.URLSearchParams,Error,console,setTimeout,clearTimeout});return m.exports;}
const Gate=load('src/components/dapp/referral-gate.tsx',{react:React,'next/navigation':{usePathname:()=>pathname},'next/image':{__esModule:true,default:()=>null},'lucide-react':{KeyRound:()=>null,Wallet:()=>null},'@/lib/store':{useStore:()=>store},'@/lib/referral-data':{parseInvitation:value=>typeof value==='string'&&/^[A-Z0-9]{8}$/i.test(value)?value.toUpperCase():undefined,useReferralData:()=>{const [snapshot]=React.useState(()=>({status:queryMounts++===0?'ready':'loading',data:queryMounts===1?boundData:undefined}));return{...snapshot,refresh:async()=>{}};},loginReferral:async()=>{},bindInvitation:async()=>boundData}}).ReferralGate;
const root=createRoot(document.getElementById('root')),pause=()=>new Promise(resolve=>setTimeout(resolve,5));
async function render(){await React.act(async()=>{root.render(React.createElement(Gate,null,React.createElement('main',{'data-business':'yes'},'业务页面')));await pause();});}
async function main(){
 await render();assert(document.querySelector('[data-business]'));assert.equal(queryMounts,1);
 pathname='/dapp/subscribe';await render();assert(document.querySelector('[data-business]'));assert.equal(document.querySelector('[data-referral-gate]'),null);assert.equal(queryMounts,1);
 pathname='/dapp/token';await render();assert(document.querySelector('[data-business]'));assert.equal(queryMounts,1);
 state.address=B;await render();assert.equal(document.querySelector('[data-business]'),null);assert.equal(document.querySelector('[data-referral-gate="checking"]')?.getAttribute('aria-busy'),'true');assert.equal(document.querySelector('[data-referral-gate="locked"]'),null);
 console.log('PASS route changes preserve an authorized gate; a new wallet stays locked until its server state loads.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await React.act(async()=>root.unmount());dom.window.close();});
