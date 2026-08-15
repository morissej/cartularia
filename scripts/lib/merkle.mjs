import { CANONICALIZATION_VERSION, sha256Digest } from './canonical-json.mjs';

const parentHash = (left, right) => sha256Digest({ left, right });

export const buildMerkleBatch = (cartularyHeads) => {
  if (!Array.isArray(cartularyHeads) || cartularyHeads.length === 0) {
    throw new TypeError('Un lot Merkle doit contenir au moins une tête de Cartulaire.');
  }
  const sorted = [...cartularyHeads].sort((left, right) => left.cartularyId.localeCompare(right.cartularyId));
  if (new Set(sorted.map((item) => item.cartularyId)).size !== sorted.length) {
    throw new TypeError('Un Cartulaire ne peut apparaître qu’une fois dans un lot Merkle.');
  }
  const leaves = sorted.map((item, index) => ({
    ...item,
    index,
    leafHash: sha256Digest({
      cartularyId: item.cartularyId,
      revision: item.revision,
      integrityHead: item.integrityHead,
    }),
    proof: [],
  }));

  let layer = leaves.map((leaf) => ({ hash: leaf.leafHash, leafIndexes: [leaf.index] }));
  while (layer.length > 1) {
    const nextLayer = [];
    for (let index = 0; index < layer.length; index += 2) {
      const left = layer[index];
      const right = layer[index + 1] ?? left;
      for (const leafIndex of left.leafIndexes) leaves[leafIndex].proof.push({ side: 'right', hash: right.hash });
      if (right !== left) {
        for (const leafIndex of right.leafIndexes) leaves[leafIndex].proof.push({ side: 'left', hash: left.hash });
      }
      nextLayer.push({
        hash: parentHash(left.hash, right.hash),
        leafIndexes: right === left ? [...left.leafIndexes] : [...left.leafIndexes, ...right.leafIndexes],
      });
    }
    layer = nextLayer;
  }

  return {
    algorithm: 'sha256-binary-merkle-v1',
    canonicalizationVersion: CANONICALIZATION_VERSION,
    merkleRoot: layer[0].hash,
    leafCount: leaves.length,
    leaves,
  };
};

export const verifyMerkleProof = ({ leafHash, proof, merkleRoot }) => {
  let current = leafHash;
  for (const step of proof) {
    if (step.side === 'left') current = parentHash(step.hash, current);
    else if (step.side === 'right') current = parentHash(current, step.hash);
    else return false;
  }
  return current === merkleRoot;
};
