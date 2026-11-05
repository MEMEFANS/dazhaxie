/* global window, document, localStorage, fetch, Event */
'use strict';
const $ = id => document.getElementById(id);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const rpcHex = value => '0x' + BigInt(value).toString(16);
const wallets = [];
let manifest, provider, account, state = {}, record = {}, pending, storageKey, busy = false;
function message(text, tone = '') { $('message').textContent = text; $('message').dataset.tone = tone; }
function errorText(error) { return error?.shortMessage || error?.message || '钱包操作未完成'; }
function cachePending(value) {
  pending = value;
  try { if (value) localStorage.setItem(storageKey, JSON.stringify(value)); else localStorage.removeItem(storageKey); } catch { /* Server record remains available. */ }
  render();
}
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
  if (!response.ok || (result.error && !result.reverted)) throw new Error(result.error || '部署状态暂时无法更新');
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
function completed(kind) { return ({ token: Boolean(state.token), pair: Boolean(state.pair), trading: state.tradingReady, pool: Boolean(state.pool), bind: state.bindReady })[kind]; }
function link(id, address) { $(id).textContent = address || '等待部署'; if (address) $(id).href = 'https://bscscan.com/address/' + address; }
function render() {
  const ready = Boolean(manifest && provider && account && !busy && !pending);
  const kinds = manifest?.kinds || [];
  $('connect').disabled = !manifest || !wallets.length || busy;
  $('refresh').disabled = !manifest || busy; $('wallet').disabled = busy;
  $('continue').disabled = !ready || state.complete;
  $('check').disabled = busy;
  $('reset').disabled = busy || !pending || Boolean(pending.hash);
  for (const [index, kind] of kinds.entries()) {
    const article = document.querySelector(`[data-kind="${kind}"]`);
    const done = completed(kind), status = article.querySelector('.status');
    status.textContent = done ? '已完成' : pending?.kind === kind ? '待核对' : '待完成'; status.className = 'status' + (done ? ' done' : '');
    article.querySelector('button').disabled = !ready || done || kinds.slice(0, index).some(prior => !completed(prior));
  }
  if (state.token) { $('result').hidden = false; link('tokenLink', state.token); link('pairLink', state.pair); link('poolLink', state.pool); }
}
async function refresh() {
  const next = await api('state'); state = next.state; record = next.record;
  let cached;
  try { cached = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { /* Ignore unavailable browser storage. */ }
  const serverPending = record.pending;
  if (serverPending) cachePending({ ...serverPending, ...(cached?.kind === serverPending.kind && cached.hash ? { hash: cached.hash } : {}) });
  else if (cached?.hash && !same(record.actions?.[cached.kind]?.hash, cached.hash)) cachePending(cached);
  else cachePending(null);
  if (pending?.hash) { $('hash').value = pending.hash; $('kind').value = pending.kind; }
  render(); return next;
}
async function track(kind, hash) {
  $('txLink').textContent = hash; $('txLink').href = 'https://bscscan.com/tx/' + hash;
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await api('verify', { kind, hash });
    if (result.reverted) { cachePending(null); await refresh(); throw new Error(result.error); }
    if (!result.pending) {
      cachePending(null); state = result.state; record = result.record;
      await refresh(); message(manifest.labels[kind] + '：链上已确认。', 'success'); return true;
    }
    message(result.message || '等待交易上链及第二个区块确认，请勿重复发送。');
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  message('交易哈希已保留，稍后点击“查询并核对”继续。'); return false;
}
async function send(kind) {
  await context();
  const plan = await api('plan?kind=' + kind);
  $('fee').textContent = '本笔预估 GAS：' + plan.estimatedFeeBnb + ' BNB；按当前 GAS 价格预留上限：' + plan.maxFeeBnb + ' BNB。';
  // All JSON-RPC quantities are strings, including wallets returning a number.
  const nonce = rpcHex(await rpc('eth_getTransactionCount', [account, 'pending']));
  await context();
  const begun = await api('begin', { kind, nonce, dataHash: plan.dataHash });
  cachePending(begun.pending);
  message(plan.label + '：请在插件钱包确认。本笔转账金额为 0 BNB，只支付 GAS。');
  let hash;
  try {
    hash = await rpc('eth_sendTransaction', [{ ...plan.tx, nonce }]);
    if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('钱包没有返回有效交易哈希，请核对钱包交易记录');
  } catch (error) {
    if ([4001, -32602].includes(Number(error?.code)) || /^Invalid transaction params:/i.test(errorText(error))) {
      await api('cancel', { kind }); cachePending(null);
      message(Number(error?.code) === 4001 ? '已取消钱包确认，可以重新操作。' : errorText(error), 'error'); return false;
    }
    throw error;
  }
  // Persist returned hash before the server call, so a lost HTTP response never
  // causes the user to send a second deployment transaction.
  cachePending({ ...pending, hash, status: 'pending' }); $('hash').value = hash; $('kind').value = kind;
  await api('hash', { kind, hash });
  return track(kind, hash);
}
async function run(kind, sequence = false) {
  if (busy || pending) return;
  busy = true; render();
  try {
    if (sequence) {
      while (true) {
        await refresh();
        if (pending) throw new Error('有一笔钱包操作等待核对，请先查询已有交易');
        const next = manifest.kinds.find(item => !completed(item));
        if (!next) { message('五步部署与绑定全部完成。当前为筹备阶段，领取和交易时间由你之后设置。', 'success'); break; }
        if (!await send(next)) break;
      }
    } else await send(kind);
  } catch (error) { message(errorText(error) + (pending ? '\n本笔记录已保留，请先查询钱包交易。' : ''), 'error'); }
  finally { busy = false; render(); }
}
$('connect').onclick = async () => {
  if (busy) return;
  busy = true; render();
  try {
    provider = wallets[Number($('wallet').value)]?.provider;
    if (!provider) throw new Error('请在安装 MetaMask／OKX 的 Chrome 或 Edge 打开本页');
    await rpc('eth_requestAccounts'); await context(); await refresh();
    message(pending ? '已有钱包操作等待核对，请先查询已有交易。' : '管理员钱包与 BSC 主网已核对，可以开始部署。');
  } catch (error) { account = null; message(errorText(error), 'error'); }
  finally { busy = false; render(); }
};
$('switch').onclick = async () => {
  try {
    try { await rpc('wallet_switchEthereumChain', [{ chainId: '0x38' }]); }
    catch (error) {
      if (Number(error?.code) !== 4902) throw error;
      await rpc('wallet_addEthereumChain', [{ chainId: '0x38', chainName: 'BNB Smart Chain', nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 }, rpcUrls: ['https://bsc-rpc.publicnode.com'], blockExplorerUrls: ['https://bscscan.com'] }]);
    }
    await context(); message('已切换到 BSC 主网。');
  } catch (error) { message(errorText(error), 'error'); }
  render();
};
$('refresh').onclick = async () => { try { await refresh(); message('链上状态已更新。'); } catch (error) { message(errorText(error), 'error'); } };
for (const button of document.querySelectorAll('[data-send]')) button.onclick = () => run(button.dataset.send);
$('continue').onclick = () => run(null, true);
$('check').onclick = async () => {
  if (busy) return;
  const kind = $('kind').value, hash = $('hash').value.trim() || pending?.hash;
  if (!/^0x[0-9a-f]{64}$/i.test(hash || '')) { message('请填写完整交易哈希。', 'error'); return; }
  busy = true; render();
  try { await track(kind, hash); } catch (error) { message(errorText(error), 'error'); }
  finally { busy = false; render(); }
};
$('reset').onclick = async () => {
  if (busy || !pending || pending.hash || !window.confirm('请先检查插件钱包，确认这笔交易没有发送。清除等待状态后才可重试。')) return;
  try { await api('cancel', { kind: pending.kind }); cachePending(null); message('等待状态已清除，可以重新操作。'); }
  catch (error) { message(errorText(error), 'error'); }
};
async function initialize() {
  const response = await fetch('/manifest.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('无法加载部署参数');
  manifest = await response.json(); storageKey = 'cabi-launch-deployment:' + manifest.fingerprint;
  for (const field of ['owner', 'distributionReceiver', 'buybackPool', 'lpReceiver', 'signer', 'usdt']) $(field).textContent = manifest[field];
  discover(); await refresh();
  $('fee').textContent = '代币部署当前预估 GAS：' + manifest.preflight.tokenEstimatedFeeBnb + ' BNB，签名前会重新估算。';
  message(pending ? '已恢复上一次钱包操作，请查询并核对交易。' : state.complete ? '链上部署已完成，合约处于筹备阶段。' : '请连接管理员插件钱包，在 BSC 主网确认部署。');
  render();
}
window.cabiLaunchReady = initialize().catch(error => { message(errorText(error), 'error'); });
