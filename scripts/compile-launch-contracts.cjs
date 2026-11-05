/* eslint-disable @typescript-eslint/no-require-imports -- Local Solidity build tooling. */
const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');
const root = path.resolve(__dirname, '..');

function compileLaunch(includeFixtures = false) {
  const sources = {};
  const files = ['CaBiPancakeToken.sol', 'CaBiLaunchToken.sol', 'CaBiLaunchPool.sol'];
  if (includeFixtures) files.push('test/TestUSDT.sol', 'test/LaunchLegacyLedgerFixture.sol');
  for (const file of files) sources[file] = { content: fs.readFileSync(path.join(root, 'contracts', file), 'utf8') };
  const input = {
    language: 'Solidity', sources,
    settings: {
      optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences', 'metadata'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter(item => item.severity === 'error');
  if (errors.length) throw new Error(errors.map(item => item.formattedMessage).join('\n'));
  for (const [file, name] of [['CaBiLaunchToken.sol', 'CaBiLaunchToken'], ['CaBiLaunchPool.sol', 'CaBiLaunchPool']]) {
    const size = output.contracts[file][name].evm.deployedBytecode.object.length / 2;
    if (size > 24576) throw new Error(`${name}: runtime bytecode ${size} exceeds 24576`);
  }
  return { input, output };
}

if (require.main === module) {
  const { input, output } = compileLaunch();
  const destination = path.join(root, 'output', 'launch-contracts');
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'standard-input.json'), JSON.stringify(input, null, 2));
  const manifest = { compiler: solc.version(), evmVersion: input.settings.evmVersion, contracts: [] };
  for (const name of ['CaBiLaunchToken', 'CaBiLaunchPool']) {
    const artifact = output.contracts[name + '.sol'][name];
    fs.writeFileSync(path.join(destination, name + '.json'), JSON.stringify({
      contractName: name, compiler: solc.version(), abi: artifact.abi,
      bytecode: '0x' + artifact.evm.bytecode.object, deployedBytecode: '0x' + artifact.evm.deployedBytecode.object,
      immutableReferences: artifact.evm.deployedBytecode.immutableReferences,
    }, null, 2));
    const bytes = artifact.evm.deployedBytecode.object.length / 2;
    manifest.contracts.push({ name, runtimeBytes: bytes });
    console.log(`${name}: ${bytes} runtime bytes`);
  }
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('Artifacts: ' + destination);
}
module.exports = { compileLaunch };
