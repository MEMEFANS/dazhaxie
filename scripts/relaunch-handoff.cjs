/* eslint-disable @typescript-eslint/no-require-imports -- Public address exports; never applies live configuration. */
const fs = require('node:fs');
const path = require('node:path');
const { zeroAddress } = require('viem');

function writeHandoff({ destination, config, state, fingerprint }) {
  if (!config.release || !state.complete) return;
  const hasPreviousPool = config.previousClaimPool.toLowerCase() !== zeroAddress;
  const publicEnv = {
    NEXT_PUBLIC_CHAIN_ID: config.chainId,
    NEXT_PUBLIC_TRADING_MODE: 'pancake',
    NEXT_PUBLIC_TOKEN_ADDRESS: state.token,
    NEXT_PUBLIC_USDT_ADDRESS: config.usdt,
    NEXT_PUBLIC_CLAIM_POOL_ADDRESS: state.pool,
    NEXT_PUBLIC_GATEWAY_ADDRESS: '',
    NEXT_PUBLIC_REWARD_POOL_ADDRESS: '',
  };
  // Only public addresses are exported; applying the configuration is separate.
  fs.writeFileSync(path.join(destination, 'website.env.pending'), '# Candidate only. Verify new contract addresses before applying; schedule and seed liquidity are subsequent wallet steps.\n' + Object.entries(publicEnv).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
  const plan = {
    status: hasPreviousPool ? 'deployed-awaiting-legacy-settlement-and-schedule' : 'deployed-awaiting-schedule-and-seed', fingerprint,
    owner: config.owner, token: state.token, pool: state.pool, pair: state.pair,
    previousToken: config.previousToken, previousPool: config.previousClaimPool,
    legacyPolicy: config.legacyPolicy,
    historicalTestPool: config.historicalTestPool,
    signer: config.signer, lpReceiver: config.lpReceiver,
    initialLiquidity: 'Owner designates seedProvider before opening liquidity. That wallet supplies both assets and keeps the initial LP. Initial LP is separate from user preparation LP sent to lpReceiver.',
    seedPage: '/liquidity/seed',
    oldClaims: hasPreviousPool ? 'Preserve claimedOf history. Settle reserved payouts and LP ownership before retiring the old pool. Old tokens do not convert automatically.' : 'New pool is independent (previousPool = zero). No old token or LP migration; no old-pool retirement requirement. Existing transaction and business records remain intact.',
    website: 'Back up /var/lib/cabi, preserve subscriptions/referrals/shipping/rewards/audits, merge website.env.pending into /etc/cabi.env, retain the existing signer key, rebuild Next.js and verify the active pool after restart.',
    keeper: 'Use the new token address only after website cutover; the new pool burn starts 8 hours after the new trading time.',
  };
  fs.writeFileSync(path.join(destination, 'handoff.json'), JSON.stringify(plan, null, 2) + '\n');
  const stage2File = path.join(destination, 'stage2.template.json');
  if (!fs.existsSync(stage2File)) fs.writeFileSync(stage2File, JSON.stringify({
    chainId: config.chainId, owner: config.owner, token: state.token, pool: state.pool, pair: state.pair,
    usdt: config.usdt, previousPool: config.previousClaimPool, lpReceiver: config.lpReceiver,
    seedTokens: config.initialTokenAmount, seedUsdt: config.initialUsdtAmount,
    seedProvider: null,
    claimStartsAt: null, tradingStartsAt: null, claimStartsAtBeijing: null, tradingStartsAtBeijing: null,
  }, null, 2) + '\n');
}
module.exports = { writeHandoff };
