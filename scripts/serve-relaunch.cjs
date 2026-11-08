/* eslint-disable @typescript-eslint/no-require-imports -- Dedicated wallet console for a new deployment. */
const path = require('node:path');
const root = path.resolve(__dirname, '..');
process.env.CABI_LAUNCH_CONFIG = path.join(root, 'deploy', 'relaunch-unlimited.json');
process.env.CABI_LAUNCH_OUTPUT = path.join(root, 'output', 'relaunch-unlimited');
process.env.CABI_LAUNCH_DEPLOY_PORT = process.env.CABI_RELAUNCH_PORT || '8792';
require('./serve-launch-deployment.cjs');
