/* eslint-disable @typescript-eslint/no-require-imports -- Node-only scheduled transaction runner. */
// Does not load .env.local or any key file. Inject a dedicated, low-balance
// keeper wallet through the process environment; the token owner is not needed.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createPublicClient,createWalletClient,http,parseAbi,isAddress,getAddress,parseGwei,encodeFunctionData,zeroAddress}=require('viem');
const {privateKeyToAccount}=require('viem/accounts');
const {bsc,bscTestnet}=require('viem/chains');
const abi=parseAbi([
 'function POOL_BURN_INTERVAL() view returns(uint256)',
 'function POOL_BURN_BPS() view returns(uint256)',
 'function previewPoolBurn() view returns(uint256 amount,uint256 nextBurnAt,bool due)',
 'function tradingPair() view returns(address)',
 'function usdt() view returns(address)',
 'function burnPool() returns(uint256)',
 'event PoolBurned(address indexed pair,uint256 amount,uint256 poolBalanceBefore,uint256 executedAt)',
]);
function settings(env){
 const id=Number(env.NEXT_PUBLIC_CHAIN_ID);
 if(id!==56&&id!==97)throw new Error('Set NEXT_PUBLIC_CHAIN_ID to 56 or 97.');
 const token=env.NEXT_PUBLIC_TOKEN_ADDRESS?.trim(),quote=env.NEXT_PUBLIC_USDT_ADDRESS?.trim();
 if(!token||!isAddress(token,{strict:false})||token.toLowerCase()===zeroAddress||!quote||!isAddress(quote,{strict:false})||quote.toLowerCase()===zeroAddress)throw new Error('Configure valid token and quote asset addresses.');
 const rpc=env.POOL_BURN_RPC_URL||env.NEXT_PUBLIC_RPC_URL;
 if(!rpc)throw new Error('Configure POOL_BURN_RPC_URL (or NEXT_PUBLIC_RPC_URL).');
 const url=new URL(rpc);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Invalid RPC configuration.');
 const maxPrice=env.POOL_BURN_MAX_GAS_PRICE_GWEI||'5';if(!/^[0-9]+([.][0-9]{1,9})?$/.test(maxPrice)||parseGwei(maxPrice)<=0n)throw new Error('Invalid keeper gas price ceiling.');
 const directory=env.CABI_DATA_DIR?path.resolve(env.CABI_DATA_DIR):env.LOCALAPPDATA?path.join(env.LOCALAPPDATA,'CaBi','admin'):path.join(os.homedir(),'.local','share','cabi-admin');
 return{chain:id===56?bsc:bscTestnet,token:getAddress(token.toLowerCase()),quote:getAddress(quote.toLowerCase()),rpc,maxGasPrice:parseGwei(maxPrice),directory};
}
async function inspect(client,config){
 if(await client.getChainId()!==config.chain.id)throw new Error('RPC chain does not match configuration.');
 const blockNumber=await client.getBlockNumber({cacheTime:0});
 const code=await client.getCode({address:config.token,blockNumber});if(!code||code==='0x')throw new Error('Token contract is not deployed.');
 const names=['POOL_BURN_INTERVAL','POOL_BURN_BPS','previewPoolBurn','tradingPair','usdt'];
 const [interval,bps,preview,pair,quote]=await Promise.all(names.map(functionName=>client.readContract({address:config.token,abi,functionName,blockNumber})));
 if(interval!==28800n||bps!==100n||pair===zeroAddress||quote.toLowerCase()!==config.quote.toLowerCase())throw new Error('Pool burn interface, trading pair or quote asset does not match configuration.');
 const block=await client.getBlock({blockNumber});
 if(!Array.isArray(preview)||typeof preview[0]!=='bigint'||typeof preview[1]!=='bigint'||typeof preview[2]!=='boolean'||preview[0]<0n||preview[1]<=0n||preview[2]&&(preview[0]===0n||preview[1]>block.timestamp))throw new Error('Invalid pool burn preview.');
 return{amount:preview[0],nextBurnAt:preview[1],due:preview[2],timestamp:block.timestamp};
}
async function executeBurn(client,wallet,account,config,persist){
 const state=await inspect(client,config);if(!state.due)return{status:'not-due',...state};
 const gasPrice=await client.getGasPrice();if(gasPrice>config.maxGasPrice)throw new Error('Gas price exceeds the keeper ceiling.');
 const simulation=await client.simulateContract({address:config.token,abi,functionName:'burnPool',account,gasPrice});
 const hash=await wallet.writeContract({...simulation.request,gasPrice});
 persist(hash); // Save immediately. Timeout must be reconciled, never blindly resubmitted.
 return{status:'broadcast',hash,...state};
}
async function confirm(client,config,account,hash){
 if(await client.getChainId()!==config.chain.id)throw new Error('Pending transaction RPC chain mismatch.');
 const receipt=await client.waitForTransactionReceipt({hash,confirmations:2,timeout:60_000});
 const transaction=await client.getTransaction({hash:receipt.transactionHash});
 if(transaction.from.toLowerCase()!==account.address.toLowerCase()||transaction.to?.toLowerCase()!==config.token.toLowerCase()||transaction.input!==encodeFunctionData({abi,functionName:'burnPool'})||transaction.value!==0n)throw new Error('Pending transaction identity mismatch; inspect manually.');
 return{status:receipt.status==='success'?'confirmed':'reverted',hash:receipt.transactionHash};
}
async function main(){
 const args=process.argv.slice(2);if(args.some(a=>!['--execute','--dry-run'].includes(a))||args.includes('--execute')&&args.includes('--dry-run'))throw new Error('Use --dry-run (default) or --execute.');
 const config=settings(process.env),client=createPublicClient({chain:config.chain,transport:http(config.rpc,{timeout:15_000,retryCount:0}),cacheTime:0});
 const output=value=>console.log(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));
 if(!args.includes('--execute')){output({mode:'dry-run',...await inspect(client,config)});return;}
 const key=process.env.POOL_BURN_KEEPER_PRIVATE_KEY;
 if(!key||!/^0x[0-9a-fA-F]{64}$/.test(key))throw new Error('Inject POOL_BURN_KEEPER_PRIVATE_KEY for a dedicated keeper wallet.');
 const account=privateKeyToAccount(key),wallet=createWalletClient({account,chain:config.chain,transport:http(config.rpc,{timeout:15_000,retryCount:0})});
 fs.mkdirSync(config.directory,{recursive:true,mode:0o700});
 const base=path.join(config.directory,`pool-burn-${config.chain.id}-${config.token.toLowerCase()}-${account.address.toLowerCase()}`),pendingFile=base+'.json',lockFile=base+'.lock';
 let lock;try{lock=fs.openSync(lockFile,'wx',0o600);}catch{throw new Error('Another keeper run is active, or a stale lock requires manual inspection.');}
 fs.writeFileSync(lock,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
 try{
  if(fs.existsSync(pendingFile)){
   const pending=JSON.parse(fs.readFileSync(pendingFile,'utf8'));if(pending.chainId!==config.chain.id||pending.token!==config.token||pending.account!==account.address||!/^0x[0-9a-fA-F]{64}$/.test(pending.hash))throw new Error('Invalid pending keeper record; inspect manually.');
   const result=await confirm(client,config,account,pending.hash);fs.unlinkSync(pendingFile);output(result);return;
  }
  const result=await executeBurn(client,wallet,account,config,hash=>{fs.writeFileSync(pendingFile,JSON.stringify({chainId:config.chain.id,token:config.token,account:account.address,hash}),{mode:0o600,flag:'wx'});output({status:'pending',hash});});
  if(result.status==='broadcast'){const confirmed=await confirm(client,config,account,result.hash);fs.unlinkSync(pendingFile);output(confirmed);}else output(result);
 }finally{fs.closeSync(lock);fs.unlinkSync(lockFile);}
}
module.exports={settings,inspect,executeBurn,confirm};
if(require.main===module)main().catch(()=>{console.error('Pool burn keeper stopped. Check configuration, wallet gas balance and pending transaction record; secrets and RPC details are not printed.');process.exitCode=1;});
