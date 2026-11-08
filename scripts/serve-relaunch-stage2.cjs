/* eslint-disable @typescript-eslint/no-require-imports -- Launch schedule and initial liquidity for the new deployment. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const configFile = path.join(root, 'output', 'relaunch-unlimited', 'stage2.template.json');
process.env.CABI_LAUNCH_CONFIG = path.join(root, 'deploy', 'relaunch-unlimited.json');
process.env.CABI_LAUNCH_OUTPUT = path.dirname(configFile);
process.env.CABI_LAUNCH_STAGE2_CONFIG = configFile;
process.env.CABI_LAUNCH_STAGE2_PORT = process.env.CABI_RELAUNCH_STAGE2_PORT || '8793';
if (!fs.existsSync(configFile)) {
  console.error('请先完成新合约部署的六步，之后会生成本次加池参数。');
  process.exitCode = 1;
} else {
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (!config.seedProvider) {
    console.error('请先在 ' + configFile + ' 填写 seedProvider（首次加池钱包）；该钱包自行出资并持有初始 LP。');
    process.exitCode = 1;
  } else if (['claimStartsAt', 'tradingStartsAt', 'claimStartsAtBeijing', 'tradingStartsAtBeijing'].some(field => !config[field])) {
    console.error('请先在 ' + configFile + ' 设置本次领取和交易时间；不会沿用旧币时间。');
    process.exitCode = 1;
  } else require('./serve-launch-stage2.cjs');
}
