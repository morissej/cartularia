import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { processCartularyCreateRequest } from '../scripts/lib/create-cartulary-command.mjs';
import { processCartularySyncRequest } from '../scripts/lib/live-sync-command.mjs';
import { CAR_SCHEMA_FIELDS } from '../src/schema/carSchema.ts';
import { verifyAuditChain } from '../scripts/lib/audit-verifier.mjs';

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
    title: 'Identification',
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
    firestore.doc('registries/reg_collection_privee/collections/col_pilots').set({ id: 'col_pilots', registryId: 'reg_collection_privee', organizationId: 'org_demo', name: 'Collection pilote', status: 'draft' }),
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

test('une collection archivée bloque la création avant toute écriture du Cartulaire', async () => {
  await firestore.doc('registries/reg_collection_privee/collections/col_pilots').update({ status: 'archived' });
  await assert.rejects(processCartularyCreateRequest({ firestore, requestDocumentId: cartularyId }), (error) => error.code === 'collection_not_ready');
  assert.equal((await firestore.doc(`cartularies/${cartularyId}`).get()).exists, false);
});

test('création automobile puis édition autoritaire : schéma, confidentialité, médias et rappels préservés', async () => {
  const profileRef = firestore.doc(`${draftPath}/state/cartularia-creation-profile`);
  const originalProfile = JSON.parse((await profileRef.get()).data().value);
  await profileRef.update({ value: JSON.stringify({ ...originalProfile, assetType: 'car', schemaId: 'car', schemaVersion: '1.2.0', brand: 'Constructeur', model: 'Voiture', reference: 'Version', manufactureYear: 1967, serialNumber: 'VIN-HISTORIQUE' }) });
  await firestore.doc('schemaCatalog/car/versions/1.2.0').set({ schemaId: 'car', version: '1.2.0', assetType: 'car', status: 'active' });
  const batch = firestore.batch();
  for (const field of CAR_SCHEMA_FIELDS) {
    const section = firestore.doc(`schemaCatalog/car/versions/1.2.0/sections/${field.sectionId}`);
    batch.set(section, { id: field.sectionId });
    batch.set(section.collection('fields').doc(field.fieldId), JSON.parse(JSON.stringify(field)));
  }
  await batch.commit();
  await processCartularyCreateRequest({ firestore, requestDocumentId: cartularyId });
  await processCartularySyncRequest({ firestore, requestDocumentId: cartularyId });
  const rootRef = firestore.doc(`cartularies/${cartularyId}`);
  const beforeEdit = (await rootRef.get()).data();
  assert.equal(beforeEdit.assetType, 'car'); assert.equal(beforeEdit.modelName, 'Voiture');
  assert.equal(beforeEdit.purchasePrice, 21900); assert.equal(beforeEdit.grossValuation, 21900);
  await Promise.all([
    firestore.doc(`${draftPath}/state/cartularia-media-assets-v3`).delete(),
    rootRef.collection('reminders').doc('todo_preserved').set({ id: 'todo_preserved', title: 'Contrôle technique', visibility: 'secret', liveSyncManaged: true }),
  ]);
  const genericStateRef = firestore.doc(`${draftPath}/state/cartularia-generic-sections`);
  const payload = { version: 1, schemaId: 'car', schemaVersion: '1.2.0', baseRevision: beforeEdit.revision,
    edits: [{ fieldId: 'cover.car.model', value: 'Voiture corrigée' }, { fieldId: 'identity.car.vin', value: 'VIN-CORRIGE' }, { fieldId: 'value.retained.amount', value: { amount: 30000, currency: 'EUR' } }] };
  await genericStateRef.set({ key: 'cartularia-generic-sections', value: JSON.stringify(payload), deleted: false, revision: 1, clientUpdatedAt: 20 });
  const syncRef = firestore.doc(`cartularySyncRequests/${cartularyId}`);
  await syncRef.set({ requestDocumentId: cartularyId, requestId: 'sync_generic_edit_0001', ownerUid, cartularyId, status: 'pending' });
  await processCartularySyncRequest({ firestore, requestDocumentId: cartularyId });
  const afterEdit = (await rootRef.get()).data();
  const itemAfterEdit = (await firestore.doc(`registries/reg_collection_privee/items/${cartularyId}`).get()).data();
  assert.equal(afterEdit.modelName, 'Voiture corrigée'); assert.equal(itemAfterEdit.modelName, 'Voiture corrigée');
  assert.equal(afterEdit.schemaVersion, '1.2.0'); assert.equal(afterEdit.objectCode, 'ROL-TEST01');
  assert.equal(itemAfterEdit.grossValuation, 30000); assert.equal(itemAfterEdit.netValuation, null);
  assert.equal(itemAfterEdit.purchasePrice, 21900); assert.equal(itemAfterEdit.costBasis, 21900);
  assert.equal(JSON.stringify(itemAfterEdit).includes('VIN-CORRIGE'), false);
  const identity = (await rootRef.collection('sections').doc('identity.private').get()).data();
  assert.equal(identity.fields['identity.car.vin'].value, 'VIN-CORRIGE'); assert.equal(identity.fields['identity.car.vin'].visibility, 'secret');
  assert.equal((await rootRef.collection('assets').doc('asset_rolex_cover').get()).data().projectionStatus, 'active');
  assert.equal((await rootRef.collection('reminders').doc('todo_preserved').get()).exists, true);
  const audits = await rootRef.collection('auditEvents').orderBy('sequence').get();
  assert.equal(verifyAuditChain({ events: audits.docs.map((document) => document.data()), integrityHead: afterEdit.integrityHead, integritySequence: afterEdit.integritySequence }).valid, true);
  await syncRef.set({ requestDocumentId: cartularyId, requestId: 'sync_generic_retry_0002', ownerUid, cartularyId, status: 'pending' });
  assert.equal((await processCartularySyncRequest({ firestore, requestDocumentId: cartularyId })).outcome, 'no_change');
  await genericStateRef.update({ value: JSON.stringify({ ...payload, edits: [{ fieldId: 'cover.car.model', value: 'Écrasement obsolète' }] }), revision: 2 });
  await syncRef.set({ requestDocumentId: cartularyId, requestId: 'sync_generic_stale_0003', ownerUid, cartularyId, status: 'pending' });
  await assert.rejects(processCartularySyncRequest({ firestore, requestDocumentId: cartularyId }), (error) => error.code === 'revision_conflict');
  assert.equal((await rootRef.get()).data().modelName, 'Voiture corrigée');
  await genericStateRef.update({ value: JSON.stringify({ ...payload, baseRevision: afterEdit.revision, edits: [{ fieldId: 'cover.car.model', value: 'Accès retiré' }] }), revision: 3 });
  await firestore.doc(`organizations/org_demo/memberships/${ownerUid}`).update({ roles: ['read_only'], permissions: ['cartulary.read'] });
  await syncRef.set({ requestDocumentId: cartularyId, requestId: 'sync_generic_denied_0004', ownerUid, cartularyId, status: 'pending' });
  await assert.rejects(processCartularySyncRequest({ firestore, requestDocumentId: cartularyId }), (error) => error.code === 'permission_denied');
  assert.equal((await rootRef.get()).data().modelName, 'Voiture corrigée');
});

test('enrichissement média explicite : ajout vérifié, autorisation, retrait et rejeu sans résurrection', async () => {
  await processCartularyCreateRequest({ firestore, requestDocumentId: cartularyId });
  await processCartularySyncRequest({ firestore, requestDocumentId: cartularyId });
  const rootRef = firestore.doc(`cartularies/${cartularyId}`);
  const mediaRef = firestore.doc(`${draftPath}/state/cartularia-generic-media`);
  const requestRef = firestore.doc(`cartularySyncRequests/${cartularyId}`);
  await firestore.doc(`${draftPath}/binaries/bin_added_verified`).set({ ownerUid, cartularyId, binaryId: 'bin_added_verified', deleted: false, revision: 1, kind: 'media', mimeType: 'image/jpeg', fileName: 'ajout.jpg', size: 3,
    sha256: `sha256:${'b'.repeat(64)}`, storagePath: `private-drafts/${ownerUid}/${cartularyId}/bin_added_verified/${'b'.repeat(64)}/original`, uploadStatus: 'ready', verificationStatus: 'accepted' });
  const syncMutation = async (mutation, token) => {
    const current = (await rootRef.get()).data();
    await mediaRef.set({ key: 'cartularia-generic-media', value: JSON.stringify({ version: 1, baseRevision: current.revision, ...mutation }), deleted: false, revision: current.revision, clientUpdatedAt: 50 + current.revision });
    await firestore.doc(`${draftPath}/state/cartularia-generic-operation`).set({ key: 'cartularia-generic-operation', value: JSON.stringify({ kind: 'media', token }), deleted: false, revision: current.revision, clientUpdatedAt: 50 + current.revision });
    await requestRef.set({ requestDocumentId: cartularyId, requestId: token, ownerUid, cartularyId, status: 'pending' });
    const result = await processCartularySyncRequest({ firestore, requestDocumentId: cartularyId });
    assert.equal((await rootRef.get()).data().lastGenericOperationToken, token);
    return result;
  };
  await firestore.doc(`${draftPath}/state/cartularia-generic-sections`).set({ key: 'cartularia-generic-sections', value: JSON.stringify({ version: 1, baseRevision: 1, edits: [{ fieldId: 'unlisted.field', value: 'Essai abandonné' }] }), deleted: false, revision: 1, clientUpdatedAt: 12 });
  await syncMutation({ changes: [{ id: 'asset_added', binaryId: 'bin_added_verified', name: 'Nouvelle photo', tags: ['main-photo'] }], removeIds: [] }, 'sync_media_add_001');
  assert.equal((await rootRef.collection('assets').doc('asset_added').get()).data().visibility, 'secret');
  assert.equal((await rootRef.get()).data().primaryAssetId, 'asset_added');
  assert.equal((await rootRef.collection('assets').doc('asset_rolex_cover').get()).data().projectionStatus, 'active');
  await syncMutation({ changes: [{ id: 'asset_added', visibility: 'Tous' }], confirmedPublicIds: ['asset_added'], removeIds: [] }, 'sync_media_authorize_002');
  const authorized = (await rootRef.collection('assets').doc('asset_added').get()).data();
  assert.equal(authorized.requestedVisibility, 'public'); assert.equal(authorized.visibility, 'secret');
  assert.notEqual((await rootRef.get()).data().publicationStatus, 'published');
  await syncMutation({ changes: [], removeIds: ['asset_added'], confirmedRemoval: true }, 'sync_media_remove_003');
  assert.equal((await rootRef.collection('assets').doc('asset_added').get()).data().projectionStatus, 'withdrawn');
  await firestore.doc(`${draftPath}/state/cartularia-user-alias`).set({ key: 'cartularia-user-alias', value: JSON.stringify('Alias mis à jour'), deleted: false, revision: 1, clientUpdatedAt: 100 });
  await requestRef.set({ requestDocumentId: cartularyId, requestId: 'sync_media_later_005', ownerUid, cartularyId, status: 'pending' });
  await processCartularySyncRequest({ firestore, requestDocumentId: cartularyId });
  assert.equal((await rootRef.collection('assets').doc('asset_added').get()).data().projectionStatus, 'withdrawn');
  await firestore.doc('registries/reg_collection_privee/collections/col_after_generic').set({ id: 'col_after_generic', registryId: 'reg_collection_privee', organizationId: 'org_demo', status: 'draft' });
  await firestore.doc(`${draftPath}/state/cartularia-collection-id`).set({ key: 'cartularia-collection-id', value: JSON.stringify('col_after_generic'), deleted: false, revision: 2, clientUpdatedAt: 101 });
  const legacyMediaRef = firestore.doc(`${draftPath}/state/cartularia-media-assets-v3`);
  const legacyMedia = JSON.parse((await legacyMediaRef.get()).data().value);
  await legacyMediaRef.update({ value: JSON.stringify(legacyMedia.map((asset) => ({ ...asset, name: 'Nom changé dans le parcours normal' }))), revision: 2, clientUpdatedAt: 102 });
  await requestRef.set({ requestDocumentId: cartularyId, requestId: 'sync_legacy_after_generic_006', ownerUid, cartularyId, status: 'pending' });
  await processCartularySyncRequest({ firestore, requestDocumentId: cartularyId });
  assert.equal((await rootRef.get()).data().collectionId, 'col_after_generic');
  assert.equal((await rootRef.collection('assets').doc('asset_rolex_cover').get()).data().displayName, 'Nom changé dans le parcours normal');
  assert.equal((await firestore.doc(`${draftPath}/binaries/bin_added_verified`).get()).data().deleted, false);
  await requestRef.set({ requestDocumentId: cartularyId, requestId: 'sync_media_replay_004', ownerUid, cartularyId, status: 'pending' });
  assert.equal((await processCartularySyncRequest({ firestore, requestDocumentId: cartularyId })).outcome, 'no_change');
  assert.equal((await rootRef.collection('assets').doc('asset_added').get()).data().projectionStatus, 'withdrawn');
});
