import { CANONICALIZATION_VERSION, canonicalize, sha256Bytes, sha256Digest } from './canonical-json.mjs';

export class DeterministicTimestampAdapter {
  constructor({ provider = 'cartularia-test-tsa' } = {}) {
    this.provider = provider;
  }

  async issue({ digest, requestId, issuedAt = new Date().toISOString() }) {
    const tokenPayload = {
      protocol: 'rfc3161-adapter-v1',
      provider: this.provider,
      qualified: false,
      digest,
      requestId,
      issuedAt,
      canonicalizationVersion: CANONICALIZATION_VERSION,
      fixture: true,
    };
    const token = Buffer.from(canonicalize(tokenPayload), 'utf8');
    return {
      receiptId: `tsr_${sha256Digest(tokenPayload).slice(7, 31)}`,
      ...tokenPayload,
      tokenBase64: token.toString('base64'),
      tokenSha256: sha256Bytes(token),
      verificationStatus: 'test_fixture',
    };
  }
}

export class DeferredPublicAnchorAdapter {
  async anchor() {
    const error = new Error('L’ancrage sur une chaîne publique est différé par décision produit.');
    error.code = 'anchoring_deferred';
    throw error;
  }
}

export const toPublicAnchorPayload = (batch) => ({
  protocol: 'cartularia-public-anchor-v1',
  algorithm: batch.algorithm,
  canonicalizationVersion: batch.canonicalizationVersion,
  merkleRoot: batch.merkleRoot,
  leafCount: batch.leafCount,
});
