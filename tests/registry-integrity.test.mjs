import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  computeRegistryAuditEventHash,
  verifyRegistryAuditChain,
} from '../src/utils/auditChain.ts';
import { REGISTRY_AUDIT_ACTION_LABELS, auditActionLabel } from '../src/features/registry/registryIntegrity.ts';

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

test('la page Preuves du Registre démo rend en français chaque action écrite par les scripts démo', () => {
  assert.equal(auditActionLabel('cartulary.demo.created'), 'Cartulaire de démonstration créé');
  assert.equal(auditActionLabel('cartulary.demo.data_repaired'), 'Données de démonstration réparées');
  assert.equal(auditActionLabel('cartulary.demo.enriched'), 'Données de démonstration enrichies');
  assert.equal(auditActionLabel('publication.published'), 'Publication réalisée');
  // Toute action émise par le seed, la réparation v1/v2 ou la publication démo doit avoir un libellé FR :
  // le repli « Cartulary · Demo · Created » ne doit jamais atteindre le visiteur.
  const scripts = ['../scripts/seed-demo-account.mjs', '../scripts/lib/demo-data-repair.mjs', '../scripts/lib/demo-publication-command.mjs']
    .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'));
  const actions = new Set(scripts.flatMap((source) => [...source.matchAll(/action: '([a-z_.]+)'/g)].map((match) => match[1])));
  assert.ok(actions.has('cartulary.demo.created') && actions.has('cartulary.demo.enriched') && actions.has('publication.published'));
  for (const action of actions) {
    assert.ok(Object.hasOwn(REGISTRY_AUDIT_ACTION_LABELS, action), `libellé manquant pour ${action}`);
    assert.doesNotMatch(auditActionLabel(action), /·|^[A-Z][a-z]+ [A-Z]/, `libellé technique pour ${action}`);
  }
});
