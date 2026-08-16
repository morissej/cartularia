import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeRegistryAuditEventHash,
  verifyRegistryAuditChain,
} from '../src/utils/auditChain.ts';

const ZERO_HASH = `sha256:${'0'.repeat(64)}`;

const makeEvent = async ({ sequence, previousEventHash, action }) => {
  const event = {
    eventId: `evt_${sequence}`,
    cartularyId: 'cart_iwc',
    sequence,
    occurredAtIso: `2026-08-14T0${sequence}:00:00.000Z`,
    actor: { role: 'legal_owner', uid: 'owner' },
    action,
    resource: { id: 'cart_iwc', type: 'cartulary' },
    beforeDigest: sequence === 1 ? null : previousEventHash,
    afterDigest: `sha256:after_${sequence}`,
    previousEventHash,
    canonicalizationVersion: 'jcs-1',
    requestId: `request_${sequence}`,
    hash: '',
  };
  event.hash = await computeRegistryAuditEventHash(event);
  return event;
};

test('la vue Registre recalcule une chaîne de Cartulaire valide', async () => {
  const first = await makeEvent({ sequence: 1, previousEventHash: ZERO_HASH, action: 'cartulary.created' });
  const second = await makeEvent({ sequence: 2, previousEventHash: first.hash, action: 'registry.projected' });
  const result = await verifyRegistryAuditChain([second, first], second.hash, 2);
  assert.equal(result.valid, true);
  assert.equal(result.eventCount, 2);
  assert.deepEqual(result.errors, []);
});

test('une altération reste détectable sans réécrire le journal', async () => {
  const first = await makeEvent({ sequence: 1, previousEventHash: ZERO_HASH, action: 'cartulary.created' });
  const altered = { ...first, action: 'cartulary.deleted' };
  const result = await verifyRegistryAuditChain([altered], first.hash, 1);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.startsWith('event_hash:')));
  assert.equal(altered.hash, first.hash);
});
