import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { buildIwcImportBundle, IWC_CARTULARY_ID } from '../src/migrations/iwcImport.ts';
import { importCartularyBundle } from '../scripts/lib/import-cartulary-command.mjs';
import { processCartularySyncRequest, REVIEW_CONFIRMED_ACTION } from '../scripts/lib/live-sync-command.mjs';
import { buildCartularyReviewDecision, REVIEW_OPERATION_KIND, REVIEW_STATE_KEY } from '../scripts/lib/cartulary-review-policy.mjs';
import { verifyAuditChain } from '../scripts/lib/audit-verifier.mjs';
import { sha256Digest } from '../scripts/lib/canonical-json.mjs';
import { presentationVariantPath } from '../scripts/lib/presentation-variants.mjs';
import { registryItemAuditText } from '../scripts/lib/registry-thumbnail.mjs';
import { createPrivateOriginalStorage, verifiedPrivateBinary } from './helpers/private-original-fixture.mjs';

const projectId = 'cartularia-live-sync-test';
const [host = '127.0.0.1', portValue = '8080'] = (process.env.FIRESTORE_EMULATOR_HOST || '').split(':');
const port = Number(portValue);
let adminApp;
let firestore;
let storage;
let testEnvironment;

const seedFoundations = async () => {
  const now = new Date('2026-08-16T08:00:00.000Z');
  await Promise.all([
    firestore.doc('organizations/org_demo').set({ id: 'org_demo', status: 'active', createdAt: now }),
    firestore.doc('registries/reg_collection_privee').set({
      id: 'reg_collection_privee', organizationId: 'org_demo', status: 'active', itemCount: 0,
    }),
    firestore.doc('registries/reg_collection_privee/collections/col_archive').set({
      id: 'col_archive', registryId: 'reg_collection_privee', organizationId: 'org_demo', status: 'draft',
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

// Variantes v3 du binaire vérifié (contrat K2) : chemins du propriétaire wave1-owner, vignette inline issue de la variante 240.
const LIVE_THUMBNAIL_DATA_URL = `data:image/webp;base64,${Buffer.from('live-webp-240-fixture').toString('base64')}`;
const liveVariant = (width, height) => ({
  width, height, storagePath: presentationVariantPath('wave1-owner', IWC_CARTULARY_ID, 'media-binary-live-0001', width),
  sha256: `sha256:${String(width).padStart(4, '0').repeat(16)}`, size: 1_000 + width, mimeType: 'image/webp',
});
const livePresentationDerivative = () => ({
  storagePath: `private-derivatives/wave1-owner/${IWC_CARTULARY_ID}/media-binary-live-0001/presentation-v2.webp`, mimeType: 'image/webp',
  variantsVersion: 'presentation-v3', variantsFailure: null, variants: [liveVariant(240, 160), liveVariant(480, 320)],
  thumbnail: { dataUrl: LIVE_THUMBNAIL_DATA_URL, width: 240, height: 160, sha256: liveVariant(240, 160).sha256 },
});
const expectedLiveThumbnail = () => ({ kind: 'inline', dataUrl: LIVE_THUMBNAIL_DATA_URL, width: 240, height: 160, assetId: 'asset-live-photo', sha256: liveVariant(240, 160).sha256 });

const writeDraftAndRequest = async (requestId) => {
  storage = createPrivateOriginalStorage();
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
    firestore.doc(`${draftPath}/binaries/media-binary-live-0001`).set(verifiedPrivateBinary({
      ownerUid: 'wave1-owner', cartularyId: IWC_CARTULARY_ID, binaryId: 'media-binary-live-0001',
      deleted: false, revision: 1, fileName: 'live.jpg', mimeType: 'image/jpeg', size: 128,
      sha256: `sha256:${'a'.repeat(64)}`, kind: 'media',
      storagePath: `private-drafts/wave1-owner/${IWC_CARTULARY_ID}/media-binary-live-0001/${'a'.repeat(64)}/original`,
      clientUpdatedAt: 11, uploadStatus: 'ready', verificationStatus: 'accepted',
      presentationDerivative: livePresentationDerivative(),
    })),
    firestore.doc(`${draftPath}/binaries/owner-document-live-0001`).set({
      ownerUid: 'wave1-owner', cartularyId: IWC_CARTULARY_ID, binaryId: 'owner-document-live-0001',
      deleted: false, revision: 1, fileName: 'identite.pdf', mimeType: 'application/pdf', size: 128,
      sha256: `sha256:${'b'.repeat(64)}`, kind: 'owner_document',
      storagePath: `private-drafts/wave1-owner/${IWC_CARTULARY_ID}/owner-document-live-0001/${'b'.repeat(64)}/original`,
      clientUpdatedAt: 12, uploadStatus: 'ready',
    }),
  ]);
  storage.register((await firestore.doc(`${draftPath}/binaries/media-binary-live-0001`).get()).data());
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

test('une Collection supprimée bloque une nouvelle affectation sans modifier le Cartulaire', async () => {
  await writeDraftAndRequest('sync_test_removed_collection_0001');
  await firestore.doc('registries/reg_collection_privee/collections/col_archive').delete();
  const before = (await firestore.doc(`cartularies/${IWC_CARTULARY_ID}`).get()).data();
  await assert.rejects(processCartularySyncRequest({ storage, firestore, requestDocumentId: IWC_CARTULARY_ID, occurredAt: '2026-08-16T08:02:00.000Z' }), { code: 'failed-precondition' });
  const after = (await firestore.doc(`cartularies/${IWC_CARTULARY_ID}`).get()).data();
  assert.equal(after.revision, before.revision); assert.equal(after.collectionId, before.collectionId);
});

test('la commande raccorde brouillon, Cartulaire, média, Registre et chaîne d’intégrité', async () => {
  await writeDraftAndRequest('sync_test_live_0000000000000001');
  const result = await processCartularySyncRequest({ storage,
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
  // Contrat K3 : miroir des variantes sur l'asset, vignette inline sur l'item (hors contentHash), sans mot interdit.
  assert.equal(asset.data().privatePresentation.version, 'presentation-v3');
  assert.equal(asset.data().privatePresentation.binaryId, 'media-binary-live-0001');
  assert.deepEqual(asset.data().privatePresentation.variants.map((variant) => variant.storagePath), [liveVariant(240, 160).storagePath, liveVariant(480, 320).storagePath]);
  assert.deepEqual(item.data().thumbnail, expectedLiveThumbnail());
  assert.equal(item.data().primaryMediaKind, 'image');
  assert.equal(item.data().thumbnailStatus, 'ready');
  const { thumbnail: _thumbnail, primaryMediaKind: _kind, thumbnailStatus: _status, contentHash, generatedAt: _generatedAt, updatedAt: _updatedAt, ...projection } = item.data();
  assert.equal(contentHash, sha256Digest(projection), 'thumbnail, primaryMediaKind et thumbnailStatus hors contentHash');
  const itemText = registryItemAuditText(item.data()).toLowerCase();
  for (const forbidden of ['serial', 'owner', 'acquisition', 'storage', 'address']) assert.equal(itemText.includes(forbidden), false, forbidden);
  assert.equal(JSON.stringify(item.data()).includes('private-derivatives'), false);
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
  const replay = await processCartularySyncRequest({ storage, firestore, requestDocumentId: IWC_CARTULARY_ID });
  assert.equal(replay.outcome, 'no_change');
  assert.equal((await firestore.doc(`cartularies/${IWC_CARTULARY_ID}`).get()).data().revision, 2);
});

/**
 * Revue du propriétaire (V5 lot B, § 5.7) : décision + marqueur dans le brouillon, puis demande de synchronisation.
 * Relecture du lot B (F3) : `requestId` de forme production (`sync_…`, cloudDraft.ts), distinct du jeton d'opération (UUID client).
 */
const writeReviewAndRequest = async ({ level, token, requestId, baseRevision, revision = 1 }) => {
  assert.notEqual(requestId, token, 'la demande et le jeton sont deux identifiants distincts, comme en production');
  const draftPath = `privateDrafts/wave1-owner/cartularies/${IWC_CARTULARY_ID}`;
  await Promise.all([
    firestore.doc(`${draftPath}/state/${REVIEW_STATE_KEY}`).set({ ownerUid: 'wave1-owner', cartularyId: IWC_CARTULARY_ID, key: REVIEW_STATE_KEY, value: JSON.stringify(buildCartularyReviewDecision({ baseRevision, level })), deleted: false, revision, clientUpdatedAt: 200 + revision }),
    firestore.doc(`${draftPath}/state/cartularia-generic-operation`).set({ ownerUid: 'wave1-owner', cartularyId: IWC_CARTULARY_ID, key: 'cartularia-generic-operation', value: JSON.stringify({ kind: REVIEW_OPERATION_KIND, token }), deleted: false, revision, clientUpdatedAt: 200 + revision }),
  ]);
  await firestore.doc(`cartularySyncRequests/${IWC_CARTULARY_ID}`).set({
    requestDocumentId: IWC_CARTULARY_ID, requestId, ownerUid: 'wave1-owner', cartularyId: IWC_CARTULARY_ID, reason: 'private_draft_synchronized', status: 'pending',
  });
};

test('revue du propriétaire : statut, palier et date serveur, projection et contentHash, événement dédié, rejeu no_change, conflit de révision, cycle inactif', async () => {
  await writeDraftAndRequest('sync_test_review_000000000000001');
  await processCartularySyncRequest({ storage, firestore, requestDocumentId: IWC_CARTULARY_ID, occurredAt: '2026-08-16T08:02:00.000Z' });
  const rootRef = firestore.doc(`cartularies/${IWC_CARTULARY_ID}`);
  const itemRef = firestore.doc(`registries/reg_collection_privee/items/${IWC_CARTULARY_ID}`);
  const before = (await rootRef.get()).data();
  assert.deepEqual([before.revision, before.lifecycleStatus, before.completenessLevel, before.lastVerifiedAt], [2, 'review', 'imported_unreviewed', null]);

  const token = 'e7a4c1d2-3b5f-4a6e-9c8d-0f1e2d3c4b5a';
  const requestId = 'sync_test_review_000000000000010';
  await writeReviewAndRequest({ level: 'partial', token, requestId, baseRevision: before.revision });
  const result = await processCartularySyncRequest({ storage, firestore, requestDocumentId: IWC_CARTULARY_ID, occurredAt: '2026-08-16T08:03:00.000Z' });
  assert.deepEqual([result.outcome, result.revision], ['updated', 3]);
  const [root, item, audits] = await Promise.all([rootRef.get(), itemRef.get(), firestore.collection(`cartularies/${IWC_CARTULARY_ID}/auditEvents`).orderBy('sequence').get()]);
  assert.deepEqual([root.data().lifecycleStatus, root.data().completenessLevel, root.data().lastVerifiedAt, root.data().lastGenericOperationToken], ['active', 'partial', '2026-08-16T08:03:00.000Z', token]);
  assert.deepEqual([root.data().modelName, root.data().primaryAssetId, root.data().collectionId], [before.modelName, before.primaryAssetId, before.collectionId], 'la revue ne réécrit rien d’autre');
  assert.deepEqual([item.data().lifecycleStatus, item.data().completenessLevel, item.data().sourceRevision], ['active', 'partial', 3], 'item recopié');
  assert.equal('lastVerifiedAt' in item.data(), false, 'D3-a : la date reste hors projection');
  assert.deepEqual(item.data().thumbnail, expectedLiveThumbnail(), 'aides de présentation conservées');
  const { thumbnail: _thumbnail, primaryMediaKind: _kind, thumbnailStatus: _status, contentHash, generatedAt: _generatedAt, updatedAt: _updatedAt, ...projection } = item.data();
  assert.equal(contentHash, sha256Digest(projection), 'contentHash = sha256Digest(projection) hors thumbnail/primaryMediaKind/thumbnailStatus/generatedAt/updatedAt');
  const reviewEvent = audits.docs.at(-1).data();
  assert.deepEqual([reviewEvent.action, reviewEvent.resource, reviewEvent.requestId], [REVIEW_CONFIRMED_ACTION, { type: 'cartulary', id: IWC_CARTULARY_ID }, requestId]);
  assert.equal(reviewEvent.action, 'cartulary.review.confirmed');
  assert.equal(reviewEvent.eventId, `evt_${sha256Digest(`cartulary.review.confirmed:${requestId}`).slice(7, 31)}`, 'graine = action:requestId, jamais le jeton');
  assert.equal(JSON.stringify(reviewEvent).includes(token), false, 'le jeton d’opération n’entre pas dans la chaîne de preuves');
  const verification = verifyAuditChain({ events: audits.docs.map((document) => document.data()), integrityHead: root.data().integrityHead, integritySequence: root.data().integritySequence });
  assert.deepEqual([verification.valid, verification.eventCount], [true, 3], 'chaîne valide, eventCount +1');
  assert.equal((await firestore.doc(`cartularySyncRequests/${IWC_CARTULARY_ID}`).get()).data().auditEventId, reviewEvent.eventId);

  // Rejeu du même brouillon : no_change, date inchangée.
  await firestore.doc(`cartularySyncRequests/${IWC_CARTULARY_ID}`).set({
    requestDocumentId: IWC_CARTULARY_ID, requestId: 'sync_test_review_000000000000002', ownerUid: 'wave1-owner', cartularyId: IWC_CARTULARY_ID, reason: 'manual_retry', status: 'pending',
  });
  const replay = await processCartularySyncRequest({ storage, firestore, requestDocumentId: IWC_CARTULARY_ID, occurredAt: '2026-08-16T08:04:00.000Z' });
  assert.equal(replay.outcome, 'no_change');
  assert.deepEqual([(await rootRef.get()).data().revision, (await rootRef.get()).data().lastVerifiedAt], [3, '2026-08-16T08:03:00.000Z']);

  // baseRevision périmée : rejet revision_conflict, racine intacte (comportement persistant jusqu'au rejeu, motif cartulary-create.test.mjs).
  await writeReviewAndRequest({ level: 'complete', token: 'op_review_stale_00000000000003', requestId: 'sync_test_review_000000000000011', baseRevision: 2, revision: 2 });
  await assert.rejects(processCartularySyncRequest({ storage, firestore, requestDocumentId: IWC_CARTULARY_ID, occurredAt: '2026-08-16T08:05:00.000Z' }), (error) => error.code === 'revision_conflict');
  const intact = (await rootRef.get()).data();
  assert.deepEqual([intact.revision, intact.completenessLevel, intact.lastVerifiedAt, intact.lastGenericOperationToken], [3, 'partial', '2026-08-16T08:03:00.000Z', token]);

  // Opération sections ultérieure (catalogue watch@1.3.0 : champ cover.watch.model seul) : la date de revue ne bouge pas,
  // l'événement redevient cartulary.live_state.synced — une édition générique n'est pas une revue.
  const modelField = JSON.parse(readFileSync(new URL('../firebase/schema-catalog/watch/1.3.0.json', import.meta.url), 'utf8')).fields.find((field) => field.fieldId === 'cover.watch.model');
  await firestore.doc(`schemaCatalog/watch/versions/1.3.0/sections/${modelField.sectionId}`).set({ id: modelField.sectionId });
  await firestore.doc(`schemaCatalog/watch/versions/1.3.0/sections/${modelField.sectionId}/fields/${modelField.fieldId}`).set(JSON.parse(JSON.stringify(modelField)));
  await firestore.doc(`privateDrafts/wave1-owner/cartularies/${IWC_CARTULARY_ID}/state/cartularia-generic-sections`).set({ key: 'cartularia-generic-sections', value: JSON.stringify({ version: 1, schemaId: 'watch', schemaVersion: '1.3.0', baseRevision: 3, edits: [{ fieldId: 'cover.watch.model', value: 'Flieger UTC revue puis corrigée' }] }), deleted: false, revision: 1, clientUpdatedAt: 300 });
  await firestore.doc(`privateDrafts/wave1-owner/cartularies/${IWC_CARTULARY_ID}/state/cartularia-generic-operation`).set({ key: 'cartularia-generic-operation', value: JSON.stringify({ kind: 'sections', token: 'op_sections_after_review_00004' }), deleted: false, revision: 3, clientUpdatedAt: 301 });
  await firestore.doc(`cartularySyncRequests/${IWC_CARTULARY_ID}`).set({ requestDocumentId: IWC_CARTULARY_ID, requestId: 'op_sections_after_review_00004', ownerUid: 'wave1-owner', cartularyId: IWC_CARTULARY_ID, reason: 'private_draft_synchronized', status: 'pending' });
  const sections = await processCartularySyncRequest({ storage, firestore, requestDocumentId: IWC_CARTULARY_ID, occurredAt: '2026-08-16T08:06:00.000Z' });
  assert.deepEqual([sections.outcome, sections.revision], ['updated', 4]);
  const afterSections = (await rootRef.get()).data();
  assert.deepEqual([afterSections.modelName, afterSections.lifecycleStatus, afterSections.completenessLevel, afterSections.lastVerifiedAt], ['Flieger UTC revue puis corrigée', 'active', 'partial', '2026-08-16T08:03:00.000Z'], 'opération sections ultérieure : lastVerifiedAt inchangé');
  assert.equal((await firestore.collection(`cartularies/${IWC_CARTULARY_ID}/auditEvents`).orderBy('sequence').get()).docs.at(-1).data().action, 'cartulary.live_state.synced');

  // Cycle inactif : la revue est refusée (review_not_allowed), racine intacte.
  await rootRef.update({ lifecycleStatus: 'suspended' });
  const suspended = (await rootRef.get()).data();
  await writeReviewAndRequest({ level: 'complete', token: 'op_review_denied_0000000000005', requestId: 'sync_test_review_000000000000012', baseRevision: suspended.revision, revision: 3 });
  await assert.rejects(processCartularySyncRequest({ storage, firestore, requestDocumentId: IWC_CARTULARY_ID, occurredAt: '2026-08-16T08:07:00.000Z' }), (error) => error.code === 'review_not_allowed');
  const denied = (await rootRef.get()).data();
  assert.deepEqual([denied.revision, denied.lifecycleStatus, denied.completenessLevel, denied.lastVerifiedAt], [suspended.revision, 'suspended', 'partial', '2026-08-16T08:03:00.000Z']);
});

test('une resynchronisation conserve le miroir et la vignette quand le manifeste ne porte plus de variantes', async () => {
  await writeDraftAndRequest('sync_test_live_0000000000000030');
  await processCartularySyncRequest({ storage, firestore, requestDocumentId: IWC_CARTULARY_ID, occurredAt: '2026-08-16T08:02:00.000Z' });
  const draftPath = `privateDrafts/wave1-owner/cartularies/${IWC_CARTULARY_ID}`;
  const itemRef = firestore.doc(`registries/reg_collection_privee/items/${IWC_CARTULARY_ID}`);
  const assetRef = firestore.doc(`cartularies/${IWC_CARTULARY_ID}/assets/asset-live-photo`);
  const mirrorBefore = (await assetRef.get()).data().privatePresentation;
  // Manifeste ramené à l'état antérieur à V3 (copie v2 seule) : le miroir et la vignette déjà posés survivent (K3).
  await firestore.doc(`${draftPath}/binaries/media-binary-live-0001`).update({ presentationDerivative: { storagePath: `private-derivatives/wave1-owner/${IWC_CARTULARY_ID}/media-binary-live-0001/presentation-v2.webp`, mimeType: 'image/webp' } });
  await firestore.doc(`${draftPath}/state/cartularia-user-alias`).set({ key: 'cartularia-user-alias', value: JSON.stringify('Alias raccordé'), deleted: false, revision: 1, clientUpdatedAt: 30 });
  await firestore.doc(`cartularySyncRequests/${IWC_CARTULARY_ID}`).set({
    requestDocumentId: IWC_CARTULARY_ID, requestId: 'sync_test_live_0000000000000031', ownerUid: 'wave1-owner', cartularyId: IWC_CARTULARY_ID, reason: 'manual_retry', status: 'pending',
  });
  const result = await processCartularySyncRequest({ storage, firestore, requestDocumentId: IWC_CARTULARY_ID, occurredAt: '2026-08-16T08:03:00.000Z' });
  assert.equal(result.outcome, 'updated');
  const item = (await itemRef.get()).data();
  assert.equal(item.userAlias, 'Alias raccordé');
  assert.deepEqual(item.thumbnail, expectedLiveThumbnail());
  assert.equal(item.primaryMediaKind, 'image');
  assert.equal(item.thumbnailStatus, 'ready');
  assert.deepEqual((await assetRef.get()).data().privatePresentation, mirrorBefore);
});

test('deux exécutions concurrentes ne produisent qu’une seule révision utile', async () => {
  await writeDraftAndRequest('sync_test_live_0000000000000010');
  const results = await Promise.all([
    processCartularySyncRequest({ storage,
      firestore,
      requestDocumentId: IWC_CARTULARY_ID,
      occurredAt: '2026-08-16T08:05:00.000Z',
    }),
    processCartularySyncRequest({ storage,
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
  await processCartularySyncRequest({ storage,
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
    processCartularySyncRequest({ storage,
      firestore,
      requestDocumentId: IWC_CARTULARY_ID,
      occurredAt: '2026-08-16T08:11:00.000Z',
      rateLimitPerHour: 1,
    }),
    (error) => error?.code === 'rate_limited',
  );
  assert.equal((await firestore.doc(`cartularySyncRequests/${IWC_CARTULARY_ID}`).get()).data().status, 'pending');
});
