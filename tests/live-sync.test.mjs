import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { buildIwcImportBundle, IWC_CARTULARY_ID } from '../src/migrations/iwcImport.ts';
import { importCartularyBundle } from '../scripts/lib/import-cartulary-command.mjs';
import { processCartularySyncRequest } from '../scripts/lib/live-sync-command.mjs';
import { verifyAuditChain } from '../scripts/lib/audit-verifier.mjs';

const projectId = 'cartularia-live-sync-test';
const [host = '127.0.0.1', portValue = '8080'] = (process.env.FIRESTORE_EMULATOR_HOST || '').split(':');
const port = Number(portValue);
let adminApp;
let firestore;
let testEnvironment;

const seedFoundations = async () => {
  const now = new Date('2026-08-16T08:00:00.000Z');
  await Promise.all([
    firestore.doc('organizations/org_demo').set({ id: 'org_demo', status: 'active', createdAt: now }),
    firestore.doc('registries/reg_collection_privee').set({
      id: 'reg_collection_privee', organizationId: 'org_demo', status: 'active', itemCount: 0,
    }),
    firestore.doc('organizations/org_demo/memberships/wave1-owner').set({
      uid: 'wave1-owner', organizationId: 'org_demo', roles: ['account_holder', 'legal_owner'], status: 'active',
      scopes: { registryIds: ['reg_collection_privee'] },
      permissions: ['registry.read', 'cartulary.read', 'cartulary.edit', 'publication.manage'],
    }),
    firestore.doc('schemaCatalog/watch/versions/1.3.0').set({
      schemaId: 'watch', assetType: 'watch', version: '1.3.0', status: 'baseline',
    }),
  ]);
  await importCartularyBundle({
    firestore,
    bundle: buildIwcImportBundle(),
    requestId: 'test-live-sync-import-v1',
    actorId: 'wave1-owner',
    occurredAt: '2026-08-16T08:01:00.000Z',
  });
};

const writeDraftAndRequest = async (requestId) => {
  const draftPath = `privateDrafts/wave1-owner/cartularies/${IWC_CARTULARY_ID}`;
  const specifications = [{
    id: 'basic', title: 'Données de base', items: [
      { id: 'brand', label: 'Marque', value: 'IWC Schaffhausen' },
      { id: 'model', label: 'Modèle', value: 'Flieger UTC raccordée' },
      { id: 'reference', label: 'Numéro de référence', value: 'IW3251-001 LIVE' },
      { id: 'year', label: 'Année de fabrication', value: '2003' },
    ],
  }];
  const media = [{
    id: 'asset-live-photo', name: 'Photo raccordée', type: 'image', binaryId: 'media-binary-live-0001',
    tags: ['main-photo', 'slideshow'], visibility: 'Secret', category: 'ensemble', capturedAt: '2026-08-16',
  }];
  await Promise.all([
    firestore.doc(draftPath).set({ ownerUid: 'wave1-owner', cartularyId: IWC_CARTULARY_ID, status: 'active' }),
    firestore.doc(`${draftPath}/state/cartularia-specification-groups`).set({
      ownerUid: 'wave1-owner', cartularyId: IWC_CARTULARY_ID, key: 'cartularia-specification-groups',
      value: JSON.stringify(specifications), deleted: false, revision: 1, clientUpdatedAt: 10,
    }),
    firestore.doc(`${draftPath}/state/cartularia-media-assets-v3`).set({
      ownerUid: 'wave1-owner', cartularyId: IWC_CARTULARY_ID, key: 'cartularia-media-assets-v3',
      value: JSON.stringify(media), deleted: false, revision: 1, clientUpdatedAt: 11,
    }),
    firestore.doc(`${draftPath}/binaries/media-binary-live-0001`).set({
      ownerUid: 'wave1-owner', cartularyId: IWC_CARTULARY_ID, binaryId: 'media-binary-live-0001',
      deleted: false, revision: 1, fileName: 'live.jpg', mimeType: 'image/jpeg', size: 128,
      sha256: `sha256:${'a'.repeat(64)}`, kind: 'media',
      storagePath: `private-drafts/wave1-owner/${IWC_CARTULARY_ID}/media-binary-live-0001/${'a'.repeat(64)}/original`,
      clientUpdatedAt: 11, uploadStatus: 'ready',
    }),
  ]);
  await firestore.doc(`cartularySyncRequests/${IWC_CARTULARY_ID}`).set({
    requestDocumentId: IWC_CARTULARY_ID,
    requestId,
    ownerUid: 'wave1-owner',
    cartularyId: IWC_CARTULARY_ID,
    reason: 'private_draft_synchronized',
    status: 'pending',
  });
};

before(async () => {
  testEnvironment = await initializeTestEnvironment({ projectId, firestore: { host, port } });
  adminApp = initializeApp({ projectId }, 'live-sync-test-admin');
  firestore = getFirestore(adminApp);
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await seedFoundations();
});

after(async () => {
  await testEnvironment.cleanup();
  await deleteApp(adminApp);
});

test('la commande raccorde brouillon, Cartulaire, média, Registre et chaîne d’intégrité', async () => {
  await writeDraftAndRequest('sync_test_live_0000000000000001');
  const result = await processCartularySyncRequest({
    firestore,
    requestDocumentId: IWC_CARTULARY_ID,
    occurredAt: '2026-08-16T08:02:00.000Z',
  });
  assert.equal(result.outcome, 'updated');
  assert.equal(result.revision, 2);

  const [root, item, asset, liveState, request, audits] = await Promise.all([
    firestore.doc(`cartularies/${IWC_CARTULARY_ID}`).get(),
    firestore.doc(`registries/reg_collection_privee/items/${IWC_CARTULARY_ID}`).get(),
    firestore.doc(`cartularies/${IWC_CARTULARY_ID}/assets/asset-live-photo`).get(),
    firestore.doc(`cartularies/${IWC_CARTULARY_ID}/liveState/cartularia-specification-groups`).get(),
    firestore.doc(`cartularySyncRequests/${IWC_CARTULARY_ID}`).get(),
    firestore.collection(`cartularies/${IWC_CARTULARY_ID}/auditEvents`).orderBy('sequence').get(),
  ]);
  assert.equal(root.data().modelName, 'Flieger UTC raccordée');
  assert.equal(root.data().manufactureYear, 2003);
  assert.equal(item.data().referenceCode, 'IW3251-001 LIVE');
  assert.equal(item.data().primaryAssetId, 'asset-live-photo');
  assert.equal(asset.data().processingState, 'ready');
  assert.match(asset.data().storagePath, /^private-drafts\/wave1-owner\//);
  assert.equal(liveState.data().deleted, false);
  assert.equal(request.data().status, 'processed');
  const verification = verifyAuditChain({
    events: audits.docs.map((document) => document.data()),
    integrityHead: root.data().integrityHead,
    integritySequence: root.data().integritySequence,
  });
  assert.equal(verification.valid, true);
  assert.equal(verification.eventCount, 2);

  await firestore.doc(`cartularySyncRequests/${IWC_CARTULARY_ID}`).set({
    requestDocumentId: IWC_CARTULARY_ID,
    requestId: 'sync_test_live_0000000000000002',
    ownerUid: 'wave1-owner', cartularyId: IWC_CARTULARY_ID, reason: 'manual_retry', status: 'pending',
  });
  const replay = await processCartularySyncRequest({ firestore, requestDocumentId: IWC_CARTULARY_ID });
  assert.equal(replay.outcome, 'no_change');
  assert.equal((await firestore.doc(`cartularies/${IWC_CARTULARY_ID}`).get()).data().revision, 2);
});
