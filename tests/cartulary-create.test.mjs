import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { processCartularyCreateRequest } from '../scripts/lib/create-cartulary-command.mjs';
import { processCartularySyncRequest } from '../scripts/lib/live-sync-command.mjs';

const projectId = 'cartularia-create-test';
const [host = '127.0.0.1', portValue = '8080'] = (process.env.FIRESTORE_EMULATOR_HOST || '').split(':');
const port = Number(portValue);
const ownerUid = 'wave1-owner';
const cartularyId = 'cart_rolex_gmt_master_test0001';
const requestId = 'create_0123456789abcdef0123456789ab';
const draftPath = `privateDrafts/${ownerUid}/cartularies/${cartularyId}`;

let testEnvironment;
let adminApp;
let firestore;

const seed = async () => {
  const profile = {
    profileVersion: '1.0.0',
    assetType: 'watch',
    schemaId: 'watch',
    schemaVersion: '1.6.0',
    collectionId: 'col_pilots',
    brand: 'Rolex',
    model: 'GMT-Master Mark I Long E',
    reference: '1675',
    manufactureYear: 1969,
    serialNumber: '1 982 530',
    caliber: '1575',
    description: 'Exemplaire avec insert fuchsia et bracelet Jubilee plié.',
    conditionSummary: 'État déclaré à confirmer sur pièces.',
    purchaseDate: '2026-07-23',
    purchasePrice: 21900,
    currency: 'EUR',
    seller: "L'Atelier du Temps",
    valuationDate: '2026-07-23',
    valuationLow: 20000,
    valuationMid: 21900,
    valuationHigh: 24000,
    sourceLabel: 'Dossier Rolex transmis par le propriétaire',
    assertedAt: '2026-08-16T09:00:00.000Z',
  };
  const media = [{
    id: 'asset_rolex_cover',
    name: 'L1210082.jpg',
    originalFileName: 'L1210082.jpg',
    type: 'image',
    mimeType: 'image/jpeg',
    binaryId: 'bin_rolex_cover_0000000001',
    tags: ['main-photo', 'slideshow'],
    category: 'ensemble',
    visibility: 'Secret',
    capturedAt: '2026-07-23T10:00:00.000Z',
    timestampSource: 'file.lastModified',
  }];
  const specifications = [{
    id: 'identity',
    label: 'Identification',
    items: [
      { id: 'brand', label: 'Marque', value: 'Rolex' },
      { id: 'model', label: 'Modèle', value: 'GMT-Master Mark I Long E' },
      { id: 'reference', label: 'Numéro de référence', value: '1675' },
      { id: 'year', label: 'Année de fabrication', value: '1969' },
      { id: 'caliber', label: 'Calibre', value: '1575' },
    ],
  }];
  await Promise.all([
    firestore.doc('organizations/org_demo').set({ id: 'org_demo', status: 'active' }),
    firestore.doc('registries/reg_collection_privee').set({
      id: 'reg_collection_privee', organizationId: 'org_demo', status: 'active', visibility: 'secret', itemCount: 0,
    }),
    firestore.doc(`organizations/org_demo/memberships/${ownerUid}`).set({
      uid: ownerUid,
      organizationId: 'org_demo',
      roles: ['account_holder', 'legal_owner'],
      status: 'active',
      scopes: { registryIds: ['reg_collection_privee'] },
      permissions: ['registry.read', 'cartulary.read', 'cartulary.edit', 'publication.manage'],
    }),
    firestore.doc('schemaCatalog/watch/versions/1.6.0').set({
      schemaId: 'watch', assetType: 'watch', version: '1.6.0', status: 'active',
    }),
    firestore.doc(draftPath).set({ ownerUid, cartularyId, status: 'active' }),
    firestore.doc(`${draftPath}/state/cartularia-creation-profile`).set({
      key: 'cartularia-creation-profile', value: JSON.stringify(profile), deleted: false,
    }),
    firestore.doc(`${draftPath}/state/cartularia-media-assets-v3`).set({
      key: 'cartularia-media-assets-v3', value: JSON.stringify(media), deleted: false, revision: 1, clientUpdatedAt: 12,
    }),
    firestore.doc(`${draftPath}/state/cartularia-specification-groups`).set({
      key: 'cartularia-specification-groups', value: JSON.stringify(specifications), deleted: false, revision: 1, clientUpdatedAt: 11,
    }),
    firestore.doc(`${draftPath}/binaries/bin_rolex_cover_0000000001`).set({
      binaryId: 'bin_rolex_cover_0000000001', deleted: false, revision: 1,
      fileName: 'L1210082.jpg', mimeType: 'image/jpeg', size: 3456789,
      sha256: `sha256:${'a'.repeat(64)}`, kind: 'media',
      storagePath: `private-drafts/${ownerUid}/${cartularyId}/bin_rolex_cover_0000000001/${'a'.repeat(64)}/original`,
      uploadStatus: 'ready', clientUpdatedAt: 10,
    }),
    firestore.doc(`cartularyCreateRequests/${cartularyId}`).set({
      requestDocumentId: cartularyId,
      requestId,
      ownerUid,
      cartularyId,
      organizationId: 'org_demo',
      registryId: 'reg_collection_privee',
      publicCode: 'ROL-TEST01',
      status: 'pending',
    }),
  ]);
};

before(async () => {
  testEnvironment = await initializeTestEnvironment({ projectId, firestore: { host, port } });
  adminApp = initializeApp({ projectId }, 'cartulary-create-test-admin');
  firestore = getFirestore(adminApp);
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await seed();
});

after(async () => {
  await testEnvironment.cleanup();
  await deleteApp(adminApp);
});

test('la demande privée crée un Cartulaire secret, une projection minimale puis raccorde le média', async () => {
  const created = await processCartularyCreateRequest({
    firestore,
    requestDocumentId: cartularyId,
    occurredAt: '2026-08-16T09:01:00.000Z',
  });
  assert.equal(created.status, 'processed');
  assert.equal(created.revision, 2);

  const [rootAfterCreate, projectionAfterCreate, assetAfterCreate, requestAfterCreate, syncRequest] = await Promise.all([
    firestore.doc(`cartularies/${cartularyId}`).get(),
    firestore.doc(`registries/reg_collection_privee/items/${cartularyId}`).get(),
    firestore.doc(`cartularies/${cartularyId}/assets/asset_rolex_cover`).get(),
    firestore.doc(`cartularyCreateRequests/${cartularyId}`).get(),
    firestore.doc(`cartularySyncRequests/${cartularyId}`).get(),
  ]);
  assert.equal(rootAfterCreate.data().displayTitle, 'Rolex GMT-Master Mark I Long E');
  assert.equal(rootAfterCreate.data().defaultVisibility, 'secret');
  assert.equal(rootAfterCreate.data().publicationStatus, 'none');
  assert.equal(rootAfterCreate.data().revision, 2);
  assert.equal(projectionAfterCreate.data().displayTitle, 'Rolex GMT-Master Mark I Long E');
  assert.equal(projectionAfterCreate.data().sourceRevision, 2);
  assert.equal(assetAfterCreate.data().processingState, 'pending_binary_reingest');
  assert.equal(assetAfterCreate.data().binaryId, 'bin_rolex_cover_0000000001');
  assert.match(assetAfterCreate.data().storagePath, /^private-drafts\/wave1-owner\//);
  assert.equal('serialNumber' in projectionAfterCreate.data(), false);
  assert.equal(projectionAfterCreate.data().purchasePrice, 21_900);
  assert.equal(projectionAfterCreate.data().userAlias, null);
  assert.equal(projectionAfterCreate.data().objectCode, 'ROL-TEST01');
  assert.equal('storageCodeNames' in projectionAfterCreate.data(), false);
  assert.equal(requestAfterCreate.data().status, 'processed');
  assert.equal(syncRequest.data().status, 'pending');

  const synchronized = await processCartularySyncRequest({
    firestore,
    requestDocumentId: cartularyId,
    occurredAt: '2026-08-16T09:02:00.000Z',
  });
  assert.equal(synchronized.outcome, 'updated');
  assert.equal(synchronized.revision, 3);

  const [root, projection, asset, registry] = await Promise.all([
    firestore.doc(`cartularies/${cartularyId}`).get(),
    firestore.doc(`registries/reg_collection_privee/items/${cartularyId}`).get(),
    firestore.doc(`cartularies/${cartularyId}/assets/asset_rolex_cover`).get(),
    firestore.doc('registries/reg_collection_privee').get(),
  ]);
  assert.equal(root.data().revision, 3);
  assert.equal(projection.data().primaryAssetId, 'asset_rolex_cover');
  assert.equal(asset.data().processingState, 'ready');
  assert.match(asset.data().storagePath, /^private-drafts\/wave1-owner\//);
  assert.equal(registry.data().itemCount, 1);
});

test('une demande déjà traitée est ignorée sans créer de doublon', async () => {
  await processCartularyCreateRequest({ firestore, requestDocumentId: cartularyId });
  const replay = await processCartularyCreateRequest({ firestore, requestDocumentId: cartularyId });
  assert.deepEqual(replay, { requestDocumentId: cartularyId, status: 'ignored', reason: 'not_pending' });
  assert.equal((await firestore.collection(`cartularies/${cartularyId}/ownerRelations`).get()).size, 1);
});
