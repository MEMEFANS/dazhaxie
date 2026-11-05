import { encodeAbiParameters, getAddress, keccak256, type Hex } from "viem";

/**
 * 与 contracts/CaBiMerkleClaimPool.sol 完全一致的 Merkle 计算：
 * leaf = keccak256(abi.encode(address account, uint256 cumulativeAmount, uint256 epoch))
 * node = keccak256(sorted(左, 右))，排序按 bytes32 数值比较。
 */
export interface MerkleEntry {
  address: string;
  amount: bigint;
}

export interface MerkleTree {
  root: Hex;
  /** key 为小写地址；值为原始 bytes32 数组 */
  proofs: Map<string, Hex[]>;
  leaves: Map<string, Hex>;
}

export function claimLeaf(epoch: bigint, address: string, amount: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }],
      [getAddress(address), amount, epoch],
    ),
  );
}

function hashPair(left: Hex, right: Hex): Hex {
  return BigInt(left) <= BigInt(right)
    ? keccak256(`${left}${right.slice(2)}` as Hex)
    : keccak256(`${right}${left.slice(2)}` as Hex);
}

export function buildMerkleTree(entries: MerkleEntry[], epoch: bigint): MerkleTree {
  if (!entries.length) throw new Error("Merkle 树至少需要一个地址");
  const normalized = entries.map(entry => ({ address: getAddress(entry.address), amount: entry.amount }));
  const seen = new Set<string>();
  for (const entry of normalized) {
    const key = entry.address.toLowerCase();
    if (seen.has(key)) throw new Error(`Merkle 树存在重复地址：${entry.address}`);
    seen.add(key);
  }
  normalized.sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));

  const leaves = normalized.map(entry => claimLeaf(epoch, entry.address, entry.amount));
  const layers: Hex[][] = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const current = layers[layers.length - 1];
    const next: Hex[] = [];
    for (let i = 0; i < current.length; i += 2) {
      next.push(i + 1 === current.length ? current[i] : hashPair(current[i], current[i + 1]));
    }
    layers.push(next);
  }

  const proofs = new Map<string, Hex[]>();
  normalized.forEach((entry, index) => {
    const proof: Hex[] = [];
    let cursor = index;
    for (let level = 0; level < layers.length - 1; level += 1) {
      const sibling = cursor ^ 1;
      if (sibling < layers[level].length) proof.push(layers[level][sibling]);
      cursor = Math.floor(cursor / 2);
    }
    proofs.set(entry.address.toLowerCase(), proof);
  });

  return { root: layers[layers.length - 1][0], proofs, leaves: new Map(normalized.map((entry, index) => [entry.address.toLowerCase(), leaves[index]])) };
}

export function verifyMerkleProof(proof: readonly Hex[], root: Hex, leaf: Hex): boolean {
  let computed = leaf;
  for (const sibling of proof) computed = hashPair(computed, sibling);
  return computed.toLowerCase() === root.toLowerCase();
}
