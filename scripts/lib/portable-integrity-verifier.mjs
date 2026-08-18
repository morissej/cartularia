import { verifyAuditChain } from './audit-verifier.mjs';
import { canonicalize, sha256Bytes, sha256Digest } from './canonical-json.mjs';
import { verifyMerkleProof } from './merkle.mjs';
import { verifyPortableRfc3161Receipt } from './rfc3161-verifier.mjs';
import {
  OpenTimestampsPublicAnchorAdapter,
  publicAnchorPayloadDigest,
  toPublicAnchorPayload,
} from './trust-adapters.mjs';

const defaultVerifyOpenTimestamps = async ({ payloadDigest, proofBase64 }) => {
  const result = await new OpenTimestampsPublicAnchorAdapter().anchor({ payloadDigest, proofBase64 });
  return {
    valid: result.status === 'anchored',
    status: result.status,
    blockHeight: result.blockHeight ?? null,
    confirmedAtIso: result.confirmedAtIso ?? null,
  };
};

const verifyManifestAndRecords = (bundle, errors) => {
  const records = Array.isArray(bundle?.records) ? bundle.records : [];
  const manifest = bundle?.manifest;
  if (!manifest || manifest.exportVersion !== 'cartularia-portable-1') {
    errors.push({ code: 'unsupported_format' });
    return records;
  }
  const { manifestDigest, ...manifestCore } = manifest;
  if (sha256Digest(manifestCore) !== manifestDigest) errors.push({ code: 'manifest_digest_mismatch' });
  for (const record of records) {
    if (sha256Digest(record.data) !== record.digest) {
      errors.push({ code: 'record_digest_mismatch', recordKey: record.recordKey });
    }
  }
  const computedRecordDigest = sha256Digest(
    [...records]
      .sort((left, right) => left.recordKey.localeCompare(right.recordKey))
      .map(({ recordKey, digest }) => ({ recordKey, digest })),
  );
  if (computedRecordDigest !== manifest.recordDigest) errors.push({ code: 'record_set_digest_mismatch' });
  return records;
};

export const verifyPortableCartularyExport = async (bundle, {
  verifyRfc3161Receipt = verifyPortableRfc3161Receipt,
  verifyOpenTimestamps = defaultVerifyOpenTimestamps,
} = {}) => {
  const errors = [];
  let records;
  try {
    records = verifyManifestAndRecords(bundle, errors);
  } catch {
    return { valid: false, errors: [{ code: 'malformed_export' }] };
  }
  const manifest = bundle?.manifest || {};
  const auditEvents = records
    .filter((record) => record.collectionName === 'auditEvents')
    .map((record) => record.data);
  const chain = verifyAuditChain({
    events: auditEvents,
    integrityHead: manifest.integrityHead,
    integritySequence: manifest.integritySequence,
  });
  if (!chain.valid) errors.push(...chain.errors.map((error) => ({ ...error, scope: 'audit_chain' })));

  const knownHeads = new Set(auditEvents.map((event) => event.hash));
  const proofRecords = records.filter((record) => record.collectionName === 'integrityProofs');
  if (proofRecords.length === 0) errors.push({ code: 'integrity_proof_missing' });
  const verifiedProofs = [];

  for (const record of proofRecords) {
    const proofErrors = [];
    const proof = record.data || {};
    const batch = proof.batch || {};
    const inclusion = proof.inclusion || {};
    if (batch.algorithm !== 'sha256-binary-merkle-v1') proofErrors.push({ code: 'unsupported_merkle_algorithm' });
    if (batch.canonicalizationVersion !== 'jcs-1') proofErrors.push({ code: 'unsupported_canonicalization' });
    const expectedLeafHash = sha256Digest({
      cartularyId: inclusion.cartularyId,
      revision: inclusion.sourceRevision,
      integrityHead: inclusion.integrityHead,
    });
    if (inclusion.cartularyId !== manifest.cartularyId) proofErrors.push({ code: 'cartulary_mismatch' });
    if (expectedLeafHash !== inclusion.leafHash) proofErrors.push({ code: 'leaf_hash_mismatch' });
    if (!knownHeads.has(inclusion.integrityHead)) proofErrors.push({ code: 'included_head_unknown' });
    if (!verifyMerkleProof({
      leafHash: inclusion.leafHash,
      proof: Array.isArray(inclusion.proof) ? inclusion.proof : [],
      merkleRoot: batch.merkleRoot,
    })) proofErrors.push({ code: 'merkle_inclusion_invalid' });

    const timestampReceipts = Array.isArray(proof.timestampReceipts) ? proof.timestampReceipts : [];
    if (timestampReceipts.length === 0) proofErrors.push({ code: 'rfc3161_receipt_missing' });
    for (const receipt of timestampReceipts) {
      if (receipt.protocol !== 'rfc3161-v1') proofErrors.push({ code: 'rfc3161_receipt_required' });
      if (receipt.digest !== batch.merkleRoot) proofErrors.push({ code: 'rfc3161_root_mismatch' });
      const verification = await verifyRfc3161Receipt(receipt);
      if (!verification.valid) proofErrors.push(...verification.errors);
    }

    const payload = toPublicAnchorPayload(batch);
    const payloadDigest = publicAnchorPayloadDigest(payload);
    const anchors = Array.isArray(proof.publicAnchors) ? proof.publicAnchors : [];
    const anchored = anchors.find((anchor) => anchor.provider === 'opentimestamps');
    if (!anchored) {
      proofErrors.push({ code: 'opentimestamps_proof_missing' });
    } else if (anchored.status !== 'anchored') {
      proofErrors.push({ code: 'opentimestamps_pending_confirmation' });
    } else {
      if (anchored.payloadDigest !== payloadDigest) proofErrors.push({ code: 'public_payload_digest_mismatch' });
      try {
        if (sha256Bytes(Buffer.from(anchored.proofBase64, 'base64')) !== anchored.proofSha256) {
          proofErrors.push({ code: 'opentimestamps_proof_digest_mismatch' });
        }
      } catch {
        proofErrors.push({ code: 'opentimestamps_proof_malformed' });
      }
      if (anchored.canonicalPayload && anchored.canonicalPayload !== canonicalize(payload)) {
        proofErrors.push({ code: 'public_payload_mismatch' });
      }
      const verification = await verifyOpenTimestamps({
        payloadDigest,
        proofBase64: anchored.proofBase64,
      });
      if (!verification.valid) proofErrors.push({ code: 'opentimestamps_verification_failed' });
      verifiedProofs.push({
        batchId: batch.batchId,
        blockHeight: verification.blockHeight ?? anchored.blockHeight ?? null,
        existedBeforeIso: verification.confirmedAtIso ?? anchored.confirmedAtIso ?? null,
      });
    }
    errors.push(...proofErrors.map((error) => ({ ...error, batchId: batch.batchId || record.documentId })));
  }

  return {
    valid: errors.length === 0,
    cartularyId: manifest.cartularyId || null,
    auditEventCount: auditEvents.length,
    integrityProofCount: proofRecords.length,
    verifiedProofs,
    errors,
  };
};
