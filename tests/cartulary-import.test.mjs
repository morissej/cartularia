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
import { schemaContractDigest } from '../scripts/lib/schema-catalog-files.mjs';
import { WATCH_SCHEMA } from '../src/schema/watchSchema.ts';

const projectId = 'cartularia-wave2-test';
const [host = '127.0.0.1', portValue = '8080'] = (process.env.FIRESTORE_EMULATOR_HOST || '').split(':');
const port = Number(portValue);

let adminApp;
let adminFirestore;
let testEnvironment;
const watchV14Digest = schemaContractDigest(WATCH_SCHEMA);

const WATCH_V14_ADDED_FIELD_IDS = [
  'value.market.activeListings',
  'value.market.medianDaysOnMarket',
  'value.market.lowValue',
  'value.market.midValue',
  'value.market.highValue',
  'value.market.valuations[].lowValue',
  'value.market.valuations[].highValue',
  'value.market.valuations[].source',
  'value.comparables.analysis[].angle',
  'value.comparables.analysis[].finding',
  'value.comparables.analysis[].reading',
  'value.sensitivity.prices[]',
  'value.sensitivity.costs[]',
];

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
    adminFirestore.doc('schemaCatalog/watch/versions/1.4.0').set({
      schemaId: 'watch',
      assetType: 'watch',
      version: '1.4.0',
      status: 'active',
      catalogDigest: watchV14Digest,
    }),
  ]);
};

const buildIwcV14ImportBundle = () => {
  const bundle = buildIwcImportBundle();
  const cartularyId = `${IWC_CARTULARY_ID}_v14`;
  const sourceValue = bundle.sections
    .find((section) => section.id === 'value.retained')
    .fields['value.market.analysisDate'];
  const provenance = (value) => ({ ...sourceValue, value });

  bundle.envelope = { ...bundle.envelope, id: cartularyId, schemaVersion: '1.4.0' };
  bundle.sections = bundle.sections.map((section) => ({ ...section, schemaVersion: 'watch@1.4.0' }));
  for (const collectionName of [
    'assets',
    'spinSets',
    'observations',
    'valuations',
    'comparables',
    'reports',
    'reminders',
    'ownerRelations',
    'events',
  ]) {
    bundle[collectionName] = bundle[collectionName].map((document) =>
      'cartularyId' in document ? { ...document, cartularyId } : document);
  }

  bundle.sections.push(
    {
      id: 'value.market-depth.v14',
      schemaSectionId: 'value.market_depth',
      schemaVersion: 'watch@1.4.0',
      title: 'Profondeur de marché',
      visibility: 'secret',
      status: 'imported_unreviewed',
      fields: {
        'value.market.activeListings': provenance(14),
        'value.market.medianDaysOnMarket': provenance(58),
        'value.market.lowValue': provenance(3200),
        'value.market.midValue': provenance(3600),
        'value.market.highValue': provenance(4200),
      },
      revision: 1,
    },
    {
      id: 'value.market-history.v14',
      schemaSectionId: 'value.market_history',
      schemaVersion: 'watch@1.4.0',
      title: 'Historique de valorisation',
      visibility: 'secret',
      status: 'imported_unreviewed',
      fields: {
        'value.market.valuations[].lowValue': bundle.valuations.map((valuation) => provenance(valuation.lowValue)),
        'value.market.valuations[].highValue': bundle.valuations.map((valuation) => provenance(valuation.highValue)),
        'value.market.valuations[].source': bundle.valuations.map((valuation) => provenance(valuation.sourceLabel)),
      },
      revision: 1,
    },
    {
      id: 'value.comparables-analysis.v14',
      schemaSectionId: 'value.comparables_analysis',
      schemaVersion: 'watch@1.4.0',
      title: 'Analyse des comparables',
      visibility: 'secret',
      status: 'imported_unreviewed',
      fields: {
        'value.comparables.analysis[].angle': [provenance('Liquidité')],
        'value.comparables.analysis[].finding': [provenance('Marché étroit')],
        'value.comparables.analysis[].reading': [provenance('Conclusion à confirmer sur un échantillon élargi.')],
      },
      revision: 1,
    },
    {
      id: 'value.sensitivity.v14',
      schemaSectionId: 'value.sensitivity',
      schemaVersion: 'watch@1.4.0',
      title: 'Hypothèses de sensibilité',
      visibility: 'secret',
      status: 'imported_unreviewed',
      fields: {
        'value.sensitivity.prices[]': [3200, 3600, 4000, 4400, 4800].map(provenance),
        'value.sensitivity.costs[]': [0, 5, 10, 15, 20].map(provenance),
      },
      revision: 1,
    },
  );
  return bundle;
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

  for (const forbidden of ['serialNumber', 'acquisitionPrice', 'address', 'documents', 'schemaDigest']) {
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

test('watch@1.4.0 persiste les 13 nouveaux champs et scelle l’empreinte du catalogue', async () => {
  const bundle = buildIwcV14ImportBundle();
  const bundleDigest = sha256Digest(bundle);
  const result = await runImport({
    bundle,
    requestId: 'wave2-import-iwc-v14',
  });
  const root = await adminFirestore.doc(`cartularies/${bundle.envelope.id}`).get();
  const sections = await root.ref.collection('sections').get();
  const persistedFieldIds = new Set(sections.docs.flatMap((section) => Object.keys(section.data().fields ?? {})));
  const event = (await root.ref.collection('auditEvents').doc(result.auditEventId).get()).data();

  assert.equal(root.data().schemaVersion, '1.4.0');
  assert.equal(root.data().schemaDigest, watchV14Digest);
  assert.deepEqual(WATCH_V14_ADDED_FIELD_IDS.filter((fieldId) => !persistedFieldIds.has(fieldId)), []);
  assert.equal(event.afterDigest, sha256Digest({ bundleDigest, schemaDigest: watchV14Digest }));
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
