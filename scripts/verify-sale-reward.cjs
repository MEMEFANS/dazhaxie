/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node contract runner. */
// Synthetic accounts and in-process Ganache only. No external RPC or wallet.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),solc=require('solc');
process.env.UWS_USE_FALLBACK??='1';
const ganache=require('ganache');
const {createPublicClient,createWalletClient,custom,parseUnits,parseEventLogs,encodeFunctionData}=require('viem');
const root=path.resolve(__dirname,'..'),DEAD='0x000000000000000000000000000000000000dEaD',ZERO='0x0000000000000000000000000000000000000000';
const unit=(v,d=18)=>parseUnits(String(v),d),results=[];
const pass=name=>{results.push({name,valid:true});console.log('PASS '+name);};
function compile(){
 const sources={};
 for(const file of ['XBTToken.sol','XBTSale.sol','XBTRewardPool.sol','test/TestUSDT.sol']) sources[file]={content:fs.readFileSync(path.join(root,'contracts',file),'utf8')};
 sources['NoReturn.sol']={content:'pragma solidity ^0.8.24; contract NoReturn { uint8 public immutable decimals; mapping(address=>uint256) public balanceOf; mapping(address=>mapping(address=>uint256)) public allowance; address public callback; bytes public payload; bool public blocked; constructor(uint8 d){decimals=d;} function mint(address a,uint256 v) external {balanceOf[a]+=v;} function approve(address s,uint256 v) external {allowance[msg.sender][s]=v;} function setCallback(address t,bytes calldata d) external {callback=t;payload=d;blocked=false;} function transfer(address t,uint256 v) external {move(msg.sender,t,v);} function transferFrom(address f,address t,uint256 v) external {require(allowance[f][msg.sender]>=v);allowance[f][msg.sender]-=v;move(f,t,v);if(callback!=address(0)){(bool ok,)=callback.call(payload);blocked=!ok;}} function move(address f,address t,uint256 v) private {require(balanceOf[f]>=v);balanceOf[f]-=v;balanceOf[t]+=v;} }'};
 const out=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
 const errors=(out.errors||[]).filter(e=>e.severity==='error');assert.equal(errors.length,0,errors.map(e=>e.formattedMessage).join('\n'));
 return(file,name)=>({abi:out.contracts[file][name].abi,bytecode:'0x'+out.contracts[file][name].evm.bytecode.object});
}
async function scenario(artifact,decimals,noReturn){
 const label=decimals+'-decimal '+(noReturn?'no-return USDT':'standard USDT');
 const provider=ganache.provider({logging:{quiet:true},wallet:{deterministic:true,totalAccounts:12},chain:{chainId:31337,hardfork:'shanghai'}});
 const chain={id:31337,name:'Isolated sale test',nativeCurrency:{name:'Test',symbol:'TEST',decimals:18},rpcUrls:{default:{http:[]}}};
 const client=createPublicClient({chain,transport:custom(provider),pollingInterval:10}),wallet=createWalletClient({chain,transport:custom(provider)});
 const [owner,alice,bob,carol,david,vault,funds,other,edge,zeroPay]=await wallet.getAddresses();
 const deploy=async(a,args=[])=>{const hash=await wallet.deployContract({...a,args,account:owner,gas:10000000n});const r=await client.waitForTransactionReceipt({hash});assert.equal(r.status,'success','deployment');return{address:r.contractAddress,abi:a.abi};};
 const send=async(c,fn,args=[],account=owner,expected='success')=>{const hash=await wallet.writeContract({...c,functionName:fn,args,account,gas:10000000n});const r=await client.waitForTransactionReceipt({hash});assert.equal(r.status,expected,fn);return r;};
 const fail=(c,fn,args=[],account=owner)=>send(c,fn,args,account,'reverted'),read=(c,fn,args=[])=>client.readContract({...c,functionName:fn,args}),balance=(c,a)=>read(c,'balanceOf',[a]);
 try{
  const token=await deploy(artifact('XBTToken.sol','XBTToken'));
  const quote=await deploy(noReturn?artifact('NoReturn.sol','NoReturn'):artifact('test/TestUSDT.sol','TestUSDT'),[decimals]);
  const sale=await deploy(artifact('XBTSale.sol','XBTSale'),[quote.address,token.address,vault,funds]);
  const reward=await deploy(artifact('XBTRewardPool.sol','XBTRewardPool'),[token.address,quote.address,vault]);
  assert.equal(await read(sale,'UNIT_PRICE'),unit(50,decimals));assert.equal(await read(reward,'UNIT_PRICE'),unit(50,decimals));
  for(const target of [sale.address,reward.address,vault]) await send(token,'setMaxWalletExempt',[target,true]);
  for(const user of [alice,bob,carol,david,other,edge,zeroPay]){await send(quote,'mint',[user,unit(1000,decimals)]);for(const spender of [sale.address,reward.address]) await send(quote,'approve',[spender,unit(1000,decimals)],user);}
  pass(label+': correct dynamic USDT pricing');
  await fail(sale,'subscribe',[1n,ZERO],alice);assert.equal(await balance(quote,funds),0n);assert.equal(await read(sale,'globalSold'),0n);assert.equal(await read(sale,'reservedTokens'),0n);
  await send(token,'transfer',[sale.address,unit(35000)]);await send(sale,'subscribe',[1n,ZERO],alice);assert.equal(await balance(quote,funds),unit(50,decimals));
  await fail(sale,'subscribe',[1n,ZERO],bob);assert.equal(await balance(quote,funds),unit(50,decimals));
  pass(label+': underfunded purchases roll back before charging USDT');
  await send(token,'transfer',[sale.address,unit(350000)]);await send(sale,'subscribe',[2n,alice],bob);
  const sub=await send(sale,'subscribe',[1n,alice],carol);assert.equal(parseEventLogs({abi:sale.abi,eventName:'Subscribed',logs:sub.logs}).length,1);
  assert.equal(await read(sale,'directShares',[alice]),3n);assert.equal(await read(sale,'rewardShares',[alice]),1n);assert.equal(await read(sale,'reservedTokens'),unit(175000));
  await fail(sale,'subscribe',[1n,alice],bob);await fail(sale,'subscribe',[1n,david],david);
  await send(sale,'subscribe',[1n,bob],alice);assert.equal(await read(sale,'referrer',[alice]),ZERO);
  pass(label+': two-share cap, real referral reward reservation, first-choice referral immutability');
  const cycle=await deploy(artifact('XBTSale.sol','XBTSale'),[quote.address,token.address,vault,funds]);await send(token,'setMaxWalletExempt',[cycle.address,true]);await send(token,'transfer',[cycle.address,unit(70000)]);
  for(const u of [other,edge])await send(quote,'approve',[cycle.address,unit(100,decimals)],u);
  await send(cycle,'subscribe',[1n,edge],other);await fail(cycle,'subscribe',[1n,other],edge);assert.equal(await read(cycle,'purchased',[edge]),0n);
  pass(label+': circular and self referrals rejected atomically');
  const before=await read(sale,'reservedTokens');await fail(sale,'batchCreditTeamReward',[[david],[100n]]);assert.equal(await read(sale,'reservedTokens'),before);assert.equal(await read(sale,'rewardShares',[david]),0n);
  await send(sale,'batchCreditTeamReward',[[david],[1n]]);await fail(sale,'batchCreditTeamReward',[[ZERO],[1n]]);await fail(sale,'finalize');await send(sale,'setSubscribeLocked',[true]);
  const reserved=await read(sale,'reservedTokens'),unused=await read(sale,'unusedBalance'),burned=await balance(token,DEAD);
  const fin=await send(sale,'finalize');assert.equal(parseEventLogs({abi:sale.abi,eventName:'Finalized',logs:fin.logs})[0].args.burned,unused);assert.equal(await balance(token,DEAD),burned+unused);assert.equal(await balance(token,sale.address),reserved);
  await fail(sale,'setSubscribeLocked',[false]);await fail(sale,'subscribe',[1n,ZERO],david);await fail(sale,'batchCreditTeamReward',[[david],[1n]]);
  pass(label+': finalize reserves all obligations and burns only surplus');
  const entitlement=await read(sale,'entitlementOf',[alice]),usdtBefore=await balance(quote,alice),vaultBefore=await balance(quote,vault);
  await send(token,'setMaxWalletAmount',[unit(1000)]);await fail(sale,'claim',[],alice);assert.equal(await read(sale,'reservedTokens'),reserved);assert.equal(await read(sale,'claimed',[alice]),0n);assert.equal(await balance(quote,alice),usdtBefore);await send(token,'setMaxWalletAmount',[unit(200000)]);
  await fail(sale,'claimChecked',[vault,unit(30,decimals)],alice);assert.equal(await balance(quote,alice),usdtBefore);assert.equal(await read(sale,'claimed',[alice]),0n);
  await send(sale,'setLpReceiver',[other]);await fail(sale,'claimChecked',[vault,unit(45,decimals)],alice);assert.equal(await read(sale,'reservedTokens'),reserved);assert.equal(await balance(quote,alice),usdtBefore);await send(sale,'setLpReceiver',[vault]);
  const claim=await send(sale,'claimChecked',[vault,unit(45,decimals)],alice);assert.equal(await balance(token,alice),entitlement*70n/100n);assert.equal(await balance(quote,alice),usdtBefore-unit(45,decimals));assert.equal(await balance(quote,vault),vaultBefore+unit(45,decimals));assert.equal(await read(sale,'reservedTokens'),reserved-entitlement);assert.equal(parseEventLogs({abi:sale.abi,eventName:'Claimed',logs:claim.logs})[0].args.claimable,entitlement*70n/100n);
  await fail(sale,'claim',[],alice);await send(sale,'claim',[],david);pass(label+': post-finalize claims and exact 70/30 split remain usable');
  await send(token,'approve',[reward.address,unit(200000)]);await send(reward,'deposit',[unit(200000)]);
  await fail(reward,'batchSetClaimable',[[bob],[unit(200001)],false]);assert.equal(await read(reward,'totalAllocated'),0n);
  await send(reward,'batchSetClaimable',[[bob,carol],[unit(35000),unit(35000)],false]);await send(reward,'batchSetClaimable',[[bob],[unit(35000)],true]);assert.equal(await read(reward,'totalAllocated'),unit(105000));
  await fail(reward,'withdrawUnused',[unit(95001)]);await send(reward,'withdrawUnused',[unit(95000)]);assert.equal(await read(reward,'unusedBalance'),0n);
  pass(label+': over-allocation and withdrawal of allocated funds rejected');
  const deadBefore=await balance(token,DEAD),m0=await send(reward,'claim',[0],bob);assert.equal((await read(reward,'claims',[bob]))[2],unit(35000));assert.equal(await balance(token,DEAD),deadBefore+unit(35000));assert.equal(parseEventLogs({abi:reward.abi,eventName:'Claimed',logs:m0.logs})[0].args.payout,unit(35000));
  await fail(reward,'claim',[1],bob);await fail(reward,'batchSetClaimable',[[bob],[unit(1)],false]);
  const carolBefore=await balance(quote,carol);await send(quote,'approve',[reward.address,0n],carol);await fail(reward,'claim',[1],carol);assert.equal((await read(reward,'claims',[carol]))[0],false);assert.equal(await read(reward,'claimable',[carol]),unit(35000));assert.equal(await read(reward,'totalAllocated'),unit(35000));await send(quote,'approve',[reward.address,unit(1000,decimals)],carol);
  await send(reward,'setLpUsdtRatio',[31n]);await fail(reward,'claimChecked',[1,50n,70n,30n,vault,true],carol);assert.equal(await balance(quote,carol),carolBefore);assert.equal((await read(reward,'claims',[carol]))[0],false);await send(reward,'setLpUsdtRatio',[30n]);
  await send(reward,'setLpReceiver',[other]);await fail(reward,'claimChecked',[1,50n,70n,30n,vault,true],carol);assert.equal(await read(reward,'claimable',[carol]),unit(35000));assert.equal(await balance(quote,carol),carolBefore);await send(reward,'setLpReceiver',[vault]);
  await send(reward,'setBurnRemainder',[false]);await fail(reward,'claimChecked',[1,50n,70n,30n,vault,true],carol);await send(reward,'setBurnRemainder',[true]);
  const m1=await send(reward,'claimChecked',[1,50n,70n,30n,vault,true],carol);assert.equal(await balance(quote,carol),carolBefore-unit(15,decimals));const e=parseEventLogs({abi:reward.abi,eventName:'Claimed',logs:m1.logs})[0].args;assert.equal(e.payout,unit(24500));assert.equal(e.lpTokens,unit(10500));assert.equal(e.usdtPaid,unit(15,decimals));assert.equal(await read(reward,'totalAllocated'),0n);
  pass(label+': checked claims reject stale fees, policy, or vault without charging assets');
  pass(label+': 50% burn/70% vault modes, receipt events, one-time selection');
  await send(token,'approve',[reward.address,unit(105000)]);await send(reward,'deposit',[unit(105000)]);await send(reward,'batchSetClaimable',[[other,edge,zeroPay],[unit(35000),unit(35000),unit(35000)],false]);
  await send(reward,'setBurnRemainder',[false]);await send(reward,'setDirectRatio',[100n]);await send(reward,'claim',[0],other);assert.equal((await read(reward,'claims',[other]))[2],unit(35000));
  await send(reward,'setLpRatio',[100n]);await send(reward,'setLpUsdtRatio',[0n]);const zeroFee=await balance(quote,edge);await send(reward,'claim',[1],edge);assert.equal((await read(reward,'claims',[edge]))[2],unit(35000));assert.equal(await balance(quote,edge),zeroFee);
  await send(reward,'setDirectRatio',[0n]);await send(reward,'claim',[0],zeroPay);assert.equal((await read(reward,'claims',[zeroPay]))[2],0n);assert.equal(await read(reward,'unusedBalance'),unit(35000));
  for(const fn of ['setDirectRatio','setLpRatio','setLpUsdtRatio'])await fail(reward,fn,[101n]);pass(label+': 0/100 boundary ratios conserve funds and retained remainder is unused');
  await fail(sale,'setLpReceiver',[sale.address]);await fail(reward,'setLpReceiver',[reward.address]);await fail(reward,'withdrawUnused',[1n],alice);await fail(sale,'setSubscribeLocked',[true],alice);pass(label+': owner authorization and self-vault guards');
  if(noReturn){
   const callback=await deploy(artifact('XBTSale.sol','XBTSale'),[quote.address,token.address,vault,funds]);await send(token,'setMaxWalletExempt',[callback.address,true]);await send(token,'transfer',[callback.address,unit(70000)]);await send(quote,'approve',[callback.address,unit(100,decimals)],david);await send(quote,'setCallback',[callback.address,encodeFunctionData({abi:callback.abi,functionName:'subscribe',args:[1n,ZERO]})]);await send(callback,'subscribe',[1n,ZERO],david);assert.equal(await read(quote,'blocked'),true);assert.equal(await read(callback,'globalSold'),1n);await send(quote,'setCallback',[ZERO,'0x']);pass(label+': no-return USDT works and callback reentry is blocked');
   const hookAsset=await deploy(artifact('NoReturn.sol','NoReturn'),[18]);const hookPool=await deploy(artifact('XBTRewardPool.sol','XBTRewardPool'),[hookAsset.address,quote.address,vault]);await send(hookAsset,'mint',[owner,unit(1000)]);await send(hookAsset,'approve',[hookPool.address,unit(1000)]);await send(hookPool,'deposit',[unit(500)]);await send(hookPool,'batchSetClaimable',[[hookAsset.address],[unit(100)],false]);await send(hookAsset,'setCallback',[hookPool.address,encodeFunctionData({abi:hookPool.abi,functionName:'claim',args:[0]})]);await send(hookPool,'deposit',[unit(100)]);assert.equal(await read(hookAsset,'blocked'),true);assert.equal(await read(hookPool,'claimable',[hookAsset.address]),unit(100));assert.equal(await read(hookPool,'poolBalance'),unit(600));pass(label+': no-return CaBi deposit callback cannot consume existing allocations');
  }
 }finally{await provider.disconnect();}
}
async function main(){const artifact=compile();for(const decimals of [18,6])for(const noReturn of [false,true])await scenario(artifact,decimals,noReturn);fs.mkdirSync(path.join(root,'output','qa'),{recursive:true});fs.writeFileSync(path.join(root,'output','qa','sale-reward-verification.json'),JSON.stringify({scope:'isolated sale/reward execution; no public transactions',results},null,2));console.log(results.length+' sale/reward contract checks passed.');}
main().catch(error=>{console.error(error);process.exitCode=1;});

