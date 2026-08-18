import { createHash } from 'node:crypto';
import { canonicalize, sha256Digest } from './canonical-json.mjs';
import { verifyPortableCartularyExport } from './portable-integrity-verifier.mjs';
import { verifyPortableRfc3161Receipts } from './rfc3161-verifier.mjs';

const ZERO_HASH = `sha256:${'0'.repeat(64)}`;

const decodeBase64 = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new TypeError('base64 invalide');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new TypeError('base64 non canonique');
  return bytes;
};

const bytesDigest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const eventPayload = (event) => ({
  id: event.id,
  cartularyId: event.cartularyId,
  timestamp: event.timestamp,
  action: event.action,
  actorId: event.actorId,
  details: event.details,
  resource: event.resource,
  revision: event.revision,
  beforeDigest: event.beforeDigest,
  afterDigest: event.afterDigest,
  previousHash: event.previousHash,
  sequence: event.sequence,
  version: event.version,
  canonicalizationVersion: event.canonicalizationVersion,
  requestId: event.requestId,
});

const hashEvent = (event) => sha256Digest({ previousHash: event.previousHash, event: eventPayload(event) });

const buildMerkleRoot = (hashes) => {
  if (hashes.length === 0) return ZERO_HASH;
  let layer = [...hashes];
  while (layer.length > 1) {
    const next = [];
    for (let index = 0; index < layer.length; index += 2) {
      next.push(sha256Digest({ left: layer[index], right: layer[index + 1] ?? layer[index] }));
    }
    layer = next;
  }
  return layer[0];
};

const classifyLegacyEvents = (events) => {
  if (!Array.isArray(events) || events.length === 0) return 'legacy_unverifiable';
  if (events.every((event) => event?.version === '2.0')) {
    let previousHash = ZERO_HASH;
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (event.sequence !== index + 1 || event.previousHash !== previousHash || event.hash !== hashEvent(event)) {
        return 'legacy_broken';
      }
      previousHash = event.hash;
    }
    return 'legacy_valid';
  }
  const first = events[0];
  if (
    typeof first?.hash !== 'string'
    || typeof first.timestamp !== 'string'
    || typeof first.action !== 'string'
    || typeof first.actorId !== 'string'
    || typeof first.version !== 'string'
  ) return 'legacy_unverifiable';
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1];
    const current = events[index];
    if (
      typeof previous?.hash !== 'string'
      || typeof current?.hash !== 'string'
      || typeof current?.previousHash !== 'string'
      || current.previousHash !== previous.hash
      || current.sequence !== index
    ) return 'legacy_broken';
    if (
      typeof current.timestamp !== 'string'
      || typeof current.action !== 'string'
      || typeof current.actorId !== 'string'
      || typeof current.version !== 'string'
    ) return 'legacy_unverifiable';
    const payload = current.version === '1.1'
      ? `${current.previousHash}|${current.action}|${current.actorId}|${current.details ?? ''}|${current.timestamp}|${current.sequence}|${current.version}`
      : `${current.previousHash}|${current.action}|${current.actorId}|${current.timestamp}|${current.sequence}|${current.version}`;
    const digest = createHash('sha256').update(payload).digest('hex');
    if (current.hash !== digest) return 'legacy_broken';
  }
  return 'legacy_unverifiable';
};

export const verifyLocalIntegrityBundle = (bundle) => {
  const errors = [];
  if (bundle?.formatVersion !== 'cartularia-integrity-export-v1') {
    return { valid: false, errors: [{ code: 'unsupported_format' }] };
  }
  if (bundle.canonicalizationVersion !== 'jcs-1') errors.push({ code: 'unsupported_canonicalization' });
  const events = Array.isArray(bundle.events) ? bundle.events : [];
  let previousHash = ZERO_HASH;
  let lastRevision = 0;
  let lastContentDigest = ZERO_HASH;
  events.forEach((event, index) => {
    if (!event || typeof event !== 'object') {
      errors.push({ code: 'malformed_event', sequence: index + 1 });
      return;
    }
    const revisionIsValid = Number.isInteger(event.revision) && event.revision >= 0;
    if (event.sequence !== index + 1) errors.push({ code: 'sequence_gap', sequence: event.sequence });
    if (event.previousHash !== previousHash) errors.push({ code: 'previous_hash_mismatch', sequence: event.sequence });
    if (!revisionIsValid) errors.push({ code: 'malformed_event', sequence: event.sequence });
    else if (event.revision < lastRevision) errors.push({ code: 'revision_regression', sequence: event.sequence });
    try {
      if (event.hash !== hashEvent(event)) errors.push({ code: 'event_hash_mismatch', sequence: event.sequence });
    } catch {
      errors.push({ code: 'malformed_event', sequence: event.sequence });
    }
    if (revisionIsValid && event.revision > lastRevision) lastContentDigest = event.afterDigest;
    if (revisionIsValid) lastRevision = Math.max(lastRevision, event.revision);
    if (typeof event.hash === 'string') previousHash = event.hash;
  });
  if (bundle.integrityHead !== previousHash) errors.push({ code: 'head_mismatch' });
  if (bundle.integritySequence !== events.length) errors.push({ code: 'root_sequence_mismatch' });
  if (bundle.revision !== lastRevision) errors.push({ code: 'revision_mismatch' });
  if (bundle.revision > 0 && bundle.contentDigest !== lastContentDigest) errors.push({ code: 'content_digest_mismatch' });
  const eventHashesAreValid = events.every((event) => event && typeof event.hash === 'string');
  const merkleRoot = eventHashesAreValid ? buildMerkleRoot(events.map((event) => event.hash)) : ZERO_HASH;
  if (bundle.merkleRoot !== merkleRoot) errors.push({ code: 'merkle_root_mismatch' });
  if (bundle.snapshot !== undefined) {
    try {
      if (sha256Digest(bundle.snapshot) !== bundle.contentDigest) errors.push({ code: 'snapshot_digest_mismatch' });
    } catch {
      errors.push({ code: 'snapshot_malformed' });
    }
  }
  for (const legacy of Array.isArray(bundle.legacyBundles) ? bundle.legacyBundles : []) {
    try {
      if (sha256Digest({ events: legacy.events, receipts: legacy.receipts }) !== legacy.bundleDigest) {
        errors.push({ code: 'legacy_bundle_digest_mismatch' });
      }
      if (classifyLegacyEvents(legacy.events) !== legacy.status) errors.push({ code: 'legacy_status_mismatch' });
    } catch {
      errors.push({ code: 'legacy_bundle_digest_mismatch' });
      errors.push({ code: 'legacy_status_mismatch' });
    }
  }
  const knownMerkleRoots = eventHashesAreValid
    ? new Set(events.map((_, index) => buildMerkleRoot(events.slice(0, index + 1).map((event) => event.hash))))
    : new Set();
  for (const receipt of Array.isArray(bundle.receipts) ? bundle.receipts : []) {
    try {
      if (receipt.protocol === 'local-timestamp-fixture-v2') {
        const expected = sha256Digest({
          merkleRoot: receipt.merkleRoot,
          timestamp: receipt.timestamp,
          protocol: receipt.protocol,
        });
        if (receipt.tokenDigest !== expected) errors.push({ code: 'timestamp_token_mismatch' });
      } else if (receipt.protocol === 'rfc3161-v1') {
        const token = decodeBase64(receipt.tokenBase64);
        const request = decodeBase64(receipt.requestBase64);
        const qualificationIsValid = receipt.qualified === true
          ? receipt.verificationStatus === 'qualified_eidas'
            && receipt.qualificationStatus === 'QTSA'
            && Boolean(receipt.validationEvidence?.trustedListServiceId)
            && /^sha256:[a-f0-9]{64}$/.test(receipt.validationEvidence?.validationReportDigest || '')
          : receipt.verificationStatus === 'trusted_rfc3161' && receipt.qualificationStatus !== 'QTSA';
        if (
          receipt.digest !== receipt.merkleRoot
          || bytesDigest(token) !== receipt.tokenSha256
          || bytesDigest(request) !== receipt.requestSha256
          || receipt.signatureVerified !== true
          || receipt.chainVerified !== true
          || receipt.nonceMatched !== true
          || receipt.hashAlgorithm !== 'sha256'
          || !qualificationIsValid
        ) errors.push({ code: 'timestamp_token_mismatch' });
      } else {
        errors.push({ code: 'malformed_receipt' });
      }
      if (!knownMerkleRoots.has(receipt.merkleRoot)) errors.push({ code: 'timestamp_root_unknown' });
    } catch {
      errors.push({ code: 'malformed_receipt' });
    }
  }
  return {
    valid: errors.length === 0,
    eventCount: events.length,
    revision: bundle.revision,
    contentDigest: bundle.contentDigest,
    integrityHead: previousHash,
    merkleRoot,
    legacyStatuses: (bundle.legacyBundles ?? []).map((legacy) => legacy.status),
    canonicalPayload: (() => {
      try {
        return canonicalize({
          cartularyId: bundle.cartularyId,
          revision: bundle.revision,
          contentDigest: bundle.contentDigest,
          integrityHead: bundle.integrityHead,
          merkleRoot: bundle.merkleRoot,
        });
      } catch {
        return null;
      }
    })(),
    errors,
  };
};

export const verifyIndependentIntegrityBundle = async (bundle, options = {}) => {
  if (bundle?.manifest?.exportVersion === 'cartularia-portable-1') {
    return verifyPortableCartularyExport(bundle, options);
  }
  const localResult = verifyLocalIntegrityBundle(bundle);
  const timestampResult = await verifyPortableRfc3161Receipts(bundle);
  return {
    ...localResult,
    valid: localResult.valid && timestampResult.valid,
    externalTimestamps: timestampResult,
    errors: [...localResult.errors, ...timestampResult.errors],
  };
};
