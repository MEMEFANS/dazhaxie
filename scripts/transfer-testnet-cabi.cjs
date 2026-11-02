/* eslint-disable @typescript-eslint/no-require-imports -- Local testnet transaction runner. */
const fs = require('node:fs');
const path = require('node:path');
const { createPublicClient, encodeFunctionData, formatEther, formatUnits, getAddress, http, keccak256, zeroAddress } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { bscTestnet } = require('viem/chains');

const ROOT = path.resolve(__dirname, '..');
const TOKEN = getAddress('0x7C877a6AE2b94622c0455AA5Bc5eB4ba03798E66');
const SENDER = getAddress('0xb1ea86369a3D020308840CAd44D02BE3c117fF20');
const RECIPIENT = getAddress('0x022145b95edbf0b6c7f8d14a6116e9e23c93bd7e');
const AMOUNT = 1_000_000_000n * 10n ** 18n;
const LIMIT = 200_000n * 10n ** 18n;
const RECORD_FILE = path.join(ROOT, 'output/deployments/bsc-testnet-cabi-transfer.json');
const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'output/contracts/CaBiToken.json'), 'utf8'));
const deployment = JSON.parse(fs.readFileSync(path.join(ROOT, 'output/deployments/bsc-testnet-cabi.json'), 'utf8'));
const client = createPublicClient({ chain: bscTestnet, transport: http('https://bsc-testnet-rpc.publicnode.com', { timeout: 15_000, retryCount: 1 }) });
const contract = { address: TOKEN, abi: artifact.abi };
const read = (functionName, args = []) => client.readContract({ ...contract, functionName, args });
class TransferError extends Error {}
function check(condition, message) { if (!condition) throw new TransferError(message); }
function save(record) { fs.writeFileSync(RECORD_FILE, JSON.stringify(record, null, 2) + '\n'); }
async function assertChain() { check(await client.getChainId() === 97, 'RPC must be BSC testnet chain 97.'); }
async function snapshot() {
  const [senderBalance, recipientBalance, exempt, maxWallet, owner, pair, gateway] = await Promise.all([
    read('balanceOf', [SENDER]), read('balanceOf', [RECIPIENT]), read('isMaxWalletExempt', [RECIPIENT]),
    read('maxWalletAmount'), read('owner'), read('tradingPair'), read('tradingGateway'),
  ]);
  return { senderBalance: senderBalance.toString(), recipientBalance: recipientBalance.toString(), exempt,
    maxWallet: maxWallet.toString(), owner, pair, gateway };
}
async function sendStep(record, account, name, functionName, args) {
  await assertChain();
  const data = encodeFunctionData({ abi: artifact.abi, functionName, args });
  let step = record.steps[name];
  if (!step) {
    const [estimate, gasPrice, nonce, balance] = await Promise.all([
      client.estimateContractGas({ ...contract, account: SENDER, functionName, args }),
      client.getGasPrice(), client.getTransactionCount({ address: SENDER, blockTag: 'pending' }),
      client.getBalance({ address: SENDER }),
    ]);
    const gas = (estimate * 120n + 99n) / 100n;
    check(balance >= gas * gasPrice, 'Insufficient test BNB for the transaction.');
    step = { nonce, gas: gas.toString(), gasPrice: gasPrice.toString(), data };
  }
  check(step.data === data, 'Saved transaction differs from the authorized action.');
  const transaction = { type: 'legacy', chainId: 97, nonce: step.nonce, to: TOKEN,
    value: 0n, data, gas: BigInt(step.gas), gasPrice: BigInt(step.gasPrice) };
  const serialized = await account.signTransaction(transaction);
  const hash = keccak256(serialized);
  check(!step.hash || step.hash === hash, 'Saved transaction hash does not match.');
  step = { ...step, hash };
  record.steps[name] = step;
  // Save public transaction details before broadcasting; never save the key or signed bytes.
  save(record);
  let receipt;
  try { receipt = await client.getTransactionReceipt({ hash }); }
  catch (error) { if (error.name !== 'TransactionReceiptNotFoundError') throw error; }
  if (!receipt) {
    check(await client.getTransactionCount({ address: SENDER, blockTag: 'latest' }) <= step.nonce,
      'Nonce already mined. Check the saved hash before continuing.');
    console.log(JSON.stringify({ action: name, transactionHash: hash }));
    try {
      const sentHash = await client.sendRawTransaction({ serializedTransaction: serialized });
      check(sentHash === hash, 'Unexpected RPC transaction hash.');
    } catch (error) { if (error instanceof TransferError) throw error; }
    receipt = await client.waitForTransactionReceipt({ hash, timeout: 45_000, pollingInterval: 2_000 });
  }
  check(receipt.status === 'success' && getAddress(receipt.to) === TOKEN, 'Recorded transaction failed.');
  record.steps[name] = { ...step, status: 'success', blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(), feeBNB: formatEther(receipt.gasUsed * receipt.effectiveGasPrice),
    transactionUrl: `https://testnet.bscscan.com/tx/${hash}` };
  save(record);
}
async function main() {
  check(process.argv.slice(2).every(flag => flag === '--send'), 'Use no flag to prepare or --send to execute.');
  await assertChain();
  check(deployment.chainId === 97 && getAddress(deployment.contractAddress) === TOKEN
    && getAddress(deployment.address) === SENDER && deployment.status === 'success', 'Deployment record mismatch.');
  const code = await client.getCode({ address: TOKEN });
  check(code && keccak256(code) === artifact.deployedBytecodeHash, 'Token bytecode mismatch.');
  let record = fs.existsSync(RECORD_FILE) ? JSON.parse(fs.readFileSync(RECORD_FILE, 'utf8')) : null;
  if (record) check(record.chainId === 97 && record.token === TOKEN && record.sender === SENDER
    && record.recipient === RECIPIENT && record.amount === AMOUNT.toString(), 'Transfer record mismatch.');
  if (record?.status === 'success') { console.log(JSON.stringify(record, null, 2)); return; }
  const state = await snapshot();
  check(state.owner === SENDER && state.pair === zeroAddress && state.gateway === zeroAddress
    && state.maxWallet === LIMIT.toString(), 'Unexpected token configuration; no transaction sent.');
  if (!record) {
    check(state.senderBalance === AMOUNT.toString() && state.recipientBalance === '0', 'Unexpected balances; no transaction sent.');
    record = { chainId: 97, token: TOKEN, sender: SENDER, recipient: RECIPIENT, amount: AMOUNT.toString(),
      amountCaBi: formatUnits(AMOUNT, 18), preparedAt: new Date().toISOString(), before: state, steps: {} };
  }
  if (!process.argv.includes('--send')) { console.log(JSON.stringify({ mode: 'prepare', ...record }, null, 2)); return; }
  check(Boolean(process.env.CABI_TESTNET_WALLET_FILE), 'Local testnet wallet path is required.');
  const wallet = JSON.parse(fs.readFileSync(process.env.CABI_TESTNET_WALLET_FILE, 'utf8'));
  check(wallet.chainId === 97 && getAddress(wallet.address) === SENDER, 'Wrong local wallet.');
  const account = privateKeyToAccount(wallet.privateKey);
  check(account.address === SENDER, 'Local wallet key does not match the deployer.');
  save(record);
  if (record.steps.exemption || !state.exempt) {
    await sendStep(record, account, 'exemption', 'setMaxWalletExempt', [RECIPIENT, true]);
  }
  check(await read('isMaxWalletExempt', [RECIPIENT]), 'Recipient exemption is not active.');
  if (!record.steps.transfer) {
    check(await read('balanceOf', [SENDER]) === AMOUNT, 'Sender balance changed; transfer stopped.');
  }
  await sendStep(record, account, 'transfer', 'transfer', [RECIPIENT, AMOUNT]);
  const after = await snapshot();
  check(after.senderBalance === '0' && after.recipientBalance === AMOUNT.toString()
    && after.exempt && after.maxWallet === LIMIT.toString() && after.owner === SENDER,
  'Transaction mined; final balances or configuration need review.');
  record = { ...record, status: 'success', verifiedAt: new Date().toISOString(), after };
  save(record);
  console.log(JSON.stringify(record, null, 2));
}
main().catch(error => {
  console.error(JSON.stringify({ error: error instanceof TransferError ? error.message
    : 'Testnet operation incomplete. Check the saved public hashes before retrying; no secrets were logged.' }));
  process.exitCode = 1;
});
