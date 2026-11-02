/* eslint-disable @typescript-eslint/no-require-imports -- Local administrator bootstrap. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes, scryptSync } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const envFile = path.join(root, '.env.local');
const existing = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
const dataDirectory = process.env.CABI_DATA_DIR ? path.resolve(process.env.CABI_DATA_DIR)
  : process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'CaBi', 'admin') : path.join(os.homedir(), '.local', 'share', 'cabi-admin');
const credentialsFile = path.join(dataDirectory, 'login-credentials.txt');

if (/^ADMIN_(USERNAME|PASSWORD_HASH|SESSION_SECRET)=/m.test(existing)) {
  console.log('Administrator settings already exist in .env.local; no credentials were changed.');
  process.exit(0);
}
if (fs.existsSync(credentialsFile)) {
  console.error('A private administrator credential file already exists. Keep it and review configuration before initializing again.');
  process.exit(1);
}
const username = process.env.CABI_SETUP_ADMIN_USERNAME || 'admin';
if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
  console.error('CABI_SETUP_ADMIN_USERNAME must contain 3-64 letters, digits, dots, underscores or hyphens.');
  process.exit(1);
}
const password = randomBytes(18).toString('base64url');
const salt = randomBytes(16);
const passwordHash = `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`;
const secret = randomBytes(32).toString('hex');
fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
fs.writeFileSync(credentialsFile, `CaBi local administrator\nUsername: ${username}\nPassword: ${password}\n\nLogin: /admin/login\nKeep this file private. Server configuration is in .env.local.\n`, { flag: 'wx', mode: 0o600 });
// Next expands dollar signs in .env values, so preserve the hash separators explicitly.
const escapedHash = passwordHash.replaceAll('$', '\\$');
const additions = `\n# CaBi server-side administrator\nADMIN_USERNAME=${username}\nADMIN_PASSWORD_HASH=${escapedHash}\nADMIN_SESSION_SECRET=${secret}\n`;
fs.writeFileSync(envFile, existing + additions, { mode: 0o600 });
console.log(JSON.stringify({ initialized: true, credentialsFile, configurationFile: envFile, note: 'Open the private credential file locally. Passwords and session secrets are never printed.' }, null, 2));
