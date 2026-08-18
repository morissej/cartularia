import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, orderBy, query, where } from 'firebase/firestore';
import { CAR_SCHEMA } from '../src/schema/carSchema.ts';
import { buildGenericFieldRows } from '../src/schema/fieldPresentation.ts';
import {
  buildCarDemoImportBundle,
  CAR_DEMO_CARTULARY_ID,
  CAR_DEMO_IMPORT_ACTOR_ID,
  CAR_DEMO_IMPORT_DATE,
  CAR_DEMO_IMPORT_REQUEST_ID,
} from '../src/migrations/carDemoImport.ts';
import {
  buildIwcImportBundle,
  IWC_CARTULARY_ID,
  IWC_IMPORT_ACTOR_ID,
  IWC_IMPORT_DATE,
  IWC_IMPORT_REQUEST_ID,
} from '../src/migrations/iwcImport.ts';
import { importCartularyBundle } from '../scripts/lib/import-cartulary-command.mjs';
import { projectRegistryItem } from '../scripts/lib/projection-command.mjs';

const projectId = 'cartularia-wave4-test';
const [host = '127.0.0.1', portValue = '8080'] = (process.env.FIRESTORE_EMULATOR_HOST || '').split(':');
const port = Number(portValue);

let adminApp;
let adminFirestore;
let testEnvironment;

const seedFoundations = async () => {
  const now = new Date('2026-08-14T13:00:00.000Z');
  await Promise.all([
    adminFirestore.doc('organizations/org_demo').set({ id: 'org_demo', status: 'active', createdAt: now }),
    adminFirestore.doc('registries/reg_collection_privee').set({
      id: 'reg_collection_privee',
      organizationId: 'org_demo',
      status: 'active',
      visibility: 'secret',
      itemCount: 0,
    }),
    adminFirestore.doc('organizations/org_demo/memberships/wave1-owner').set({
      uid: 'wave1-owner',
      organizationId: 'org_demo',
      roles: ['account_holder', 'legal_owner'],
      status: 'active',
      scopes: { registryIds: ['reg_collection_privee'] },
      permissions: [
        'organization.read',
        'membership.read',
        'registry.read',
        'cartulary.read',
        'cartulary.edit',
        'publication.manage',
      ],
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
      schemaId: 'watch', assetType: 'watch', version: '1.3.0', status: 'baseline',
    }),
    adminFirestore.doc('schemaCatalog/car/versions/1.1.0').set({
      schemaId: 'car', assetType: 'car', version: '1.1.0', status: 'active',
    }),
  ]);
};

const importWatch = () => importCartularyBundle({
  firestore: adminFirestore,
  bundle: buildIwcImportBundle(),
  requestId: IWC_IMPORT_REQUEST_ID,
  actorId: IWC_IMPORT_ACTOR_ID,
  expectedRevision: 0,
  occurredAt: IWC_IMPORT_DATE,
});

const importCar = () => importCartularyBundle({
  firestore: adminFirestore,
  bundle: buildCarDemoImportBundle(),
  requestId: CAR_DEMO_IMPORT_REQUEST_ID,
  actorId: CAR_DEMO_IMPORT_ACTOR_ID,
  expectedRevision: 0,
  occurredAt: CAR_DEMO_IMPORT_DATE,
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
  adminApp = getApps().find((app) => app.name === 'wave4-test-admin') || initializeApp({ projectId }, 'wave4-test-admin');
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

test('T-01 — watch et car utilisent la même enveloppe et aucun root cars', async () => {
  await Promise.all([importWatch(), importCar()]);
  const [watch, car, cars] = await Promise.all([
    adminFirestore.doc(`cartularies/${IWC_CARTULARY_ID}`).get(),
    adminFirestore.doc(`cartularies/${CAR_DEMO_CARTULARY_ID}`).get(),
    adminFirestore.collection('cars').get(),
  ]);
  assert.deepEqual(Object.keys(car.data()).sort(), Object.keys(watch.data()).sort());
  assert.equal(watch.data().assetType, 'watch');
  assert.equal(car.data().assetType, 'car');
  assert.equal('vin' in car.data(), false);
  assert.equal(cars.empty, true);
});

test('T-01 — les règles génériques isolent les deux verticales par tenant', async () => {
  await Promise.all([importWatch(), importCar()]);
  const owner = testEnvironment.authenticatedContext('wave1-owner').firestore();
  const outsider = testEnvironment.authenticatedContext('wave1-outsider').firestore();
  for (const cartularyId of [IWC_CARTULARY_ID, CAR_DEMO_CARTULARY_ID]) {
    await assertSucceeds(getDoc(doc(owner, 'cartularies', cartularyId)));
    await assertFails(getDoc(doc(outsider, 'cartularies', cartularyId)));
  }
});

test('T-02 — un champ vertical inconnu reste lisible par le fallback générique', async () => {
  const section = buildCarDemoImportBundle().sections.find((item) => item.id === 'technical.chassis');
  assert.ok(section);
  const rows = buildGenericFieldRows(section, CAR_SCHEMA);
  const extension = rows.find((row) => row.fieldId === 'future.car.telemetry.health');
  assert.equal(extension.knownBySchema, false);
  assert.equal(extension.source, 'extensions');
  assert.match(String(extension.value), /fallback vague 4/);
});

test('l’import car est idempotent et conserve une seule écriture d’audit', async () => {
  const first = await importCar();
  const replay = await importCar();
  const audit = await adminFirestore.collection(`cartularies/${CAR_DEMO_CARTULARY_ID}/auditEvents`).get();
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(first.integrityHead, replay.integrityHead);
  assert.equal(audit.size, 1);
});

test('T-17 — Registre filtre type et collection avec l’index planifié', async () => {
  await Promise.all([importWatch(), importCar()]);
  await projectRegistryItem({
    firestore: adminFirestore,
    cartularyId: IWC_CARTULARY_ID,
    actorId: IWC_IMPORT_ACTOR_ID,
    requestId: 'wave4-project-watch-for-index',
    expectedRevision: 1,
    occurredAt: '2026-08-14T14:05:00.000Z',
  });
  const result = await projectRegistryItem({
    firestore: adminFirestore,
    cartularyId: CAR_DEMO_CARTULARY_ID,
    actorId: CAR_DEMO_IMPORT_ACTOR_ID,
    requestId: 'wave4-project-car-for-index',
    expectedRevision: 1,
    occurredAt: '2026-08-14T14:06:00.000Z',
  });
  const owner = testEnvironment.authenticatedContext('wave1-owner').firestore();
  const carItems = await assertSucceeds(getDocs(query(
    collection(owner, 'registries', 'reg_collection_privee', 'items'),
    where('assetType', '==', 'car'),
    where('collectionId', '==', 'col_vehicles'),
    orderBy('updatedAt', 'desc'),
  )));
  assert.equal(result.revision, 2);
  assert.deepEqual(carItems.docs.map((item) => item.id), [CAR_DEMO_CARTULARY_ID]);
  assert.equal(carItems.docs[0].data().sourceRevision, 2);
});
