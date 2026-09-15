import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  deriveAuthoritativeIntegrityLevel,
  deriveLocalWorkJournalLevel,
} from '../src/domain/integrityPresentation.ts';
import {
  computeRegistryAuditEventHash,
  verifyRegistryAuditChain,
} from '../src/utils/auditChain.ts';
import { IntegrityJournal } from '../src/utils/integrityJournal.ts';

const ZERO_HASH = `sha256:${'0'.repeat(64)}`;

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const makeServerEvent = async () => {
  const event = {
    eventId: 'evt_server_convergence_001',
    cartularyId: 'cart_convergence',
    sequence: 1,
    occurredAtIso: '2026-08-17T12:00:00.000Z',
    actor: { role: 'legal_owner', uid: 'owner' },
    action: 'cartulary.created',
    resource: { id: 'cart_convergence', type: 'cartulary' },
    beforeDigest: null,
    afterDigest: `sha256:${'a'.repeat(64)}`,
    previousEventHash: ZERO_HASH,
    canonicalizationVersion: 'jcs-1',
    requestId: 'request_server_convergence_001',
    hash: '',
  };
  event.hash = await computeRegistryAuditEventHash(event);
  return event;
};

test('le statut principal est dérivé de la preuve serveur sans promouvoir le cache local', () => {
  assert.equal(deriveAuthoritativeIntegrityLevel({ authenticated: false, loadState: 'idle' }), 'sign_in_required');
  assert.equal(deriveAuthoritativeIntegrityLevel({ authenticated: true, loadState: 'error' }), 'unavailable');
  assert.equal(deriveAuthoritativeIntegrityLevel({ authenticated: true, loadState: 'ready', verificationValid: false }), 'broken');
  assert.equal(deriveAuthoritativeIntegrityLevel({ authenticated: true, loadState: 'ready', verificationValid: true }), 'chain_only');
  assert.equal(deriveAuthoritativeIntegrityLevel({ authenticated: true, loadState: 'ready', verificationValid: true, timestampStatus: 'trusted_rfc3161' }), 'timestamped');
  assert.equal(deriveAuthoritativeIntegrityLevel({ authenticated: true, loadState: 'ready', verificationValid: true, publicAnchoringStatus: 'pending_confirmation' }), 'anchor_pending');
  assert.equal(deriveAuthoritativeIntegrityLevel({ authenticated: true, loadState: 'ready', verificationValid: true, publicAnchoringStatus: 'failed' }), 'anchor_failed');
  assert.equal(deriveAuthoritativeIntegrityLevel({ authenticated: true, loadState: 'ready', verificationValid: true, publicAnchoringStatus: 'anchored' }), 'anchored');
  assert.equal(deriveLocalWorkJournalLevel({ verificationValid: true, hasExternalTimestamp: false }), 'local_only');
  assert.equal(deriveLocalWorkJournalLevel({ verificationValid: true, hasExternalTimestamp: true }), 'timestamped_local');
});

test('une altération de la chaîne serveur est détectée et produit un état de rupture', async () => {
  const event = await makeServerEvent();
  const valid = await verifyRegistryAuditChain([event], event.hash, 1);
  const altered = { ...event, action: 'cartulary.rewritten' };
  const invalid = await verifyRegistryAuditChain([altered], event.hash, 1);
  assert.equal(valid.valid, true);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => error.startsWith('event_hash:')));
  assert.equal(deriveAuthoritativeIntegrityLevel({
    authenticated: true,
    loadState: 'ready',
    verificationValid: invalid.valid,
  }), 'broken');
});

test('un journal local historique est archivé une seule fois et n’est jamais réécrit au rejeu', async () => {
  const storage = new MemoryStorage();
  storage.setItem('cartularia_audit_events', JSON.stringify([{
    id: 'legacy-one',
    sequence: 0,
    hash: 'legacy-placeholder',
    previousHash: '0',
    timestamp: '2026-08-01T00:00:00.000Z',
    action: 'INITIALIZE_CARTULARY',
    actorId: 'system',
    details: 'Journal local historique',
    version: '1.0',
  }]));
  const first = new IntegrityJournal({ cartularyId: 'cart_convergence_legacy', storage });
  await first.ready();
  const firstState = storage.getItem('cartularia-integrity-v2:cart_convergence_legacy');
  const firstEvents = first.getEvents();
  assert.equal(firstEvents.length, 1);
  assert.equal(firstEvents[0].action, 'legacy.journal.imported');
  assert.deepEqual(first.getProofState().legacyStatuses, ['legacy_unverifiable']);

  const replay = new IntegrityJournal({ cartularyId: 'cart_convergence_legacy', storage });
  await replay.ready();
  assert.equal(storage.getItem('cartularia-integrity-v2:cart_convergence_legacy'), firstState);
  assert.equal(replay.getEvents().length, 1);
  assert.equal(replay.getEvents()[0].hash, firstEvents[0].hash);
  assert.deepEqual(replay.getProofState().legacyStatuses, ['legacy_unverifiable']);
});

test('le vocabulaire réserve le Sceau à la projection publique et nomme clairement le repli local', () => {
  const auditPanel = readFileSync(new URL('../src/components/AuditPanel.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const registry = readFileSync(new URL('../src/features/registry/RegistryIntegrity.tsx', import.meta.url), 'utf8');
  assert.match(auditPanel, /Preuve serveur du Cartulaire/);
  assert.match(auditPanel, /Carnet local de travail/);
  assert.match(auditPanel, /ne remplace jamais la preuve serveur/);
  assert.doesNotMatch(auditPanel, /Statut Sceau/);
  assert.doesNotMatch(auditPanel, /Ancrage blockchain public : différé/);
  assert.doesNotMatch(auditPanel, /Exporter la preuve portable/);
  assert.match(auditPanel, /Exporter le carnet local/);
  // V5 P-D1 : plus de tiroir technique en production ; l'export est rangé avec le carnet, la migration
  // n'est proposée que sous une rupture constatée, la suppression est isolée dans sa propre section.
  assert.doesNotMatch(auditPanel, /Simulation technique|Technical Simulation|simulateTampering|createLocalTestTimestamp|Falsifier|fixture locale/);
  assert.match(auditPanel, /Suppression des données/);
  assert.match(auditPanel, /Migrer la chaîne rompue/);
  // V5 relecture (R-11) : la documentation ne présente plus le tiroir comme existant (ADR-024 amendée, vague 4 annotée).
  const adr = readFileSync(new URL('../docs/ADR-024-convergence-preuve-serveur-et-carnet-local.md', import.meta.url), 'utf8');
  const wave4 = readFileSync(new URL('../docs/CORRECTIVE_WAVE_4_TIMESTAMPING.md', import.meta.url), 'utf8');
  assert.match(adr, /## Amendement du 2026-09-15 \(V5, décision P-D1\)/);
  assert.doesNotMatch(adr, /: uniquement le tiroir qui falsifie/);
  assert.match(wave4, /Note du 2026-09-15 \(V5, P-D1\) : ce tiroir n’existe plus/);
  assert.doesNotMatch(wave4, /est conservée uniquement dans le tiroir/);
  assert.match(app, /Le Sceau public identifie une publication émise par le serveur/);
  assert.match(app, /Aucun de ces indicateurs ne remplace l’examen physique ni la conclusion d’un expert/);
  assert.match(registry, /Chaîne serveur & preuves/);
  assert.doesNotMatch(registry, /Confiance blockchain-ready/);
});
