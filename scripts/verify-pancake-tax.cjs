/* eslint-disable @typescript-eslint/no-require-imports -- Standalone isolated contract runner. */
// Uses real V2 Factory/Router/Pair bytecode on in-process Ganache. No public RPC.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),solc=require('solc');
process.env.UWS_USE_FALLBACK??='1';const ganache=require('ganache');
const {createPublicClient,createWalletClient,custom,parseUnits,parseEventLogs}=require('viem');
const root=path.resolve(__dirname,'..'),DEAD='0x000000000000000000000000000000000000dEaD',ZERO='0x0000000000000000000000000000000000000000';
const unit=(x,d=18)=>parseUnits(String(x),d),results=[];
const pass=name=>{results.push({name,valid:true});console.log('PASS '+name);};
function compile(){
 const quote='pragma solidity ^0.8.24; contract Quote { uint8 public immutable decimals; mapping(address=>uint256) public balanceOf; mapping(address=>mapping(address=>uint256)) public allowance; mapping(address=>bool) public blocked; bool public noReturn; function setNoReturn(bool v) external {noReturn=v;} event Transfer(address indexed from,address indexed to,uint256 value); constructor(uint8 d){decimals=d;} function mint(address to,uint256 v) external {balanceOf[to]+=v;} function blockRecipient(address a,bool b) external {blocked[a]=b;} function approve(address s,uint256 v) external returns(bool){allowance[msg.sender][s]=v;return true;} function transfer(address to,uint256 v) external returns(bool){require(!blocked[to],"blocked recipient");move(msg.sender,to,v);if(noReturn){assembly{return(0,0)}}return true;} function transferFrom(address f,address to,uint256 v) external returns(bool){require(allowance[f][msg.sender]>=v);allowance[f][msg.sender]-=v;move(f,to,v);if(noReturn){assembly{return(0,0)}}return true;} function move(address f,address to,uint256 v) private {require(balanceOf[f]>=v);balanceOf[f]-=v;balanceOf[to]+=v;emit Transfer(f,to,v);} }';
 const sources={'CaBiPancakeToken.sol':{content:fs.readFileSync(path.join(root,'contracts/CaBiPancakeToken.sol'),'utf8')},'Quote.sol':{content:quote}};
 const out=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
 const errors=(out.errors||[]).filter(e=>e.severity==='error');assert.equal(errors.length,0,errors.map(e=>e.formattedMessage).join('\n'));
 return(file,name)=>({abi:out.contracts[file][name].abi,bytecode:'0x'+out.contracts[file][name].evm.bytecode.object});
}
function dex(pkg,file){const a=require(pkg+'/build/'+file+'.json'),b=typeof a.bytecode==='string'?a.bytecode:a.evm.bytecode.object;return{abi:a.abi,bytecode:b.startsWith('0x')?b:'0x'+b};}
async function scenario(artifact,decimals){
 const provider=ganache.provider({logging:{quiet:true},wallet:{deterministic:true,totalAccounts:12},chain:{chainId:31337,hardfork:'shanghai'}});
 const chain={id:31337,name:'Isolated pancake tax',nativeCurrency:{name:'Test',symbol:'TEST',decimals:18},rpcUrls:{default:{http:[]}}};
 const client=createPublicClient({chain,transport:custom(provider),pollingInterval:10}),wallet=createWalletClient({chain,transport:custom(provider)});
 const [owner,buyer,recipient,first,second,nextFirst,nextSecond,newOwner,capHolder]=await wallet.getAddresses(),label=decimals+'-decimal quote';
 const deploy=async(a,args=[],account=owner)=>{const hash=await wallet.deployContract({...a,args,account,gas:12000000n});const r=await client.waitForTransactionReceipt({hash});assert.equal(r.status,'success','deploy');return{address:r.contractAddress,abi:a.abi};};
 const send=async(c,fn,args=[],account=owner,expected='success')=>{const hash=await wallet.writeContract({...c,functionName:fn,args,account,gas:12000000n});const r=await client.waitForTransactionReceipt({hash});assert.equal(r.status,expected,fn);return r;};
 const fail=(c,fn,args=[],account=owner)=>send(c,fn,args,account,'reverted'),read=(c,fn,args=[])=>client.readContract({...c,functionName:fn,args}),bal=(c,a)=>read(c,'balanceOf',[a]);
 const approve=(c,amount,account=owner)=>send(c,'approve',[router.address,amount],account);
 let router;
 try{
  const token=await deploy(artifact('CaBiPancakeToken.sol','CaBiPancakeToken'),[first,second,owner]),quote=await deploy(artifact('Quote.sol','Quote'),[decimals]);
  const factory=await deploy(dex('@uniswap/v2-core','UniswapV2Factory'),[owner]);router=await deploy(dex('@uniswap/v2-periphery','UniswapV2Router02'),[factory.address,quote.address]);
  await send(factory,'createPair',[token.address,quote.address]);const pair={address:await read(factory,'getPair',[token.address,quote.address]),abi:dex('@uniswap/v2-core','UniswapV2Pair').abi};
  const deadline=(await client.getBlock()).timestamp+86400n;
  assert.equal(await read(token,'name'),'CaBi');assert.equal(await read(token,'totalSupply'),unit(1000000000));assert.equal(await bal(token,owner),unit(1000000000));assert.equal(await read(token,'maxWalletAmount'),unit(200000));
  await send(token,'setMaxWalletExempt',[pair.address,true]);await send(quote,'mint',[owner,unit(100000,decimals)]);await send(quote,'mint',[buyer,unit(100000,decimals)]);await approve(token,unit(1000000));await approve(quote,unit(10000,decimals));
  await send(router,'addLiquidity',[token.address,quote.address,unit(1000000),unit(10000,decimals),0n,0n,owner,deadline]);assert.equal(await bal(token,DEAD),0n);
  await fail(token,'configureTrading',[router.address,quote.address,router.address]);await send(token,'configureTrading',[router.address,quote.address,pair.address]);await fail(token,'configureTrading',[router.address,quote.address,pair.address]);
  pass(label+': manual supply, initial untaxed liquidity, exact one-time router/pair configuration');
  const buy=async(gross,to=buyer)=>{await approve(quote,gross,buyer);return send(router,'swapExactTokensForTokensSupportingFeeOnTransferTokens',[gross,0n,[quote.address,token.address],to,deadline],buyer);};
  const sell=async(amount,account=buyer)=>{await approve(token,amount,account);return send(router,'swapExactTokensForTokensSupportingFeeOnTransferTokens',[amount,0n,[token.address,quote.address],account,deadline],account);};
  let taxBefore=await bal(token,token.address),buyerBefore=await bal(token,buyer);const bought=await buy(unit(1000,decimals));const buyEvent=parseEventLogs({abi:token.abi,eventName:'BuyTaxCollected',logs:bought.logs})[0].args;
  assert.equal(buyEvent.taxAmount,buyEvent.grossAmount*300n/10000n);assert.equal(await bal(token,buyer),buyerBefore+buyEvent.grossAmount-buyEvent.taxAmount);assert.equal(await bal(token,token.address),taxBefore+buyEvent.taxAmount);assert.equal(parseEventLogs({abi:token.abi,eventName:'TaxProcessed',logs:bought.logs}).length,0);assert.equal(await bal(quote,first),0n);
  pass(label+': standard V2 direct buy deducts 3% CaBi, no pair-lock swapback');
  const sellAmount=unit(100),deadBefore=await bal(token,DEAD),firstBefore=await bal(quote,first),secondBefore=await bal(quote,second);const sold=await sell(sellAmount);
  const processed=parseEventLogs({abi:token.abi,eventName:'TaxProcessed',logs:sold.logs});assert.equal(processed.length,1);const event=processed[0].args;
  assert.equal(event.amount1,event.usdtReceived*200n/300n);assert.equal(event.amount2,event.usdtReceived-event.amount1);assert.equal(await bal(quote,first),firstBefore+event.amount1);assert.equal(await bal(quote,second),secondBefore+event.amount2);assert.equal(await bal(token,DEAD),deadBefore+sellAmount*300n/10000n);assert.equal(await read(token,'allowance',[token.address,router.address]),0n);assert.equal(await read(token,'processing'),false);assert.equal(await read(token,'totalPendingDividends'),0n);
  pass(label+': sell auto-processes buy tax into USDT 2:1 and burns only user sell fee');
  const transferDead=await bal(token,DEAD),recipientBefore=await bal(token,recipient);await send(token,'transfer',[recipient,unit(10)],buyer);assert.equal(await bal(token,recipient),recipientBefore+unit(10));assert.equal(await bal(token,DEAD),transferDead);
  await approve(token,unit(100));const ownerSell=await sell(unit(100),owner);assert.equal(parseEventLogs({abi:token.abi,eventName:'SellFeeCharged',logs:ownerSell.logs})[0].args.burnedAmount,unit(3));
  pass(label+': wallet transfers are untaxed; even owner sells burn 3%');
  await send(token,'setSwapSettings',[unit(1),unit(1000),500n,false]);await buy(unit(1000,decimals));const pendingTax=await bal(token,token.address);assert(pendingTax>unit(1000));
  await fail(token,'autoProcessTax',[unit(1000)],buyer);await fail(token,'processTax',[unit(1001),1n,deadline],buyer);await fail(token,'processTax',[unit(1000),0n,deadline],buyer);
  const preview=await read(token,'previewTaxSwap',[unit(1000)]);await fail(token,'processTax',[unit(1000),preview[1],1n],buyer);
  const manual=await send(token,'processTax',[unit(1000),preview[1],deadline],buyer);assert.equal(parseEventLogs({abi:token.abi,eventName:'TaxProcessed',logs:manual.logs})[0].args.tokensSold,unit(1000));assert.equal(await bal(token,token.address),pendingTax-unit(1000));
  pass(label+': manual processing uses protected minOut/deadline and bounded token batch');
  for(const split of [[0n,300n],[300n,0n]]){await send(token,'setDividendRates',split);await buy(unit(10,decimals),owner);const microAmount=unit('0.001');const micro=await read(token,'previewTaxSwap',[microAmount]);if(micro[0]>0n){const tiny=await send(token,'processTax',[microAmount,micro[1],deadline],buyer);const round=parseEventLogs({abi:token.abi,eventName:'TaxProcessed',logs:tiny.logs})[0].args;assert.equal(round.amount1,round.usdtReceived*split[0]/300n);assert.equal(round.amount1+round.amount2,round.usdtReceived);}}
  pass(label+': 0/300 and 300/0 splits conserve every smallest USDT unit');
  await send(token,'setDividendReceivers',[nextFirst,nextSecond]);await send(token,'setDividendRates',[100n,200n]);await fail(token,'setDividendRates',[300n,1n]);
  const avail=await bal(token,token.address),batch=avail<unit(1000)?avail:unit(1000),quoteBefore=await read(token,'previewTaxSwap',[batch]);await send(quote,'blockRecipient',[nextFirst,true]);const deferred=await send(token,'processTax',[batch,quoteBefore[1],deadline],buyer);const taxed=parseEventLogs({abi:token.abi,eventName:'TaxProcessed',logs:deferred.logs})[0].args;
  assert.equal(taxed.amount1,taxed.usdtReceived*100n/300n);assert.equal(await read(token,'pendingDividends',[nextFirst]),taxed.amount1);assert.equal(await bal(quote,nextSecond),taxed.amount2);assert.equal(await read(token,'totalPendingDividends'),taxed.amount1);assert.equal(await bal(quote,token.address),taxed.amount1);
  await send(token,'setDividendReceivers',[first,second]);const oldCredit=await read(token,'pendingDividends',[nextFirst]);await send(token,'claimDividend',[recipient],nextFirst);assert.equal(await bal(quote,recipient),oldCredit);assert.equal(await read(token,'totalPendingDividends'),0n);
  pass(label+': payout failures retain original-address credit and can be claimed to another recipient');
  await send(token,'setSwapSettings',[unit(1),unit(1000),500n,true]);await buy(unit(1000,decimals),owner);const savedTax=await bal(token,token.address);await send(quote,'blockRecipient',[token.address,true]);const failSafe=await sell(unit(100));assert.equal(parseEventLogs({abi:token.abi,eventName:'TaxProcessingDeferred',logs:failSafe.logs}).length,1);assert.equal(await bal(token,token.address),savedTax);assert.equal(await read(token,'allowance',[token.address,router.address]),0n);assert.equal(await read(token,'processing'),false);await send(quote,'blockRecipient',[token.address,false]);
  pass(label+': swapback failure rolls back tax sale and never blocks ordinary sell');
  await send(token,'setSwapSettings',[unit(1),unit(1000),500n,false]);await send(token,'transfer',[capHolder,unit(200000)]);const capQuote=await bal(quote,buyer),capTax=await bal(token,token.address);await approve(quote,unit(1,decimals),buyer);await fail(router,'swapExactTokensForTokensSupportingFeeOnTransferTokens',[unit(1,decimals),0n,[quote.address,token.address],capHolder,deadline],buyer);assert.equal(await bal(quote,buyer),capQuote);assert.equal(await bal(token,token.address),capTax);
  await send(token,'setMaxWalletAmount',[unit(300000)]);await buy(unit(1,decimals),capHolder);await send(token,'setMaxWalletAmount',[unit(100000)]);await send(token,'transfer',[recipient,unit(1)],capHolder);await fail(token,'transfer',[capHolder,unit(1)]);assert((await bal(token,capHolder))>unit(100000));
  pass(label+': holding limit uses net buy amount, is adjustable, preserves outgoing transfers');
  await send(token,'setMaxWalletAmount',[unit(200000)]);await approve(token,unit(100));await approve(quote,unit(100,decimals));const deadBeforeLp=await bal(token,DEAD);await send(router,'addLiquidity',[token.address,quote.address,unit(100),unit(100,decimals),0n,0n,owner,deadline]);assert((await bal(token,DEAD))>deadBeforeLp);
  const lp=await bal(pair,owner);await send(pair,'approve',[router.address,lp/100n]);const removal=await send(router,'removeLiquidity',[token.address,quote.address,lp/100n,0n,0n,owner,deadline]);assert.equal(parseEventLogs({abi:token.abi,eventName:'BuyTaxCollected',logs:removal.logs}).length,1);
  pass(label+': direct LP additions are taxed as sells and removals as buys');
  await send(quote,'setNoReturn',[true]);await buy(unit(10,decimals),owner);const noReturnTax=await bal(token,token.address),noReturnBatch=noReturnTax<unit(1000)?noReturnTax:unit(1000),noReturnMin=await read(token,'previewTaxSwap',[noReturnBatch]);await send(token,'processTax',[noReturnBatch,noReturnMin[1],deadline],buyer);assert.equal(await read(token,'totalPendingDividends'),0n);pass(label+': no-return USDT transfers also distribute real proceeds');
  await send(token,'transferOwnership',[newOwner]);assert.equal(await read(token,'owner'),owner);await fail(token,'acceptOwnership',[],buyer);await send(token,'acceptOwnership',[],newOwner);assert.equal(await read(token,'owner'),newOwner);await fail(token,'setDividendRates',[200n,100n]);await send(token,'setDividendRates',[200n,100n],newOwner);assert.equal(await read(token,'pendingOwner'),ZERO);
  pass(label+': two-step owner handoff preserves balances and requires recipient acceptance');
 }finally{await provider.disconnect();}
}
async function main(){const artifact=compile();for(const decimals of [18,6])await scenario(artifact,decimals);fs.mkdirSync(path.join(root,'output','qa'),{recursive:true});fs.writeFileSync(path.join(root,'output','qa','pancake-tax-verification.json'),JSON.stringify({scope:'direct V2 swaps, isolated chain only',results},null,2));console.log(results.length+' pancake-tax checks passed.');}
main().catch(e=>{console.error(e);process.exitCode=1;});

