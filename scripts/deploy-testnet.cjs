/* eslint-disable @typescript-eslint/no-require-imports -- Standalone local deployment runner. */
/*
 * CaBi token deployment on BNB Smart Chain TESTNET only (chain ID 97).
 * Defaults to preparation. A transaction is signed only with --deploy.
 * Private wallet JSON stays outside public artifacts and is never logged.
 */
const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');
const {
  createPublicClient, encodeDeployData, formatEther, getAddress,
  getContractAddress, http, keccak256, toHex, zeroAddress,
} = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { bscTestnet } = require('viem/chains');

const ROOT = path.resolve(__dirname, '..');
const CHAIN_ID = 97;
const RPC_URL = process.env.CABI_TESTNET_RPC_URL || 'https://bsc-testnet-rpc.publicnode.com';
const PREPARATION_FILE = path.join(ROOT, 'output/deployments/bsc-testnet-preparation.json');
const DEPLOYMENT_FILE = path.join(ROOT, 'output/deployments/bsc-testnet-cabi.json');
const ARTIFACT_FILE = path.join(ROOT, 'output/contracts/CaBiToken.json');
const FALLBACK_PREPARATION_GAS = 4_000_000n;
const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;
const MAX_WALLET = 200_000n * 10n ** 18n;

class DeploymentError extends Error {
  constructor(code, message) { super(message); this.name = code; }
}
function requireCondition(condition, code, message) {
  if (!condition) throw new DeploymentError(code, message);
}
function writePublic(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n', 'utf8');
}
function readPublic(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new DeploymentError('INVALID_PUBLIC_MANIFEST', 'Cannot read the public deployment manifest.');
  }
}
function loadAccount() {
  const walletFile = process.env.CABI_TESTNET_WALLET_FILE;
  requireCondition(Boolean(walletFile), 'WALLET_FILE_REQUIRED', 'Set CABI_TESTNET_WALLET_FILE to the local testnet wallet JSON.');
  let wallet;
  try { wallet = JSON.parse(fs.readFileSync(walletFile, 'utf8')); }
  catch { throw new DeploymentError('WALLET_UNAVAILABLE', 'Cannot read the local testnet wallet.'); }
  requireCondition(wallet.chainId === CHAIN_ID, 'WALLET_WRONG_CHAIN', 'The wallet must be designated for testnet chain ID 97.');
  let account;
  try { account = privateKeyToAccount(wallet.privateKey); }
  catch { throw new DeploymentError('INVALID_WALLET_KEY', 'The local testnet wallet key is invalid.'); }
  requireCondition(
    typeof wallet.address === 'string' && wallet.address.toLowerCase() === account.address.toLowerCase(),
    'WALLET_ADDRESS_MISMATCH', 'The local wallet address does not match its key.',
  );
  return account;
}
function compileToken() {
  const source = fs.readFileSync(path.join(ROOT, 'contracts/XBTToken.sol'), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'contracts/XBTToken.sol': { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'shanghai',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata'] } },
    },
  };
  const compiled = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (compiled.errors || []).filter(error => error.severity === 'error');
  requireCondition(errors.length === 0, 'COMPILATION_FAILED', errors.map(error => error.formattedMessage).join('\n'));
  const contract = compiled.contracts['contracts/XBTToken.sol'].XBTToken;
  const artifact = {
    contractName: 'XBTToken', tokenName: 'CaBi', compiler: solc.version(),
    sourceHash: keccak256(toHex(source)),
    abi: contract.abi,
    bytecode: '0x' + contract.evm.bytecode.object,
    deployedBytecode: '0x' + contract.evm.deployedBytecode.object,
    standardJsonInput: input,
  };
  artifact.bytecodeHash = keccak256(artifact.bytecode);
  artifact.deployedBytecodeHash = keccak256(artifact.deployedBytecode);
  requireCondition(artifact.abi.find(entry => entry.type === 'constructor')?.inputs.length === 0, 'UNEXPECTED_CONSTRUCTOR', 'Expected the no-argument CaBi constructor.');
  writePublic(ARTIFACT_FILE, artifact);
  return artifact;
}
async function assertTestnet(client) {
  const chainId = await client.getChainId();
  requireCondition(chainId === CHAIN_ID, 'RPC_WRONG_CHAIN', 'RPC is not BNB Smart Chain testnet (97); no transaction is permitted.');
}
const withGasMargin = gas => (gas * 120n + 99n) / 100n;
function assertManifestMatches(record, account, artifact) {
  requireCondition(
    record.chainId === CHAIN_ID && record.address?.toLowerCase() === account.address.toLowerCase()
      && record.sourceHash === artifact.sourceHash && record.bytecodeHash === artifact.bytecodeHash,
    'MANIFEST_MISMATCH', 'Compiled source or wallet differs from the public preparation/deployment record. Review the records before continuing.',
  );
}

async function prepare(client, account, artifact) {
  await assertTestnet(client);
  const [balance, nonce, gasPrice] = await Promise.all([
    client.getBalance({ address: account.address }),
    client.getTransactionCount({ address: account.address, blockTag: 'pending' }),
    client.getGasPrice(),
  ]);
  let estimatedGas = null;
  let gasEstimateError = null;
  try { estimatedGas = await client.estimateGas({ account: account.address, data: artifact.bytecode }); }
  catch { gasEstimateError = 'RPC could not estimate deployment gas; the account may need test BNB first.'; }
  const gasLimit = estimatedGas === null ? FALLBACK_PREPARATION_GAS : withGasMargin(estimatedGas);
  const maximumFee = gasLimit * gasPrice;
  const record = {
    preparedAt: new Date().toISOString(), chainId: CHAIN_ID, network: 'BNB Smart Chain Testnet',
    rpcHost: new URL(RPC_URL).hostname,
    address: account.address, nonce,
    predictedContractAddress: getContractAddress({ from: account.address, nonce: BigInt(nonce) }),
    sourceHash: artifact.sourceHash, bytecodeHash: artifact.bytecodeHash,
    compiler: artifact.compiler,
    balanceWei: balance.toString(), balanceBNB: formatEther(balance),
    gasPriceWei: gasPrice.toString(),
    estimatedGas: estimatedGas?.toString() ?? null, gasEstimateError,
    gasLimit: gasLimit.toString(),
    gasLimitBasis: estimatedGas === null ? 'conservative funding allowance; not an RPC estimate' : 'RPC estimate plus 20 percent',
    maximumFeeWei: maximumFee.toString(), maximumFeeBNB: formatEther(maximumFee),
    fundedForPreparedLimit: balance >= maximumFee,
    token: { name: 'CaBi', symbol: 'CaBi', decimals: 18, supply: '1000000000', maxWallet: '200000' },
  };
  writePublic(PREPARATION_FILE, record);
  console.log(JSON.stringify({ mode: 'prepare', ...record }, null, 2));
}

async function verifyDeployment(client, artifact, account, record, receipt) {
  requireCondition(receipt.status === 'success' && receipt.contractAddress, 'DEPLOYMENT_REVERTED', 'The recorded testnet deployment did not succeed.');
  const contractAddress = getAddress(receipt.contractAddress);
  requireCondition(contractAddress === getAddress(record.predictedContractAddress), 'DEPLOYMENT_ADDRESS_MISMATCH', 'The receipt address differs from the prepared CREATE address.');
  const contract = { address: contractAddress, abi: artifact.abi };
  const [name, symbol, decimals, totalSupply, owner, maxWalletAmount, deployerBalance, tradingGateway, bytecode] = await Promise.all([
    client.readContract({ ...contract, functionName: 'name' }),
    client.readContract({ ...contract, functionName: 'symbol' }),
    client.readContract({ ...contract, functionName: 'decimals' }),
    client.readContract({ ...contract, functionName: 'totalSupply' }),
    client.readContract({ ...contract, functionName: 'owner' }),
    client.readContract({ ...contract, functionName: 'maxWalletAmount' }),
    client.readContract({ ...contract, functionName: 'balanceOf', args: [account.address] }),
    client.readContract({ ...contract, functionName: 'tradingGateway' }),
    client.getCode({ address: contractAddress }),
  ]);
  const checks = {
    name: name === 'CaBi', symbol: symbol === 'CaBi', decimals: decimals === 18,
    totalSupply: totalSupply === TOTAL_SUPPLY,
    owner: owner.toLowerCase() === account.address.toLowerCase(),
    maxWalletAmount: maxWalletAmount === MAX_WALLET,
    initialDeployerBalance: deployerBalance === TOTAL_SUPPLY,
    tradingGatewayUnconfigured: tradingGateway === zeroAddress,
    runtimeBytecode: Boolean(bytecode) && keccak256(bytecode) === artifact.deployedBytecodeHash,
  };
  const completed = {
    ...record, status: 'success', contractAddress,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(), effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    actualFeeBNB: formatEther(receipt.gasUsed * receipt.effectiveGasPrice),
    verifiedAt: new Date().toISOString(), checks,
    explorerUrl: `https://testnet.bscscan.com/address/${contractAddress}`,
    transactionUrl: `https://testnet.bscscan.com/tx/${record.transactionHash}`,
  };
  writePublic(DEPLOYMENT_FILE, completed);
  requireCondition(Object.values(checks).every(Boolean), 'ONCHAIN_VALUES_DIFFER', 'Deployment succeeded, but one or more on-chain checks differ from the expected token. See the public deployment record.');
  console.log(JSON.stringify({ mode: 'deployed', ...completed }, null, 2));
}

async function deploy(client, account, artifact) {
  await assertTestnet(client);
  const previous = readPublic(DEPLOYMENT_FILE);
  let record;
  if (previous?.transactionHash) {
    assertManifestMatches(previous, account, artifact);
    record = previous;
    console.log(JSON.stringify({ mode: 'resume', transactionHash: record.transactionHash, address: account.address }));
    try {
      const receipt = await client.getTransactionReceipt({ hash: record.transactionHash });
      await verifyDeployment(client, artifact, account, record, receipt);
      return;
    } catch (error) {
      if (error instanceof DeploymentError) throw error;
      // A pending receipt is handled below using the exact same signed request.
    }
  } else {
    const preparation = readPublic(PREPARATION_FILE);
    requireCondition(Boolean(preparation), 'PREPARE_FIRST', 'Run this script with --prepare before deploying.');
    assertManifestMatches(preparation, account, artifact);
    const [balance, nonce, gasPrice] = await Promise.all([
      client.getBalance({ address: account.address }),
      client.getTransactionCount({ address: account.address, blockTag: 'pending' }),
      client.getGasPrice(),
    ]);
    requireCondition(nonce === preparation.nonce, 'NONCE_CHANGED', 'The deployer nonce changed; run --prepare again before deployment.');
    let estimatedGas;
    try { estimatedGas = await client.estimateGas({ account: account.address, data: artifact.bytecode }); }
    catch { throw new DeploymentError('ESTIMATE_UNAVAILABLE', 'RPC could not estimate deployment gas. Fund the testnet address and run --prepare again.'); }
    const gasLimit = withGasMargin(estimatedGas);
    const maximumFee = gasLimit * gasPrice;
    requireCondition(balance >= maximumFee, 'INSUFFICIENT_TEST_BNB', `The testnet address needs at least ${formatEther(maximumFee)} test BNB for the current gas limit.`);
    const block = await client.getBlock();
    requireCondition(gasLimit <= block.gasLimit, 'GAS_EXCEEDS_BLOCK', 'The estimated transaction gas exceeds the testnet block limit.');
    record = {
      chainId: CHAIN_ID, network: 'BNB Smart Chain Testnet', address: account.address,
      sourceHash: artifact.sourceHash, bytecodeHash: artifact.bytecodeHash,
      predictedContractAddress: getContractAddress({ from: account.address, nonce: BigInt(nonce) }),
      compiler: artifact.compiler, preparedAt: preparation.preparedAt,
      nonce, gasLimit: gasLimit.toString(), gasPriceWei: gasPrice.toString(),
      maximumFeeBNB: formatEther(maximumFee),
      estimatedGas: estimatedGas.toString(), status: 'prepared',
    };
  }

  // The request is deterministic. Persist its hash BEFORE broadcast so a lost
  // RPC response cannot cause a second deployment with a different nonce.
  await assertTestnet(client);
  const nonce = record.nonce;
  const transaction = {
    type: 'legacy', chainId: CHAIN_ID, nonce,
    gas: BigInt(record.gasLimit), gasPrice: BigInt(record.gasPriceWei), value: 0n,
    data: encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [] }),
  };
  const serialized = await account.signTransaction(transaction);
  const transactionHash = keccak256(serialized);
  requireCondition(!record.transactionHash || record.transactionHash === transactionHash, 'SIGNED_REQUEST_CHANGED', 'The recorded transaction does not match this deterministic deployment request.');
  const latestNonce = await client.getTransactionCount({ address: account.address, blockTag: 'latest' });
  requireCondition(latestNonce <= nonce, 'NONCE_ALREADY_MINED', 'The deployment nonce is already mined; retain the record and check its transaction receipt.');
  record = { ...record, transactionHash, signedAt: record.signedAt || new Date().toISOString() };
  writePublic(DEPLOYMENT_FILE, record);
  console.log(JSON.stringify({ mode: 'broadcast', chainId: CHAIN_ID, transactionHash, predictedContractAddress: record.predictedContractAddress }));
  try {
    const sentHash = await client.sendRawTransaction({ serializedTransaction: serialized });
    requireCondition(sentHash === transactionHash, 'RPC_HASH_MISMATCH', 'RPC returned a different transaction hash.');
    record = { ...record, status: 'broadcast', broadcastAt: new Date().toISOString() };
    writePublic(DEPLOYMENT_FILE, record);
  } catch (error) {
    if (error instanceof DeploymentError) throw error;
    // Already-known or uncertain RPC responses are resolved through the saved
    // hash. The serialized transaction is deliberately never logged or stored.
  }
  let receipt;
  try { receipt = await client.waitForTransactionReceipt({ hash: transactionHash, timeout: 60_000, pollingInterval: 3_000, confirmations: 1 }); }
  catch { throw new DeploymentError('TRANSACTION_PENDING', 'Receipt is not available yet. The transaction hash is saved; rerun --deploy to resume without creating a duplicate deployment.'); }
  await verifyDeployment(client, artifact, account, record, receipt);
}

async function main() {
  const flags = process.argv.slice(2);
  requireCondition(flags.every(flag => ['--prepare', '--deploy'].includes(flag)) && !(flags.includes('--prepare') && flags.includes('--deploy')), 'INVALID_ARGUMENTS', 'Use either --prepare (default) or --deploy.');
  const account = loadAccount();
  const artifact = compileToken();
  const client = createPublicClient({ chain: bscTestnet, transport: http(RPC_URL, { timeout: 15_000, retryCount: 1 }) });
  if (flags.includes('--deploy')) await deploy(client, account, artifact);
  else await prepare(client, account, artifact);
}
main().catch(error => {
  // Never serialize viem/account errors or wallet JSON: they may hold secrets.
  if (error instanceof DeploymentError) console.error(JSON.stringify({ error: error.name, message: error.message }));
  else console.error(JSON.stringify({ error: 'PREPARATION_OR_RPC_FAILED', message: 'Could not complete the testnet operation. Check the local wallet path, compilation, and testnet RPC availability.' }));
  process.exitCode = 1;
});
