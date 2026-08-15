import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import {
  buildIwcImportBundle,
  IWC_CARTULARY_ID,
  IWC_IMPORT_ACTOR_ID,
  IWC_IMPORT_DATE,
  IWC_IMPORT_REQUEST_ID,
} from '../src/migrations/iwcImport.ts';
import { importCartularyBundle } from '../scripts/lib/import-cartulary-command.mjs';
import { sha256Digest } from '../scripts/lib/canonical-json.mjs';

const projectId = 'cartularia-wave2-test';
const [host = '127.0.0.1', portValue = '8080'] = (process.env.FIRESTORE_EMULATOR_HOST || '').split(':');
const port = Number(portValue);

let adminApp;
let adminFirestore;
let testEnvironment;

const seedFoundations = async () => {
  const now = new Date('2026-08-14T08:00:00.000Z');
  await Promise.all([
    adminFirestore.doc('organizations/org_demo').set({ id: 'org_demo', status: 'active', createdAt: now }),
    adminFirestore.doc('registries/reg_collection_privee').set({
      id: 'reg_collection_privee',
      organizationId: 'org_demo',
      status: 'active',
      visibility: 'secret',
    }),
    adminFirestore.doc('organizations/org_demo/memberships/wave1-owner').set({
      uid: 'wave1-owner',
      organizationId: 'org_demo',
      roles: ['account_holder', 'legal_owner'],
      status: 'active',
      scopes: { registryIds: ['reg_collection_privee'] },
      permissions: ['organization.read', 'membership.read', 'registry.read', 'cartulary.read', 'cartulary.edit'],
    }),
    adminFirestore.doc('organizations/org_isolation').set({ id: 'org_isolation', status: 'active' }),
    adminFirestore.doc('organizations/org_isolation/memberships/wave1-outsider').set({
      uid: 'wave1-outsider',
      organizationId: 'org_isolation',
      roles: ['account_holder'],
      status: 'active',
      scopes: { registryIds: ['reg_isolation'] },
      permissions: ['organization.read', 'registry.read', 'cartulary.read'],
    }),
    adminFirestore.doc('schemaCatalog/watch/versions/1.3.0').set({
      schemaId: 'watch',
      assetType: 'watch',
      version: '1.3.0',
      status: 'baseline',
    }),
  ]);
};

const runImport = (overrides = {}) =>
  importCartularyBundle({
    firestore: adminFirestore,
    bundle: buildIwcImportBundle(),
    requestId: IWC_IMPORT_REQUEST_ID,
    actorId: IWC_IMPORT_ACTOR_ID,
    expectedRevision: 0,
    occurredAt: IWC_IMPORT_DATE,
    ...overrides,
  });

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host,
      port,
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  });
  adminApp = getApps().find((app) => app.name === 'wave2-test-admin') || initializeApp({ projectId }, 'wave2-test-admin');
  adminFirestore = getFirestore(adminApp);
});

after(async () => {
  await testEnvironment.cleanup();
  await deleteApp(adminApp);
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await seedFoundations();
});

test('le bundle IWC isole les données sensibles de l’enveloppe et neutralise les médias', () => {
  const bundle = buildIwcImportBundle();
  const envelopeText = JSON.stringify(bundle.envelope);

  for (const forbidden of ['serialNumber', 'acquisitionPrice', 'address', 'documents']) {
    assert.equal(envelopeText.includes(forbidden), false);
  }
  assert.equal(bundle.envelope.defaultVisibility, 'secret');
  assert.equal(bundle.envelope.publicationStatus, 'none');
  assert.equal(bundle.assets.length, 22);
  assert.ok(
    bundle.assets.every(
      (asset) =>
        asset.visibility === 'secret' &&
        asset.sha256 === null &&
        asset.processingState === 'pending_binary_reingest' &&
        !('url' in asset),
    ),
  );
  assert.ok(bundle.observations.every((observation) => observation.proofStatus === 'unverified'));
});

test('createCartulary importe l’IWC privé avec sections, provenance et listes séparées', async () => {
  const bundle = buildIwcImportBundle();
  const result = await runImport();
  const root = await adminFirestore.doc(`cartularies/${IWC_CARTULARY_ID}`).get();
  const [sections, sources, assets, observations, valuations, auditEvents] = await Promise.all([
    root.ref.collection('sections').get(),
    root.ref.collection('sources').get(),
    root.ref.collection('assets').get(),
    root.ref.collection('observations').get(),
    root.ref.collection('valuations').get(),
    root.ref.collection('auditEvents').get(),
  ]);

  assert.equal(result.replayed, false);
  assert.equal(root.data().revision, 1);
  assert.equal(root.data().lifecycleStatus, 'review');
  assert.equal(root.data().defaultVisibility, 'secret');
  assert.equal(root.data().publicationStatus, 'none');
  assert.equal(root.data().integrityHead, result.integrityHead);
  assert.equal(sections.size, bundle.sections.length);
  assert.equal(sources.size, bundle.sources.length);
  assert.equal(assets.size, bundle.assets.length);
  assert.equal(observations.size, bundle.observations.length);
  assert.equal(valuations.size, bundle.valuations.length);
  assert.equal(auditEvents.size, 1);
});

test('le journal canonique relie le digest importé à la tête d’intégrité', async () => {
  const result = await runImport();
  const event = (
    await adminFirestore.doc(`cartularies/${IWC_CARTULARY_ID}/auditEvents/${result.auditEventId}`).get()
  ).data();
  const eventWithoutHash = {
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
  };
  assert.equal(event.hash, sha256Digest({ previousEventHash: event.previousEventHash, event: eventWithoutHash }));
  assert.equal(event.hash, result.integrityHead);
});

test('la répétition du même requestId est idempotente', async () => {
  const first = await runImport();
  const replay = await runImport();
  const auditEvents = await adminFirestore
    .collection(`cartularies/${IWC_CARTULARY_ID}/auditEvents`)
    .get();

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.integrityHead, first.integrityHead);
  assert.equal(auditEvents.size, 1);
});

test('un requestId différent ne peut écraser le Cartulaire existant', async () => {
  await runImport();
  await assert.rejects(
    () => runImport({ requestId: 'wave2-import-iwc-v2' }),
    (error) => error.code === 'cartulary_exists',
  );
});

test('seul le propriétaire autorisé lit le Cartulaire et ses sections', async () => {
  await runImport();
  const ownerFirestore = testEnvironment.authenticatedContext('wave1-owner').firestore();
  const outsiderFirestore = testEnvironment.authenticatedContext('wave1-outsider').firestore();

  await assertSucceeds(getDoc(doc(ownerFirestore, 'cartularies', IWC_CARTULARY_ID)));
  await assertSucceeds(getDoc(doc(ownerFirestore, 'cartularies', IWC_CARTULARY_ID, 'sections', 'identity.summary')));
  await assertSucceeds(getDocs(collection(ownerFirestore, 'cartularies', IWC_CARTULARY_ID, 'sections')));
  await assertFails(getDoc(doc(outsiderFirestore, 'cartularies', IWC_CARTULARY_ID)));
  await assertFails(getDoc(doc(outsiderFirestore, 'cartularies', IWC_CARTULARY_ID, 'sections', 'identity.summary')));
  await assertFails(getDocs(collection(outsiderFirestore, 'cartularies', IWC_CARTULARY_ID, 'sections')));
});

test('le navigateur ne peut ni créer ni modifier le Cartulaire', async () => {
  const ownerFirestore = testEnvironment.authenticatedContext('wave1-owner').firestore();
  await assertFails(setDoc(doc(ownerFirestore, 'cartularies', 'client-created'), { defaultVisibility: 'secret' }));
  await runImport();
  await assertFails(
    setDoc(doc(ownerFirestore, 'cartularies', IWC_CARTULARY_ID), { lifecycleStatus: 'active' }, { merge: true }),
  );
});
