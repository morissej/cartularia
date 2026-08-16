import type { RegistryAuditEvent, RegistryAuditVerification } from '../domain/integrity.ts';

const ZERO_HASH = `sha256:${'0'.repeat(64)}`;
const SUPPORTED_CANONICALIZATION = new Set(['jcs-1', 'sorted-json-1']);

const normalizeCanonicalValue = (value: unknown, stack = new Set<object>()): unknown => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Valeur numérique non canonique.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((entry) => normalizeCanonicalValue(entry, stack));
  if (typeof value !== 'object') throw new TypeError('Valeur non JSON dans le journal.');
  if (stack.has(value)) throw new TypeError('Structure cyclique dans le journal.');
  stack.add(value);
  try {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
      key,
      normalizeCanonicalValue((value as Record<string, unknown>)[key], stack),
    ]));
  } finally {
    stack.delete(value);
  }
};

const canonicalize = (value: unknown) => JSON.stringify(normalizeCanonicalValue(value));

const sha256Digest = async (value: unknown) => {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : canonicalize(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

const canonicalAuditPayload = (event: RegistryAuditEvent) => ({
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

export const computeRegistryAuditEventHash = (event: RegistryAuditEvent) => sha256Digest({
  previousEventHash: event.previousEventHash,
  event: canonicalAuditPayload(event),
});

export const verifyRegistryAuditChain = async (
  events: RegistryAuditEvent[],
  integrityHead: string,
  integritySequence: number,
): Promise<RegistryAuditVerification> => {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  const errors: string[] = [];
  let expectedPreviousHash = ZERO_HASH;

  for (let index = 0; index < ordered.length; index += 1) {
    const event = ordered[index];
    if (event.sequence !== index + 1) errors.push(`sequence:${event.eventId}`);
    if (!SUPPORTED_CANONICALIZATION.has(event.canonicalizationVersion)) {
      errors.push(`canonicalization:${event.eventId}`);
      continue;
    }
    if (event.previousEventHash !== expectedPreviousHash) errors.push(`previous_hash:${event.eventId}`);
    const recomputedHash = await computeRegistryAuditEventHash(event);
    if (event.hash !== recomputedHash) errors.push(`event_hash:${event.eventId}`);
    expectedPreviousHash = event.hash;
  }

  const computedHead = ordered.at(-1)?.hash || ZERO_HASH;
  if (integrityHead !== computedHead) errors.push('head');
  if (integritySequence !== ordered.length) errors.push('sequence_count');
  return { valid: errors.length === 0, eventCount: ordered.length, computedHead, errors };
};
