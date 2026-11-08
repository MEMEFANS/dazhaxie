/* eslint-disable @typescript-eslint/no-require-imports -- Actual React DOM route-transition check. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),{JSDOM}=require('jsdom');
const ROOT=path.resolve(__dirname,'..'),A='0x1111111111111111111111111111111111111111';
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost:3000/'});global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;Object.defineProperty(global,'navigator',{configurable:true,value:dom.window.navigator});
const React=require('react'),{createRoot}=require('react-dom/client'),state={connected:true,address:A,chainId:56},store={state,hydrated:true,restored:true,connecting:false,connect(){},disconnect(){}};
const boundData={account:A,code:'ABCD2345',referrer:'0x3333333333333333333333333333333333333333',referrerCode:'BCDE3456',bound:true,root:false};
let pathname='/',queryMounts=0;
function load(file,replacements={}){const m={exports:{}},js=ts.transpileModule(fs.readFileSync(path.join(ROOT,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;vm.runInNewContext(js,{module:m,exports:m.exports,require:name=>Object.hasOwn(replacements,name)?replacements[name]:require(name),window:dom.window,document:dom.window.document,URL:dom.window.URL,URLSearchParams:dom.window.URLSearchParams,Error,console,setTimeout,clearTimeout});return m.exports;}
const Gate=load('src/components/dapp/referral-gate.tsx',{react:React,'next/navigation':{usePathname:()=>pathname},'next/image':{__esModule:true,default:()=>null},'lucide-react':{KeyRound:()=>null,Wallet:()=>null},'@/lib/chain-config':{chainConfig:{id:56}},'@/lib/store':{useStore:()=>store},'@/lib/referral-data':{parseInvitation:value=>typeof value==='string'&&/^[A-Z0-9]{8}$/i.test(value)?value.toUpperCase():undefined,useReferralData:address=>{const [snapshot]=React.useState(()=>{queryMounts++;return address?.toLowerCase()===A.toLowerCase()?{status:'ready',data:boundData}:{status:'loading'};});return{...snapshot,refresh:async()=>{}};},loginReferral:async()=>{},bindInvitation:async()=>boundData}}).ReferralGate;
function DAppShell({children}){return React.createElement(Gate,null,children);}
const RouteShell=load('src/components/dapp/route-shell.tsx',{react:React,'next/navigation':{usePathname:()=>pathname},'@/components/dapp/shell':{DAppShell}}).RouteShell;
const root=createRoot(document.getElementById('root')),pause=()=>new Promise(resolve=>setTimeout(resolve,5));
async function render(){await React.act(async()=>{root.render(React.createElement(RouteShell,null,React.createElement('main',{'data-business':'yes'},'业务页面')));await pause();});}
async function main(){
 await render();assert(document.querySelector('[data-business]'));assert.equal(queryMounts,1);
 pathname='/subscribe';await render();assert(document.querySelector('[data-business]'));assert.equal(document.querySelector('[data-referral-gate]'),null);assert.equal(queryMounts,1);
 pathname='/token';await render();assert(document.querySelector('[data-business]'));assert.equal(queryMounts,1);
 pathname='/';await render();assert(document.querySelector('[data-business]'));assert.equal(queryMounts,1);
 pathname='/team';await render();assert(document.querySelector('[data-business]'));assert.equal(queryMounts,1);
 const rootLayout=fs.readFileSync(path.join(ROOT,'src/app/layout.tsx'),'utf8'),home=fs.readFileSync(path.join(ROOT,'src/app/page.tsx'),'utf8'),dappLayout=fs.readFileSync(path.join(ROOT,'src/app/(site)/layout.tsx'),'utf8');assert(rootLayout.includes('<RouteShell>{children}</RouteShell>'));assert(home.includes('<Hero />'));assert(!home.includes('DAppShell'));assert(!dappLayout.includes('DAppShell'));
 for(const route of ['/community','/promotion','/exchange','/support']){pathname=route;await render();assert(document.querySelector('[data-business]'));assert.equal(queryMounts,1);}
 pathname='/admin/login';await render();assert.equal(document.querySelector('[data-referral-gate]'),null);assert.equal(queryMounts,1);
 console.log('PASS every short public route shares one authorized gate without remounts; admin stays separate.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await React.act(async()=>root.unmount());dom.window.close();});
