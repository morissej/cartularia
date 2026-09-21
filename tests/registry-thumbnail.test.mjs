import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { processCartularyCreateRequest } from '../scripts/lib/create-cartulary-command.mjs';
import { processCartularySyncRequest } from '../scripts/lib/live-sync-command.mjs';
import { projectRegistryItem } from '../scripts/lib/projection-command.mjs';
import { PRIVATE_UPLOAD_VERIFICATION_CUTOFF_MS, PRIVATE_UPLOAD_VERIFICATION_VERSION } from '../scripts/lib/private-upload-command.mjs';
import { presentationVariantPath } from '../scripts/lib/presentation-variants.mjs';
import { sha256Digest } from '../scripts/lib/canonical-json.mjs';
import {
  assetPrivatePresentationFor,
  normalizeRegistryThumbnail,
  registryItemAuditText,
  registryItemPresentationFields,
  registryItemThumbnailFor,
  registryThumbnailStatusFor,
} from '../scripts/lib/registry-thumbnail.mjs';
import { createMemoryFirestore } from './helpers/memory-firestore.mjs';
import { createPrivateOriginalStorage, verifiedPrivateBinary } from './helpers/private-original-fixture.mjs';
const storageByFirestore = new WeakMap();

/**
 * Lot serveur B (contrat V3, K3) en mémoire, propriétaire et identifiants distincts des fixtures :
 * création → projection → synchronisation posent assets.privatePresentation et items.thumbnail (kind inline),
 * hors contentHash ; une réécriture d'item conserve la vignette (script, backlog, seed) ; jamais de faux état.
 */
const digestOf = (text) => `sha256:${createHash('sha256').update(Buffer.from(text)).digest('hex')}`;
const UID = 'owner_v3_registry_vignettes';
const ORGANIZATION = 'org_v3_registry_vignettes';
const REGISTRY = 'reg_v3_registry_vignettes';
const COLLECTION = 'col_v3_vignettes';
const CARTULARY = 'cart_v3_registry_object_77aa';
const BINARY = 'bin_v3_registry_cover_0001';
const VIDEO_BINARY = 'bin_v3_registry_video_0002';
const ASSET = 'asset_v3_cover';
const VIDEO_ASSET = 'asset_v3_video';
const REQUEST = 'create_v3registryvignettes00000001';
const ORIGINAL_DIGEST = digestOf('original-jpeg-bytes');
const THUMBNAIL_DATA_URL = `data:image/webp;base64,${Buffer.from('RIFF-webp-240-fixture-bytes').toString('base64')}`;
const originalPath = (binaryId, digest) => `private-drafts/${UID}/${CARTULARY}/${binaryId}/${digest.replace('sha256:', '')}/original`;

const variant = (width, height) => ({
  width, height, storagePath: presentationVariantPath(UID, CARTULARY, BINARY, width), sha256: digestOf(`v${width}`), size: 100 + width, mimeType: 'image/webp',
});
const acceptedManifest = (binaryId, digest, overrides = {}) => verifiedPrivateBinary({
  ownerUid: UID, cartularyId: CARTULARY, binaryId, kind: 'media', fileName: 'cover.jpg', mimeType: 'image/jpeg', size: 4_321, sha256: digest,
  storagePath: originalPath(binaryId, digest), deleted: false, revision: 1, clientUpdatedAt: 10, uploadStatus: 'ready',
  verificationStatus: 'accepted', verificationVersion: PRIVATE_UPLOAD_VERIFICATION_VERSION, ...overrides,
});
const presentationDerivative = () => ({
  storagePath: `private-derivatives/${UID}/${CARTULARY}/${BINARY}/presentation-v2.webp`, mimeType: 'image/webp', width: 2_400, height: 1_600,
  sourceSha256: ORIGINAL_DIGEST, variantsVersion: 'presentation-v3', variantsGeneratedAt: '2026-09-14T10:00:00.000Z', variantsFailure: null,
  variants: [variant(240, 160), variant(480, 320), variant(768, 512)],
  thumbnail: { dataUrl: THUMBNAIL_DATA_URL, width: 240, height: 160, sha256: digestOf('v240') },
});
const inlineThumbnail = (assetId = ASSET) => ({ kind: 'inline', dataUrl: THUMBNAIL_DATA_URL, width: 240, height: 160, assetId, sha256: digestOf('v240') });
const bundleThumbnail = (assetId = ASSET) => ({ kind: 'bundle', path: '/assets/IWC/derivatives/Focus Shift White Front.240.webp', width: 240, height: 160, assetId, sha256: digestOf('bundle-240') });
const FORBIDDEN_ITEM_WORDS = ['serial', 'owner', 'acquisition', 'storage', 'address'];

const media = () => [{
  id: ASSET, name: 'Photo de couverture', originalFileName: 'cover.jpg', type: 'image', mimeType: 'image/jpeg', binaryId: BINARY,
  tags: ['main-photo', 'slideshow'], category: 'ensemble', visibility: 'Secret', capturedAt: '2026-09-01T10:00:00.000Z', timestampSource: 'file.lastModified',
}];
const profile = () => ({
  profileVersion: '1.0.0', assetType: 'watch', schemaId: 'watch', schemaVersion: '1.6.0', collectionId: COLLECTION,
  brand: 'Maison', model: 'Modèle de recette', reference: 'REF-V3', manufactureYear: 1998, serialNumber: '00-11-22', caliber: '3135',
  description: 'Objet de recette du lot serveur B.', conditionSummary: 'À confirmer.', purchaseDate: '2026-07-01', purchasePrice: 1_000, currency: 'EUR',
  seller: 'Vendeur', valuationDate: '2026-07-01', valuationLow: 900, valuationMid: 1_000, valuationHigh: 1_100, sourceLabel: 'Saisie', assertedAt: '2026-09-14T09:00:00.000Z',
});
const stateDocument = (key, value, revision = 1) => ({ key, value: JSON.stringify(value), deleted: false, revision, clientUpdatedAt: 10 + revision });

const seed = async ({ withVariants = true } = {}) => {
  const draftPath = `privateDrafts/${UID}/cartularies/${CARTULARY}`;
  const firestore = createMemoryFirestore({
    [`organizations/${ORGANIZATION}`]: { id: ORGANIZATION, status: 'active' },
    [`registries/${REGISTRY}`]: { id: REGISTRY, organizationId: ORGANIZATION, status: 'active', visibility: 'secret', itemCount: 0 },
    [`registries/${REGISTRY}/collections/${COLLECTION}`]: { id: COLLECTION, registryId: REGISTRY, organizationId: ORGANIZATION, name: 'Collection de recette', status: 'draft' },
    [`organizations/${ORGANIZATION}/memberships/${UID}`]: {
      uid: UID, organizationId: ORGANIZATION, roles: ['account_holder', 'legal_owner'], status: 'active',
      scopes: { registryIds: [REGISTRY] }, permissions: ['registry.read', 'cartulary.read', 'cartulary.edit', 'publication.manage'],
    },
    'schemaCatalog/watch/versions/1.6.0': { schemaId: 'watch', assetType: 'watch', version: '1.6.0', status: 'active' },
    [draftPath]: { ownerUid: UID, cartularyId: CARTULARY, status: 'active' },
    [`${draftPath}/state/cartularia-creation-profile`]: stateDocument('cartularia-creation-profile', profile()),
    [`${draftPath}/state/cartularia-media-assets-v3`]: stateDocument('cartularia-media-assets-v3', media()),
    [`${draftPath}/binaries/${BINARY}`]: acceptedManifest(BINARY, ORIGINAL_DIGEST, withVariants ? { presentationDerivative: presentationDerivative() } : {}),
    [`cartularyCreateRequests/${CARTULARY}`]: {
      requestDocumentId: CARTULARY, requestId: REQUEST, ownerUid: UID, cartularyId: CARTULARY, organizationId: ORGANIZATION, registryId: REGISTRY, publicCode: 'V3-VIGN01', status: 'pending',
    },
  });
  const storage = createPrivateOriginalStorage([await read(firestore, `${draftPath}/binaries/${BINARY}`)]);
  storageByFirestore.set(firestore, storage);
  return { firestore, draftPath, storage };
};

const itemPath = `registries/${REGISTRY}/items/${CARTULARY}`;
const assetPath = (assetId) => `cartularies/${CARTULARY}/assets/${assetId}`;
const read = async (firestore, path) => (await firestore.doc(path).get()).data();
const requestSync = async (firestore, requestId) => {
  await firestore.doc(`cartularySyncRequests/${CARTULARY}`).set({ requestDocumentId: CARTULARY, requestId, ownerUid: UID, cartularyId: CARTULARY, reason: 'test', status: 'pending' });
  return processCartularySyncRequest({ firestore, storage: storageByFirestore.get(firestore), requestDocumentId: CARTULARY, occurredAt: '2026-09-14T10:05:00.000Z' });
};
const projectionOf = (item) => {
  const { thumbnail, primaryMediaKind, thumbnailStatus, contentHash, ...projection } = item;
  delete projection.generatedAt;
  delete projection.updatedAt;
  return { projection, thumbnail, primaryMediaKind, thumbnailStatus, contentHash };
};

test('normalizeRegistryThumbnail ne garde que les vignettes du contrat, sans clé étrangère', () => {
  assert.deepEqual(normalizeRegistryThumbnail({ ...inlineThumbnail(), generatedAt: 'x', storagePath: 'private-derivatives/leak' }), inlineThumbnail());
  assert.deepEqual(normalizeRegistryThumbnail({ ...bundleThumbnail(), url: '/leak' }), bundleThumbnail());
  assert.equal(normalizeRegistryThumbnail({ ...inlineThumbnail(), dataUrl: 'data:image/webp;base64,<script>' }), null);
  assert.equal(normalizeRegistryThumbnail({ ...inlineThumbnail(), dataUrl: `data:image/png;base64,${'A'.repeat(16)}` }), null);
  assert.equal(normalizeRegistryThumbnail({ ...inlineThumbnail(), dataUrl: `data:image/webp;base64,${'A'.repeat(24_000)}` }), null);
  assert.equal(normalizeRegistryThumbnail({ ...inlineThumbnail(), width: 480 }), null);
  assert.equal(normalizeRegistryThumbnail({ ...bundleThumbnail(), path: '//evil.example/x.240.webp' }), null);
  assert.equal(normalizeRegistryThumbnail({ ...bundleThumbnail(), path: '/assets/../x.240.webp' }), null);
  assert.equal(normalizeRegistryThumbnail({ ...bundleThumbnail(), kind: 'storage' }), null);
  assert.equal(normalizeRegistryThumbnail({ ...inlineThumbnail(), assetId: '' }), null);
  assert.equal(normalizeRegistryThumbnail(null), null);
});

test('la vignette d’item vient de l’asset primaire, sinon est conservée pour le même asset, jamais recopiée d’un autre', () => {
  const primaryAsset = { mediaKind: 'image', privatePresentation: { binaryId: BINARY, version: 'presentation-v3', variants: [variant(240, 160)], thumbnail: { dataUrl: THUMBNAIL_DATA_URL, width: 240, height: 160, sha256: digestOf('v240') } } };
  assert.deepEqual(registryItemThumbnailFor({ primaryAssetId: ASSET, primaryAsset, existingThumbnail: bundleThumbnail() }), inlineThumbnail());
  assert.deepEqual(registryItemThumbnailFor({ primaryAssetId: ASSET, primaryAsset: { mediaKind: 'image' }, existingThumbnail: bundleThumbnail() }), bundleThumbnail());
  assert.equal(registryItemThumbnailFor({ primaryAssetId: 'asset_other', primaryAsset: { mediaKind: 'image' }, existingThumbnail: bundleThumbnail() }), null);
  assert.equal(registryItemThumbnailFor({ primaryAssetId: null, primaryAsset, existingThumbnail: inlineThumbnail() }), null);
  assert.deepEqual(registryItemPresentationFields({ primaryAssetId: VIDEO_ASSET, primaryAsset: { mediaKind: 'video' }, existingItem: { thumbnail: inlineThumbnail(), primaryMediaKind: 'image' } }), { thumbnail: null, primaryMediaKind: 'video', thumbnailStatus: 'none' });
  assert.deepEqual(registryItemPresentationFields({ primaryAssetId: ASSET, primaryAsset: null, existingItem: { thumbnail: inlineThumbnail(), primaryMediaKind: 'image' } }), { thumbnail: inlineThumbnail(), primaryMediaKind: 'image', thumbnailStatus: 'ready' });
  assert.deepEqual(registryItemPresentationFields({ primaryAssetId: ASSET, primaryAsset: { mediaKind: 'hologram' }, existingItem: null }), { thumbnail: null, primaryMediaKind: null, thumbnailStatus: 'none' });
});

test('thumbnailStatus (K3 étendu, tour 4 point 2) : ready / pending / failed / none, jamais un « en préparation » perpétuel', () => {
  const image = { mediaKind: 'image' };
  assert.equal(registryThumbnailStatusFor({ primaryAssetId: ASSET, primaryAsset: image, thumbnail: inlineThumbnail(), primaryBinary: null }), 'ready');
  assert.equal(registryThumbnailStatusFor({ primaryAssetId: ASSET, primaryAsset: image, thumbnail: bundleThumbnail(), primaryBinary: null }), 'ready');
  assert.equal(registryThumbnailStatusFor({ primaryAssetId: ASSET, primaryAsset: image, thumbnail: inlineThumbnail('asset_other'), primaryBinary: null }), 'pending', 'une vignette d’un autre asset ne vaut pas « prête »');
  assert.equal(registryThumbnailStatusFor({ primaryAssetId: ASSET, primaryAsset: image, thumbnail: null, primaryBinary: null }), 'pending', 'manifeste illisible : jamais un échec');
  assert.equal(registryThumbnailStatusFor({ primaryAssetId: ASSET, primaryAsset: image, thumbnail: null, primaryBinary: acceptedManifest(BINARY, ORIGINAL_DIGEST) }), 'pending');
  assert.equal(registryThumbnailStatusFor({ primaryAssetId: ASSET, primaryAsset: image, thumbnail: null, primaryBinary: acceptedManifest(BINARY, ORIGINAL_DIGEST, { presentationDerivative: { variantsFailure: 'variants_processing_failed', variants: [] } }) }), 'failed');
  assert.equal(registryThumbnailStatusFor({ primaryAssetId: ASSET, primaryAsset: image, thumbnail: null, primaryBinary: acceptedManifest(BINARY, ORIGINAL_DIGEST, { verificationStatus: 'rejected', uploadStatus: 'failed' }) }), 'failed');
  assert.equal(registryThumbnailStatusFor({ primaryAssetId: VIDEO_ASSET, primaryAsset: { mediaKind: 'video' }, thumbnail: null, primaryBinary: null }), 'none');
  assert.equal(registryThumbnailStatusFor({ primaryAssetId: ASSET, primaryAsset: { mediaKind: 'document' }, thumbnail: null, primaryBinary: null }), 'none');
  assert.equal(registryThumbnailStatusFor({ primaryAssetId: ASSET, primaryAsset: null, thumbnail: null, primaryBinary: null }), 'none', 'nature inconnue : rien n’est promis');
  assert.equal(registryThumbnailStatusFor({ primaryAssetId: null, primaryAsset: image, thumbnail: inlineThumbnail(), primaryBinary: null }), 'none');
  assert.deepEqual(registryItemPresentationFields({ primaryAssetId: ASSET, primaryAsset: image, existingItem: null, primaryBinary: acceptedManifest(BINARY, ORIGINAL_DIGEST, { presentationDerivative: { variantsFailure: 'invalid_dimensions', variants: [] } }) }), { thumbnail: null, primaryMediaKind: 'image', thumbnailStatus: 'failed' });
});

test('le miroir privatePresentation suit le binaire vérifié et ne survit pas à un changement de binaire', () => {
  const identity = { uid: UID, cartularyId: CARTULARY, binaryId: BINARY };
  const mirror = assetPrivatePresentationFor({ binary: acceptedManifest(BINARY, ORIGINAL_DIGEST, { presentationDerivative: presentationDerivative() }), identity, existing: null });
  assert.equal(mirror.version, 'presentation-v3');
  assert.equal(mirror.binaryId, BINARY);
  assert.deepEqual(mirror.variants.map((entry) => entry.width), [240, 480, 768]);
  assert.equal(mirror.thumbnail.dataUrl, THUMBNAIL_DATA_URL);
  assert.deepEqual(assetPrivatePresentationFor({ binary: acceptedManifest(BINARY, ORIGINAL_DIGEST), identity, existing: { privatePresentation: mirror } }), mirror);
  assert.equal(assetPrivatePresentationFor({ binary: null, identity: { ...identity, binaryId: 'bin_replaced' }, existing: { privatePresentation: mirror } }), null);
  assert.equal(assetPrivatePresentationFor({ binary: acceptedManifest(BINARY, ORIGINAL_DIGEST, { verificationStatus: 'rejected', presentationDerivative: presentationDerivative() }), identity, existing: null }), null);
  // Un statut historique et une date client ne constituent plus une attestation serveur.
  const legacy = acceptedManifest(BINARY, ORIGINAL_DIGEST, { verificationStatus: undefined, verificationVersion: null, clientUpdatedAt: 10, presentationDerivative: presentationDerivative() });
  assert.equal(assetPrivatePresentationFor({ binary: legacy, identity, existing: null }), null);
  assert.equal(assetPrivatePresentationFor({ binary: { ...legacy, uploadStatus: 'verifying' }, identity, existing: null }), null);
  const foreign = { ...presentationDerivative(), variants: [{ ...variant(240, 160), storagePath: presentationVariantPath('owner_v3_stranger', CARTULARY, BINARY, 240) }] };
  assert.equal(assetPrivatePresentationFor({ binary: acceptedManifest(BINARY, ORIGINAL_DIGEST, { presentationDerivative: foreign }), identity, existing: null }), null);
});

test('création puis synchronisation : miroir sur l’asset, vignette inline sur l’item, hors contentHash, sans mot interdit', async () => {
  const { firestore } = await seed();
  const created = await processCartularyCreateRequest({ firestore, storage: storageByFirestore.get(firestore), requestDocumentId: CARTULARY, occurredAt: '2026-09-14T10:01:00.000Z' });
  assert.equal(created.status, 'processed');

  const assetAfterCreate = await read(firestore, assetPath(ASSET));
  assert.equal(assetAfterCreate.privatePresentation.version, 'presentation-v3');
  assert.equal(assetAfterCreate.privatePresentation.binaryId, BINARY);
  assert.equal(assetAfterCreate.privatePresentation.variants.length, 3);
  assert.equal(assetAfterCreate.sha256, null);
  const itemAfterCreate = projectionOf(await read(firestore, itemPath));
  assert.deepEqual(itemAfterCreate.thumbnail, inlineThumbnail());
  assert.equal(itemAfterCreate.primaryMediaKind, 'image');
  assert.equal(itemAfterCreate.thumbnailStatus, 'ready');
  assert.equal(itemAfterCreate.contentHash, sha256Digest({ ...itemAfterCreate.projection, sourceRevision: itemAfterCreate.projection.sourceRevision - 1 }));
  assert.equal('thumbnail' in itemAfterCreate.projection, false);

  const synchronized = await requestSync(firestore, 'sync_v3_vignettes_00000000000001');
  assert.equal(synchronized.outcome, 'updated');
  const asset = await read(firestore, assetPath(ASSET));
  assert.equal(asset.processingState, 'ready');
  assert.equal(asset.privatePresentation.thumbnail.sha256, digestOf('v240'));
  const item = await read(firestore, itemPath);
  const { projection, thumbnail, primaryMediaKind, thumbnailStatus, contentHash } = projectionOf(item);
  assert.deepEqual(thumbnail, inlineThumbnail());
  assert.equal(primaryMediaKind, 'image');
  assert.equal(thumbnailStatus, 'ready');
  assert.equal(contentHash, sha256Digest(projection), 'thumbnailStatus hors contentHash');
  assert.equal('thumbnailStatus' in projection, false);
  const text = registryItemAuditText(item).toLowerCase();
  assert.equal(text.includes('<dataurl>'), true);
  for (const forbidden of FORBIDDEN_ITEM_WORDS) assert.equal(text.includes(forbidden), false, forbidden);
  assert.equal(JSON.stringify(item).includes(UID), false);
  assert.equal(JSON.stringify(item).includes('private-derivatives'), false);
});

test('une synchronisation sans changement de média conserve la vignette posée par le script ou le backlog', async () => {
  const { firestore, draftPath } = await seed({ withVariants: false });
  await processCartularyCreateRequest({ firestore, storage: storageByFirestore.get(firestore), requestDocumentId: CARTULARY, occurredAt: '2026-09-14T10:01:00.000Z' });
  assert.equal((await read(firestore, assetPath(ASSET))).privatePresentation, null);
  let item = await read(firestore, itemPath);
  assert.equal(item.thumbnail, null);
  assert.equal(item.primaryMediaKind, 'image');
  assert.equal(item.thumbnailStatus, 'pending', 'image sans miroir ni échec : en préparation');

  // Rattrapage Admin (K7) : miroir sur l'asset et vignette sur l'item, sans resynchronisation.
  const mirror = { binaryId: BINARY, version: 'presentation-v3', variants: [variant(240, 160), variant(480, 320)], thumbnail: { dataUrl: THUMBNAIL_DATA_URL, width: 240, height: 160, sha256: digestOf('v240') } };
  await firestore.doc(assetPath(ASSET)).set({ privatePresentation: mirror }, { merge: true });
  await firestore.doc(itemPath).set({ thumbnail: inlineThumbnail() }, { merge: true });

  // Synchronisation ultérieure sur une modification hors média (le digest ignore presentationDerivative, G6).
  await firestore.doc(`${draftPath}/state/cartularia-user-alias`).set(stateDocument('cartularia-user-alias', 'Alias V3', 2));
  const first = await requestSync(firestore, 'sync_v3_vignettes_00000000000010');
  assert.equal(first.outcome, 'updated');
  item = await read(firestore, itemPath);
  assert.equal(item.userAlias, 'Alias V3');
  assert.deepEqual(item.thumbnail, inlineThumbnail());
  assert.equal(item.thumbnailStatus, 'ready', 'vignette conservée → état recalculé « ready », jamais perdu par une réécriture');
  assert.deepEqual((await read(firestore, assetPath(ASSET))).privatePresentation, mirror);

  // Réécriture par la projection (création, script) : l'asset primaire n'a plus de miroir, la vignette de l'item survit.
  await firestore.doc(assetPath(ASSET)).set({ privatePresentation: null }, { merge: true });
  await firestore.doc(itemPath).set({ thumbnail: bundleThumbnail() }, { merge: true });
  const root = await read(firestore, `cartularies/${CARTULARY}`);
  await projectRegistryItem({ firestore, cartularyId: CARTULARY, actorId: UID, requestId: 'project_v3_vignettes_preserve_01', expectedRevision: root.revision, occurredAt: '2026-09-14T10:10:00.000Z' });
  item = await read(firestore, itemPath);
  assert.deepEqual(item.thumbnail, bundleThumbnail());
  assert.equal(item.primaryMediaKind, 'image');
  assert.equal(item.thumbnailStatus, 'ready');
});

test('échec définitif de la copie de présentation : synchronisation et projection posent thumbnailStatus « failed » (jamais « en préparation » perpétuel)', async () => {
  const { firestore, draftPath } = await seed({ withVariants: false });
  await processCartularyCreateRequest({ firestore, storage: storageByFirestore.get(firestore), requestDocumentId: CARTULARY, occurredAt: '2026-09-14T10:01:00.000Z' });
  assert.equal((await read(firestore, itemPath)).thumbnailStatus, 'pending');
  // Le rattrapage (ou le backlog) consigne l'échec sharp dans le manifeste ; la synchronisation suivante le reflète.
  await firestore.doc(`${draftPath}/binaries/${BINARY}`).set({ presentationDerivative: { variantsVersion: null, variants: [], thumbnail: null, variantsFailure: 'invalid_dimensions' } }, { merge: true });
  await firestore.doc(`${draftPath}/state/cartularia-user-alias`).set(stateDocument('cartularia-user-alias', 'Alias échec', 2));
  const synchronized = await requestSync(firestore, 'sync_v3_vignettes_00000000000030');
  assert.equal(synchronized.outcome, 'updated');
  let item = await read(firestore, itemPath);
  assert.equal(item.thumbnail, null);
  assert.equal(item.primaryMediaKind, 'image');
  assert.equal(item.thumbnailStatus, 'failed');
  const { projection, contentHash } = projectionOf(item);
  assert.equal(contentHash, sha256Digest(projection), 'thumbnailStatus hors contentHash');
  // La projection relit le manifeste du binaire primaire dans sa transaction : même état.
  await firestore.doc(itemPath).set({ thumbnailStatus: 'pending' }, { merge: true });
  const root = await read(firestore, `cartularies/${CARTULARY}`);
  await projectRegistryItem({ firestore, cartularyId: CARTULARY, actorId: UID, requestId: 'project_v3_vignettes_failed_01', expectedRevision: root.revision, occurredAt: '2026-09-14T10:12:00.000Z' });
  item = await read(firestore, itemPath);
  assert.equal(item.thumbnailStatus, 'failed');
  assert.equal(item.thumbnail, null);
  // Original rejeté par la vérification : même état honnête après synchronisation.
  await firestore.doc(`${draftPath}/binaries/${BINARY}`).set({ verificationStatus: 'rejected', uploadStatus: 'failed', presentationDerivative: null }, { merge: true });
  await firestore.doc(`${draftPath}/state/cartularia-user-alias`).set(stateDocument('cartularia-user-alias', 'Alias rejet', 3));
  await requestSync(firestore, 'sync_v3_vignettes_00000000000031');
  item = await read(firestore, itemPath);
  assert.equal(item.thumbnailStatus, 'failed');
  assert.equal(item.thumbnail, null);
});

test('une couverture vidéo n’hérite d’aucune vignette et se déclare comme telle', async () => {
  const { firestore, draftPath } = await seed();
  await processCartularyCreateRequest({ firestore, storage: storageByFirestore.get(firestore), requestDocumentId: CARTULARY, occurredAt: '2026-09-14T10:01:00.000Z' });
  await requestSync(firestore, 'sync_v3_vignettes_00000000000020');
  assert.deepEqual((await read(firestore, itemPath)).thumbnail, inlineThumbnail());

  const videoDigest = digestOf('original-video-bytes');
  const video = acceptedManifest(VIDEO_BINARY, videoDigest, { fileName: 'tour.mp4', mimeType: 'video/mp4', derivativeStatus: 'pending' });
  await firestore.doc(`${draftPath}/binaries/${VIDEO_BINARY}`).set(video);
  storageByFirestore.get(firestore).register(video);
  await firestore.doc(`${draftPath}/state/cartularia-media-assets-v3`).set(stateDocument('cartularia-media-assets-v3', [
    { ...media()[0], tags: ['slideshow'] },
    { id: VIDEO_ASSET, name: 'Tour vidéo', type: 'video', mimeType: 'video/mp4', binaryId: VIDEO_BINARY, tags: ['main-video', 'main-photo'], visibility: 'Secret' },
  ], 2));
  const result = await requestSync(firestore, 'sync_v3_vignettes_00000000000021');
  assert.equal(result.outcome, 'updated');
  const item = await read(firestore, itemPath);
  assert.equal(item.primaryAssetId, VIDEO_ASSET);
  assert.equal(item.thumbnail, null);
  assert.equal(item.primaryMediaKind, 'video');
  assert.equal(item.thumbnailStatus, 'none', 'vidéo sans dérivé : « Aucune vignette disponible », jamais « en préparation »');
  const photo = await read(firestore, assetPath(ASSET));
  assert.equal(photo.privatePresentation.binaryId, BINARY);
  assert.equal((await read(firestore, assetPath(VIDEO_ASSET))).privatePresentation, null);
});

test('tour 5 point 2 (K3) : la synchronisation conserve une vignette bundle posée sur l’item quand l’asset primaire n’a aucun miroir (IWC après P4)', async () => {
  // Sans `existingItem` (item en cours réécrit), la vignette bundle serait remise à null et thumbnailStatus à 'pending'.
  const { firestore, draftPath } = await seed({ withVariants: false });
  await processCartularyCreateRequest({ firestore, storage: storageByFirestore.get(firestore), requestDocumentId: CARTULARY, occurredAt: '2026-09-14T10:01:00.000Z' });
  assert.equal((await read(firestore, assetPath(ASSET))).privatePresentation, null);
  await firestore.doc(itemPath).set({ thumbnail: bundleThumbnail(), thumbnailStatus: 'ready' }, { merge: true });
  await firestore.doc(`${draftPath}/state/cartularia-user-alias`).set(stateDocument('cartularia-user-alias', 'Alias bundle', 2));
  const result = await requestSync(firestore, 'sync_v3_vignettes_tour5_00000001');
  assert.equal(result.outcome, 'updated');
  const item = await read(firestore, itemPath);
  assert.deepEqual(item.thumbnail, bundleThumbnail(), 'vignette bundle (P4 IWC) jamais effacée par une synchronisation');
  assert.equal(item.thumbnailStatus, 'ready');
  assert.equal(item.primaryMediaKind, 'image');
});

// ---------------------------------------------------------------------------------------------------------------------
// Tour 5 — couverture relevée par les relecteurs (mutant M1c : binaire accepté d’époque, miroir posé par la synchronisation).
// ---------------------------------------------------------------------------------------------------------------------

test('un ancien binaire ready ne crée ni Cartulaire ni miroir avant réattestation serveur', async () => {
  const { firestore, draftPath } = await seed({ withVariants: false });
  const legacy = acceptedManifest(BINARY, ORIGINAL_DIGEST, { verificationVersion: null, clientUpdatedAt: PRIVATE_UPLOAD_VERIFICATION_CUTOFF_MS - 1 });
  delete legacy.verificationStatus;
  delete legacy.verificationIdentity;
  await firestore.doc(`${draftPath}/binaries/${BINARY}`).set(legacy);
  await assert.rejects(processCartularyCreateRequest({ firestore, storage: storageByFirestore.get(firestore), requestDocumentId: CARTULARY }), { code: 'unverified_binary' });
  assert.equal((await firestore.doc(`cartularies/${CARTULARY}`).get()).exists, false);
  // Une réinspection serveur a validé l'original avant d'écrire l'attestation.
  await firestore.doc(`${draftPath}/binaries/${BINARY}`).set(acceptedManifest(BINARY, ORIGINAL_DIGEST, { presentationDerivative: presentationDerivative() }));
  await firestore.doc(`cartularyCreateRequests/${CARTULARY}`).update({ status: 'pending', requestId: 'create_reverified_attempt0000001' });
  await processCartularyCreateRequest({ firestore, storage: storageByFirestore.get(firestore), requestDocumentId: CARTULARY });
  assert.deepEqual((await read(firestore, itemPath)).thumbnail, inlineThumbnail());
});

for (const scenario of ['stale identity', 'foreign path', 'missing original', 'changed generation']) {
  test(`la création refuse ${scenario} avant toute écriture du Cartulaire`, async () => {
    const { firestore, draftPath, storage } = await seed();
    const ref = firestore.doc(`${draftPath}/binaries/${BINARY}`);
    const manifest = (await ref.get()).data();
    if (scenario === 'stale identity') await ref.update({ sha256: digestOf('changed original') });
    if (scenario === 'foreign path') await ref.update({ storagePath: manifest.storagePath.replace(UID, 'foreign_owner') });
    if (scenario === 'missing original') storage.objects.clear();
    if (scenario === 'changed generation') storage.objects.get(manifest.storagePath).generation = '1002';
    await assert.rejects(processCartularyCreateRequest({ firestore, storage, requestDocumentId: CARTULARY }),
      { code: scenario === 'missing original' ? 'original_missing' : scenario === 'changed generation' ? 'generation_mismatch' : 'unverified_binary' });
    assert.equal((await firestore.doc(`cartularies/${CARTULARY}`).get()).exists, false);
    assert.equal((await firestore.doc(itemPath).get()).exists, false);
  });
}

for (const scenario of ['stale identity', 'foreign path', 'missing original', 'changed generation']) {
  test(`la synchronisation refuse un nouveau binaire avec ${scenario} sans hériter du chemin existant`, async () => {
    const { firestore, draftPath, storage } = await seed();
    await processCartularyCreateRequest({ firestore, storage, requestDocumentId: CARTULARY });
    const before = await read(firestore, assetPath(ASSET));
    const replacement = acceptedManifest(VIDEO_BINARY, digestOf('replacement original'));
    storage.register(replacement);
    if (scenario === 'stale identity') replacement.sha256 = digestOf('changed original');
    if (scenario === 'foreign path') replacement.storagePath = replacement.storagePath.replace(UID, 'foreign_owner');
    if (scenario === 'missing original') storage.objects.delete(replacement.storagePath);
    if (scenario === 'changed generation') storage.objects.get(replacement.storagePath).generation = '1002';
    await firestore.doc(`${draftPath}/binaries/${VIDEO_BINARY}`).set(replacement);
    await firestore.doc(`${draftPath}/state/cartularia-media-assets-v3`).set(stateDocument('cartularia-media-assets-v3', [{ ...media()[0], binaryId: VIDEO_BINARY }], 2));
    await assert.rejects(requestSync(firestore, 'sync_invalid_binary_attempt0001'),
      { code: scenario === 'missing original' ? 'original_missing' : scenario === 'changed generation' ? 'generation_mismatch' : 'unverified_binary' });
    assert.deepEqual(await read(firestore, assetPath(ASSET)), before);
  });
}


test('une édition de nom conserve un original importé sans propriété binaryId', async () => {
  const { firestore, draftPath, storage } = await seed();
  await processCartularyCreateRequest({ firestore, storage, requestDocumentId: CARTULARY });
  const before = await read(firestore, assetPath(ASSET));
  delete before.binaryId;
  before.storagePath = 'imports/existing-original.jpg';
  before.sha256 = digestOf('imported original');
  before.privatePresentation = null;
  await firestore.doc(assetPath(ASSET)).set(before);
  const root = await read(firestore, `cartularies/${CARTULARY}`);
  await firestore.doc(`${draftPath}/state/cartularia-generic-operation`).set(stateDocument('cartularia-generic-operation', { kind: 'media', token: 'rename_imported_00001' }));
  await firestore.doc(`${draftPath}/state/cartularia-generic-media`).set(stateDocument('cartularia-generic-media', {
    version: 1, baseRevision: root.revision, changes: [{ id: ASSET, name: 'Original importé renommé' }], removeIds: [],
  }));
  storage.reads.length = 0;
  await requestSync(firestore, 'sync_rename_imported_0001');
  const after = await read(firestore, assetPath(ASSET));
  assert.equal(after.displayName, 'Original importé renommé');
  assert.equal(after.storagePath, before.storagePath);
  assert.equal(after.sha256, before.sha256);
  assert.equal(after.binaryId, null);
  assert.equal(storage.reads.length, 0);
});
