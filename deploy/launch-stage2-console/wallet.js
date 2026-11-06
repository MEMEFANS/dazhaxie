/* global window, document, localStorage, fetch, Event */
'use strict';
const $ = id => document.getElementById(id);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const rpcHex = value => '0x' + BigInt(value).toString(16);
const wallets = [];
let manifest, provider, account, state = {}, record = {}, pending, storageKey, busy = false;
function message(text, tone = '') { $('message').textContent = text; $('message').dataset.tone = tone; }
function errorText(error) { return error?.shortMessage || error?.message || '钱包操作未完成'; }
function addWallet(name, candidate) {
  if (!candidate?.request || wallets.some(item => item.provider === candidate)) return;
  if (!wallets.length) $('wallet').replaceChildren();
  const option = document.createElement('option'); option.value = String(wallets.length); option.textContent = name;
  wallets.push({ name, provider: candidate }); $('wallet').appendChild(option); render();
}
window.addEventListener('eip6963:announceProvider', event => addWallet(event.detail?.info?.name || '浏览器钱包', event.detail?.provider));
window.dispatchEvent(new Event('eip6963:requestProvider'));
function discover() {
  for (const candidate of window.ethereum?.providers || (window.ethereum ? [window.ethereum] : [])) addWallet(candidate.isOkxWallet ? 'OKX Wallet' : candidate.isMetaMask ? 'MetaMask' : '浏览器钱包', candidate);
  addWallet('OKX Wallet', window.okxwallet);
  if (!wallets.length) { $('wallet').replaceChildren(); const option = document.createElement('option'); option.textContent = '请在装有钱包的 Chrome／Edge 打开'; $('wallet').appendChild(option); }
}
async function api(route, body) {
  const response = await fetch('/api/' + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  const result = await response.json();
  if (!response.ok || (result.error && !result.reverted)) throw new Error(result.error || '链上状态暂时无法更新');
  return result;
}
async function rpc(method, params = []) {
  if (!provider) throw new Error('请先连接插件钱包');
  return provider.request({ method, params });
}
async function context() {
  const [accounts, chainId] = await Promise.all([rpc('eth_accounts'), rpc('eth_chainId')]);
  account = accounts[0]; $('account').textContent = account || '尚未连接';
  $('switch').hidden = BigInt(chainId) === BigInt(manifest.chainId);
  if (!$('switch').hidden) throw new Error('请将插件钱包切换到 BSC 主网');
  if (!same(account, manifest.owner)) throw new Error('请切换到管理员钱包：' + manifest.owner);
}
function completed(kind) {
  return ({ schedule: state.scheduleSet, approveToken: state.tokenApproved, approveUsdt: state.usdtApproved, open: state.liquidityEnabled, seed: state.seeded })[kind] === true;
}
function cachePending(value) {
  pending = value;
  try { if (value) localStorage.setItem(storageKey, JSON.stringify(value)); else localStorage.removeItem(storageKey); } catch { /* The server record remains available. */ }
  render();
}
function render() {
  const ready = Boolean(manifest && provider && account && !busy && !pending);
  $('connect').disabled = !manifest || !wallets.length || busy;
  $('refresh').disabled = !manifest || busy;
  $('wallet').disabled = busy;
  $('check').disabled = busy;
  for (const [index, kind] of (manifest?.kinds || []).entries()) {
    const article = document.querySelector(`[data-kind="${kind}"]`), done = completed(kind), status = article.querySelector('.status');
    status.textContent = done ? '已完成' : pending?.kind === kind ? '待核对' : '待操作'; status.className = 'status' + (done ? ' done' : '');
    if (kind === 'approveToken') article.querySelector('button').textContent = BigInt(state.tokenAllowance || 0) > 0n && BigInt(state.tokenAllowance) !== BigInt(state.tokenAmount) ? '撤销多余授权' : '授权 CaBi';
    article.querySelector('button').disabled = !ready || done || manifest.kinds.slice(0, index).some(prior => !completed(prior));
  }
}
async function refresh() {
  const next = await api('state'); state = next.state; record = next.record;
  $('balances').textContent = `管理员余额：${state.ownerTokenBalanceFormatted} CaBi、${state.ownerUsdtBalanceFormatted} USDT；新池储备：${state.poolBalanceFormatted} CaBi；预估初始 LP：${(Number(state.estimatedLp) / 1e18).toLocaleString('zh-CN', { maximumFractionDigits: 6 })} 枚。`;
  const tokenAllowance = BigInt(state.tokenAllowance), requiredTokenAllowance = BigInt(state.tokenAmount);
  $('tokenApprovalHint').textContent = tokenAllowance !== 0n && tokenAllowance !== requiredTokenAllowance
    ? `当前新池授权为 ${(Number(tokenAllowance) / 1e18).toLocaleString('zh-CN')} 枚，超过本次所需数量；先撤销，再精确授权 70,000 枚。`
    : '精确授权 70,000 枚新 CaBi，留在钱包中的余额不受影响。';
  let cached;
  try { cached = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { /* Ignore unavailable browser storage. */ }
  const serverPending = record.pending;
  if (serverPending) cachePending({ ...serverPending, ...(cached?.kind === serverPending.kind && cached.hash ? { hash: cached.hash } : {}) });
  else if (cached?.hash && !same(record.actions?.[cached.kind]?.hash, cached.hash)
    && !record.failures?.some(failure => same(failure.hash, cached.hash))
    && !record.resets?.some(reset => same(reset.hash, cached.hash))) cachePending(cached);
  else cachePending(null);
  if (pending?.hash) { $('hash').value = pending.hash; $('kind').value = pending.kind; }
  render(); return next;
}
async function track(kind, hash) {
  $('txLink').textContent = hash; $('txLink').href = 'https://bscscan.com/tx/' + hash;
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await api('verify', { kind, hash });
    if (result.reverted) { cachePending(null); await refresh(); throw new Error(result.error); }
    if (!result.pending) { cachePending(null); await refresh(); message(result.message || manifest.labels[kind] + '：链上已确认。', 'success'); return true; }
    message(result.message || '等待交易确认，请勿重复发送。');
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  message('交易哈希已保存。稍后使用“查询并核对”继续。'); return false;
}
async function send(kind) {
  await context();
  const plan = await api('plan?kind=' + kind);
  $('fee').textContent = `${plan.detail}。预估 Gas ${plan.estimatedFeeBnb} BNB，预留上限 ${plan.maxFeeBnb} BNB。`;
  const nonce = rpcHex(await rpc('eth_getTransactionCount', [account, 'pending']));
  await context();
  const begun = await api('begin', { kind, nonce, dataHash: plan.dataHash });
  cachePending(begun.pending);
  message(`${plan.detail}。请核对钱包中的目标、时间和金额再签名。`);
  let hash;
  try {
    hash = await rpc('eth_sendTransaction', [{ ...plan.tx, nonce }]);
    if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('钱包没有返回有效交易哈希，请检查钱包交易记录');
  } catch (error) {
    if ([4001, -32602].includes(Number(error?.code)) || /^Invalid transaction params:/i.test(errorText(error))) {
      await api('cancel', { kind }); cachePending(null);
      message(Number(error?.code) === 4001 ? '已取消钱包确认，可以稍后重试。' : errorText(error), 'error'); return false;
    }
    throw error;
  }
  cachePending({ ...pending, hash, status: 'pending' }); $('hash').value = hash; $('kind').value = kind;
  await api('hash', { kind, hash });
  return track(kind, hash);
}
async function run(kind) {
  if (busy || pending) return;
  busy = true; render();
  try { await refresh(); if (!pending) await send(kind); }
  catch (error) { message(errorText(error) + (pending ? '\n等待记录已保留，请先查询钱包交易。' : ''), 'error'); }
  finally { busy = false; render(); }
}
$('connect').onclick = async () => {
  if (busy) return;
  busy = true; render();
  try {
    provider = wallets[Number($('wallet').value)]?.provider;
    if (!provider) throw new Error('请在安装 MetaMask／OKX 的 Chrome 或 Edge 打开本页');
    await rpc('eth_requestAccounts'); await context(); await refresh();
    message(pending ? '已有交易等待核对，请先查询。' : '管理员钱包和 BSC 主网已核对。');
  } catch (error) { account = null; message(errorText(error), 'error'); }
  finally { busy = false; render(); }
};
$('switch').onclick = async () => {
  try { await rpc('wallet_switchEthereumChain', [{ chainId: '0x38' }]); await context(); message('已切换到 BSC 主网。'); }
  catch (error) { message(errorText(error), 'error'); }
  render();
};
$('refresh').onclick = async () => { try { await refresh(); message('链上余额、授权与开放状态已更新。'); } catch (error) { message(errorText(error), 'error'); } };
for (const button of document.querySelectorAll('[data-send]')) button.onclick = () => run(button.dataset.send);
$('check').onclick = async () => {
  if (busy) return;
  const kind = $('kind').value, hash = $('hash').value.trim() || pending?.hash;
  if (!/^0x[0-9a-f]{64}$/i.test(hash || '')) { message('请填写完整交易哈希。', 'error'); return; }
  busy = true; render();
  try { await track(kind, hash); } catch (error) { message(errorText(error), 'error'); }
  finally { busy = false; render(); }
};
async function initialize() {
  const response = await fetch('/manifest.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('无法加载开放时间和初始 LP 参数');
  manifest = await response.json(); storageKey = 'cabi-launch-stage2:' + manifest.fingerprint;
  for (const field of ['owner', 'token', 'pool', 'pair']) $(field).textContent = manifest[field];
  $('claimTime').textContent = manifest.claimStartsAtBeijing + '（北京时间）';
  $('tradingTime').textContent = manifest.tradingStartsAtBeijing + '（北京时间）';
  discover(); await refresh();
  message(pending ? '已恢复待核对交易。' : '合约与资产余额已核对，请连接管理员插件钱包。');
  render();
}
window.cabiLaunchStage2Ready = initialize().catch(error => { message(errorText(error), 'error'); });
