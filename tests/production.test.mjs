import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { buildCarDemoImportBundle, CAR_DEMO_CARTULARY_ID } from '../src/migrations/carDemoImport.ts';
import { buildIwcImportBundle, IWC_CARTULARY_ID } from '../src/migrations/iwcImport.ts';
import {
  createPilotBackup,
  MemoryObjectStoreAdapter,
  restorePilotBackup,
  validateRestoredPilot,
  verifyBackupBundle,
} from '../scripts/lib/backup-command.mjs';
import { importCartularyBundle } from '../scripts/lib/import-cartulary-command.mjs';
import { createStructuredLogger } from '../scripts/lib/observability.mjs';
import {
  auditProjectionPrivacy,
  estimateMonthlyCost,
  evaluateProductionReadiness,
  measureFirestoreFootprint,
  runFirestoreLoadProbe,
  scanRepositoryForCredentials,
} from '../scripts/lib/production-readiness.mjs';

const projectId = 'cartularia-wave7-test';
const restoreProjectId = 'cartularia-wave7-restore-test';
const [host = '127.0.0.1', portValue = '8080'] = (process.env.FIRESTORE_EMULATOR_HOST || '').split(':');
const port = Number(portValue);
const ownerUid = 'wave1-owner';

let sourceApp;
let restoreApp;
let sourceFirestore;
let restoreFirestore;
let sourceEnvironment;
let restoreEnvironment;

const seedSource = async () => {
  await Promise.all([
    sourceFirestore.doc('users/wave1-owner').set({ uid: ownerUid, status: 'active' }),
    sourceFirestore.doc('organizations/org_demo').set({ id: 'org_demo', status: 'active' }),
    sourceFirestore.doc('registries/reg_collection_privee').set({
      id: 'reg_collection_privee', organizationId: 'org_demo', status: 'active', visibility: 'secret',
    }),
    sourceFirestore.doc('organizations/org_demo/memberships/wave1-owner').set({
      uid: ownerUid,
      organizationId: 'org_demo',
      roles: ['account_holder', 'legal_owner'],
      status: 'active',
      scopes: { registryIds: ['reg_collection_privee'] },
      permissions: ['cartulary.read', 'cartulary.edit', 'cartulary.export', 'integrity.batch'],
      createdAt: Timestamp.fromDate(new Date('2026-08-15T00:00:00.000Z')),
    }),
    sourceFirestore.doc('schemaCatalog/watch/versions/1.3.0').set({
      schemaId: 'watch', assetType: 'watch', version: '1.3.0', status: 'baseline',
    }),
    sourceFirestore.doc('schemaCatalog/car/versions/1.0.0').set({
      schemaId: 'car', assetType: 'car', version: '1.0.0', status: 'baseline',
    }),
    sourceFirestore.doc('schemaCatalog/car/versions/1.1.0').set({
      schemaId: 'car', assetType: 'car', version: '1.1.0', status: 'active',
    }),
    sourceFirestore.doc('communityProfiles/wave1-owner').set({
      uid: ownerUid, pseudonym: 'Pilote', bio: '', status: 'active', visibility: 'community',
    }),
  ]);
  await Promise.all([
    importCartularyBundle({
      firestore: sourceFirestore,
      bundle: buildIwcImportBundle(),
      requestId: 'wave7-import-iwc-test',
      actorId: ownerUid,
      expectedRevision: 0,
      occurredAt: '2026-08-15T00:01:00.000Z',
    }),
    importCartularyBundle({
      firestore: sourceFirestore,
      bundle: buildCarDemoImportBundle(),
      requestId: 'wave7-import-car-test',
      actorId: ownerUid,
      expectedRevision: 0,
      occurredAt: '2026-08-15T00:02:00.000Z',
    }),
  ]);
};

before(async () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  sourceEnvironment = await initializeTestEnvironment({ projectId, firestore: { host, port, rules } });
  restoreEnvironment = await initializeTestEnvironment({ projectId: restoreProjectId, firestore: { host, port, rules } });
  sourceApp = getApps().find((app) => app.name === 'wave7-source-admin') || initializeApp({ projectId }, 'wave7-source-admin');
  restoreApp = getApps().find((app) => app.name === 'wave7-restore-admin') || initializeApp({ projectId: restoreProjectId }, 'wave7-restore-admin');
  sourceFirestore = getFirestore(sourceApp);
  restoreFirestore = getFirestore(restoreApp);
});

after(async () => {
  await Promise.all([sourceEnvironment.cleanup(), restoreEnvironment.cleanup()]);
  await Promise.all([deleteApp(sourceApp), deleteApp(restoreApp)]);
});

beforeEach(async () => {
  await Promise.all([sourceEnvironment.clearFirestore(), restoreEnvironment.clearFirestore()]);
  await seedSource();
});

test('la sauvegarde est déterministe et toute altération du bundle est refusée', async () => {
  const backup = await createPilotBackup({
    firestore: sourceFirestore,
    sourceProjectId: projectId,
    createdAtIso: '2026-08-15T01:00:00.000Z',
  });
  assert.equal(verifyBackupBundle(backup).valid, true);
  const altered = structuredClone(backup);
  altered.records[0].data.status = 'tampered';
  assert.throws(() => verifyBackupBundle(altered), (error) => error.code === 'record_digest_mismatch');
});

test('T-20 — restauration isolée conserve données, fichiers, relations et journaux', async () => {
  const sourceObjects = new MemoryObjectStoreAdapter([{
    name: 'private/cart_iwc_flieger_utc_2002/proof.txt',
    bytes: Buffer.from('preuve de restauration', 'utf8'),
    contentType: 'text/plain',
    metadata: { classification: 'secret' },
  }]);
  const targetObjects = new MemoryObjectStoreAdapter();
  const backup = await createPilotBackup({
    firestore: sourceFirestore,
    objectStore: sourceObjects,
    sourceProjectId: projectId,
    createdAtIso: '2026-08-15T01:05:00.000Z',
  });
  const restored = await restorePilotBackup({ firestore: restoreFirestore, objectStore: targetObjects, bundle: backup });
  const validation = await validateRestoredPilot({ firestore: restoreFirestore, objectStore: targetObjects, bundle: backup });
  assert.equal(restored.restoredRecords, backup.manifest.recordCount);
  assert.equal(restored.restoredObjects, 1);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  assert.equal(validation.checkedCartularies, 2);
  assert.equal((await targetObjects.read('private/cart_iwc_flieger_utc_2002/proof.txt')).bytes.toString(), 'preuve de restauration');
});

test('la sonde de charge mesure les percentiles et respecte les seuils émulateur', async () => {
  const load = await runFirestoreLoadProbe({
    firestore: sourceFirestore,
    documentPaths: [`cartularies/${IWC_CARTULARY_ID}`, `cartularies/${CAR_DEMO_CARTULARY_ID}`],
    iterations: 40,
    concurrency: 8,
    thresholds: { maxP95Ms: 1000, maxErrorRate: 0 },
  });
  assert.equal(load.passed, true);
  assert.equal(load.errorCount, 0);
  assert.equal(load.iterations, 40);
  assert.ok(load.p95Ms >= 0);
});

test('l’empreinte de consommation inventorie documents et octets logiques', async () => {
  const footprint = await measureFirestoreFootprint(sourceFirestore);
  assert.ok(footprint.documentCount > 20);
  assert.ok(footprint.estimatedJsonBytes > 1000);
  assert.equal(footprint.collectionCounts.cartularies > 0, true);
  assert.equal(footprint.measurementScope, 'logical_json_without_index_overhead');
});

test('le calcul de coûts exige une grille régionale et reste reproductible lorsqu’elle est fournie', () => {
  const workload = { reads: 1_000_000, writes: 100_000, deletes: 10_000, storageGb: 10, egressGb: 5 };
  assert.equal(estimateMonthlyCost({ workload, unitPrices: null }).status, 'not_configured');
  const estimate = estimateMonthlyCost({
    workload,
    unitPrices: {
      readsPer100k: 0.03,
      writesPer100k: 0.09,
      deletesPer100k: 0.01,
      storageGbMonth: 0.15,
      egressGb: 0.12,
      currency: 'EUR',
    },
  });
  assert.equal(estimate.status, 'estimated');
  assert.equal(Number(estimate.estimatedMonthlyCost.toFixed(2)), 2.49);
});

test('le scan privacy accepte les projections sûres et détecte une fuite physique', async () => {
  const safe = await auditProjectionPrivacy({ firestore: sourceFirestore });
  assert.equal(safe.passed, true);
  await sourceFirestore.doc('communityPublications/leak_test').set({
    status: 'published',
    ownerUid: ownerUid,
    contactEmail: 'owner@example.test',
  });
  const unsafe = await auditProjectionPrivacy({ firestore: sourceFirestore });
  assert.equal(unsafe.passed, false);
  assert.ok(unsafe.findings.some((finding) => finding.code === 'forbidden_field'));
  assert.ok(unsafe.findings.some((finding) => finding.code === 'email_value'));
});

test('le dépôt est scannable et une clé de service injectée est détectée', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cartularia-credentials-'));
  try {
    await writeFile(join(directory, 'safe.ts'), 'export const value = "safe";\n');
    const safe = await scanRepositoryForCredentials(directory);
    assert.equal(safe.passed, true);
    const credentialKey = ['private', 'key'].join('_');
    const privateKeyMarker = ['-----BEGIN', ' PRIVATE KEY-----'].join('');
    await writeFile(join(directory, 'credential.json'), JSON.stringify({ [credentialKey]: privateKeyMarker }));
    const unsafe = await scanRepositoryForCredentials(directory);
    assert.equal(unsafe.passed, false);
    assert.ok(unsafe.findings.some((finding) => finding.code === 'private_key'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('le gate ne confond jamais construction terminée et autorisation de mise en service', () => {
  const basePolicy = JSON.parse(readFileSync(new URL('../config/production-policy.json', import.meta.url), 'utf8'));
  const checks = { load: { passed: true }, privacy: { passed: true }, backupRestore: { passed: true } };
  const blocked = evaluateProductionReadiness({ policy: basePolicy, checks });
  assert.equal(blocked.constructionStatus, 'complete');
  assert.equal(blocked.goLiveAuthorization, 'blocked');
  assert.ok(blocked.blockers.includes('D-06_evaluation_chiffrement_applicatif'));
  assert.ok(blocked.blockers.includes('D-07_conservation_suppression'));
  assert.ok(blocked.blockers.includes('grille_couts_regionale'));

  const confirmed = structuredClone(basePolicy);
  confirmed.regions = { status: 'confirmed', firestore: 'test-region', storage: 'test-region' };
  confirmed.privacy.encryptionAssessment = { status: 'confirmed', mode: 'documented_not_required_for_fixture' };
  confirmed.privacy.retentionMatrix = { status: 'confirmed', mode: 'approved_matrix' };
  confirmed.pricing = { status: 'confirmed', unitPrices: {} };
  confirmed.release.remoteDeploymentAuthorized = true;
  const authorized = evaluateProductionReadiness({ policy: confirmed, checks });
  assert.equal(authorized.goLiveAuthorization, 'authorized');
  assert.equal(authorized.blockers.length, 0);
});

test('les journaux opérationnels structurés masquent les données sensibles', () => {
  const entries = [];
  const logger = createStructuredLogger({ service: 'test', sink: (entry) => entries.push(entry) });
  const entry = logger.emit('operation.completed', {
    requestId: 'request-safe-001',
    ownerEmail: 'owner@example.test',
    nested: { serialNumber: 'SECRET-123', count: 2 },
  });
  assert.equal(entries.length, 1);
  assert.equal(entry.ownerEmail, '[REDACTED]');
  assert.equal(entry.nested.serialNumber, '[REDACTED]');
  assert.equal(entry.nested.count, 2);
});
