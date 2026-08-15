import { sha256Digest } from './canonical-json.mjs';

export const ZERO_AUDIT_HASH = `sha256:${'0'.repeat(64)}`;

const SUPPORTED_CANONICALIZATION = new Set(['jcs-1', 'sorted-json-1']);

export const canonicalAuditPayload = (event) => ({
  eventId: event.eventId,
  cartularyId: event.cartularyId,
  sequence: event.sequence,
  occurredAt: event.occurredAtIso,
  actor: event.actor,
  action: event.action,
  resource: event.resource,
  beforeDigest: event.beforeDigest,
  afterDigest: event.afterDigest,
  previousEventHash: event.previousEventHash,
  canonicalizationVersion: event.canonicalizationVersion,
  requestId: event.requestId,
});

export const verifyAuditChain = ({ events, integrityHead, integritySequence }) => {
  const orderedEvents = [...events].sort((left, right) => left.sequence - right.sequence);
  const errors = [];
  let expectedPreviousHash = ZERO_AUDIT_HASH;

  for (let index = 0; index < orderedEvents.length; index += 1) {
    const event = orderedEvents[index];
    const expectedSequence = index + 1;
    if (event.sequence !== expectedSequence) {
      errors.push({ code: 'sequence_gap', eventId: event.eventId, expected: expectedSequence, actual: event.sequence });
    }
    if (!SUPPORTED_CANONICALIZATION.has(event.canonicalizationVersion)) {
      errors.push({ code: 'unsupported_canonicalization', eventId: event.eventId });
      continue;
    }
    if (event.previousEventHash !== expectedPreviousHash) {
      errors.push({ code: 'previous_hash_mismatch', eventId: event.eventId });
    }
    const payload = canonicalAuditPayload(event);
    const recomputedHash = sha256Digest({ previousEventHash: event.previousEventHash, event: payload });
    if (event.hash !== recomputedHash) {
      errors.push({ code: 'event_hash_mismatch', eventId: event.eventId });
    }
    expectedPreviousHash = event.hash;
  }

  const computedHead = orderedEvents.at(-1)?.hash ?? ZERO_AUDIT_HASH;
  if (integrityHead !== computedHead) errors.push({ code: 'head_mismatch' });
  if (Number(integritySequence) !== orderedEvents.length) errors.push({ code: 'root_sequence_mismatch' });

  return {
    valid: errors.length === 0,
    eventCount: orderedEvents.length,
    head: computedHead,
    errors,
  };
};
