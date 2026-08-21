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
    firestore.doc(`${draftPath}/state/cartularia-collection-id`).set({ key: 'cartularia-collection-id', value: JSON.stringify('col_archive'), deleted: false, revision: 1, clientUpdatedAt: 12 }),
    firestore.doc(`${draftPath}/state/cartularia-watch-status`).set({ key: 'cartularia-watch-status', value: JSON.stringify('À vendre'), deleted: false, revision: 1, clientUpdatedAt: 13 }),
    firestore.doc(`${draftPath}/state/cartularia-purchase`).set({ key: 'cartularia-purchase', value: JSON.stringify({ date: '2020-01-01', purchasePrice: 10_000 }), deleted: false, revision: 1, clientUpdatedAt: 14 }),
    firestore.doc(`${draftPath}/state/cartularia-purchase-expenses`).set({ key: 'cartularia-purchase-expenses', value: JSON.stringify([{ id: 'expense-1', amount: 1_500 }]), deleted: false, revision: 1, clientUpdatedAt: 15 }),
    firestore.doc(`${draftPath}/state/cartularia-retained-valuation`).set({ key: 'cartularia-retained-valuation', value: JSON.stringify({ amount: 20_000, saleCostAmount: 2_000, taxAmount: 500 }), deleted: false, revision: 1, clientUpdatedAt: 16 }),
    firestore.doc(`${draftPath}/state/cartularia-creation-profile`).set({ key: 'cartularia-creation-profile', value: JSON.stringify({ currency: 'EUR' }), deleted: false, revision: 1, clientUpdatedAt: 17 }),
    firestore.doc(`${draftPath}/state/cartularia-todos`).set({ key: 'cartularia-todos', value: JSON.stringify([{ id: 'follow-up-1', text: 'Renouveler assurance', dueAt: '2026-09-01', category: 'insurance', status: 'planned' }]), deleted: false, revision: 1, clientUpdatedAt: 18 }),
    firestore.doc(`${draftPath}/state/cartularia-owner-fields`).set({ key: 'cartularia-owner-fields', value: JSON.stringify([{ id: 'owner-name', value: 'Nom historique à filtrer' }]), deleted: false, revision: 1, clientUpdatedAt: 19 }),
    firestore.doc(`${draftPath}/state/cartularia-transmission-recipients`).set({ key: 'cartularia-transmission-recipients', value: JSON.stringify([{ id: 'recipient-1', name: 'Bénéficiaire à filtrer' }]), deleted: false, revision: 1, clientUpdatedAt: 20 }),
    firestore.doc(`${draftPath}/state/cartularia-storage-locations`).set({ key: 'cartularia-storage-locations', value: JSON.stringify([{ id: 'storage-1', address: 'Adresse à filtrer' }]), deleted: false, revision: 1, clientUpdatedAt: 21 }),
    firestore.doc(`${draftPath}/binaries/media-binary-live-0001`).set({
      ownerUid: 'wave1-owner', cartularyId: IWC_CARTULARY_ID, binaryId: 'media-binary-live-0001',
      deleted: false, revision: 1, fileName: 'live.jpg', mimeType: 'image/jpeg', size: 128,
      sha256: `sha256:${'a'.repeat(64)}`, kind: 'media',
      storagePath: `private-drafts/wave1-owner/${IWC_CARTULARY_ID}/media-binary-live-0001/${'a'.repeat(64)}/original`,
      clientUpdatedAt: 11, uploadStatus: 'ready',
    }),
    firestore.doc(`${draftPath}/binaries/owner-document-live-0001`).set({
      ownerUid: 'wave1-owner', cartularyId: IWC_CARTULARY_ID, binaryId: 'owner-document-live-0001',
      deleted: false, revision: 1, fileName: 'identite.pdf', mimeType: 'application/pdf', size: 128,
      sha256: `sha256:${'b'.repeat(64)}`, kind: 'owner_document',
      storagePath: `private-drafts/wave1-owner/${IWC_CARTULARY_ID}/owner-document-live-0001/${'b'.repeat(64)}/original`,
      clientUpdatedAt: 12, uploadStatus: 'ready',
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

  const [root, item, asset, personalState, ownerDocument, liveState, reminder, request, audits] = await Promise.all([
    firestore.doc(`cartularies/${IWC_CARTULARY_ID}`).get(),
    firestore.doc(`registries/reg_collection_privee/items/${IWC_CARTULARY_ID}`).get(),
    firestore.doc(`cartularies/${IWC_CARTULARY_ID}/assets/asset-live-photo`).get(),
    firestore.doc(`cartularies/${IWC_CARTULARY_ID}/liveState/cartularia-owner-fields`).get(),
    firestore.doc(`cartularies/${IWC_CARTULARY_ID}/assets/owner-document-live-0001`).get(),
    firestore.doc(`cartularies/${IWC_CARTULARY_ID}/liveState/cartularia-specification-groups`).get(),
    firestore.doc(`cartularies/${IWC_CARTULARY_ID}/reminders/follow-up-1`).get(),
    firestore.doc(`cartularySyncRequests/${IWC_CARTULARY_ID}`).get(),
    firestore.collection(`cartularies/${IWC_CARTULARY_ID}/auditEvents`).orderBy('sequence').get(),
  ]);
  assert.equal(root.data().modelName, 'Flieger UTC raccordée');
  assert.equal(root.data().manufactureYear, 2003);
  assert.equal(item.data().referenceCode, 'IW3251-001 LIVE');
  assert.equal(item.data().primaryAssetId, 'asset-live-photo');
  assert.equal(item.data().collectionId, 'col_archive');
  assert.equal(item.data().patrimonialStatus, 'À vendre');
  assert.equal(item.data().purchasePrice, 10_000);
  assert.equal(item.data().costBasis, 11_500);
  assert.equal(item.data().grossValuation, 20_000);
  assert.equal(item.data().netValuation, 18_000);
  assert.equal(item.data().netAfterTaxValuation, 17_500);
  assert.equal(reminder.data().title, 'Renouveler assurance');
  assert.equal(asset.data().processingState, 'ready');
  assert.match(asset.data().storagePath, /^private-drafts\/wave1-owner\//);
  assert.equal(personalState.exists, false);
  assert.equal(ownerDocument.exists, false);
  const synchronizedStateKeys = (await firestore.collection(`cartularies/${IWC_CARTULARY_ID}/liveState`).get()).docs.map((document) => document.id);
  assert.equal(synchronizedStateKeys.includes('cartularia-transmission-recipients'), false);
  assert.equal(synchronizedStateKeys.includes('cartularia-storage-locations'), false);
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

test('deux exécutions concurrentes ne produisent qu’une seule révision utile', async () => {
  await writeDraftAndRequest('sync_test_live_0000000000000010');
  const results = await Promise.all([
    processCartularySyncRequest({
      firestore,
      requestDocumentId: IWC_CARTULARY_ID,
      occurredAt: '2026-08-16T08:05:00.000Z',
    }),
    processCartularySyncRequest({
      firestore,
      requestDocumentId: IWC_CARTULARY_ID,
      occurredAt: '2026-08-16T08:05:00.000Z',
    }),
  ]);
  assert.equal(results.filter((result) => result.outcome === 'updated').length, 1);
  assert.equal(results.filter((result) => result.status === 'ignored').length, 1);
  assert.equal((await firestore.doc(`cartularies/${IWC_CARTULARY_ID}`).get()).data().revision, 2);
  assert.equal((await firestore.collection(`cartularies/${IWC_CARTULARY_ID}/auditEvents`).get()).size, 2);
});

test('le quota serveur bloque une succession de requêtes distinctes', async () => {
  await writeDraftAndRequest('sync_test_live_0000000000000020');
  await processCartularySyncRequest({
    firestore,
    requestDocumentId: IWC_CARTULARY_ID,
    occurredAt: '2026-08-16T08:10:00.000Z',
    rateLimitPerHour: 1,
  });
  await firestore.doc(`cartularySyncRequests/${IWC_CARTULARY_ID}`).set({
    requestDocumentId: IWC_CARTULARY_ID,
    requestId: 'sync_test_live_0000000000000021',
    ownerUid: 'wave1-owner',
    cartularyId: IWC_CARTULARY_ID,
    reason: 'manual_retry',
    status: 'pending',
  });
  await assert.rejects(
    processCartularySyncRequest({
      firestore,
      requestDocumentId: IWC_CARTULARY_ID,
      occurredAt: '2026-08-16T08:11:00.000Z',
      rateLimitPerHour: 1,
    }),
    (error) => error?.code === 'rate_limited',
  );
  assert.equal((await firestore.doc(`cartularySyncRequests/${IWC_CARTULARY_ID}`).get()).data().status, 'pending');
});
