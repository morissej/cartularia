import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_REGISTRY_GALLERY_FILTERS,
  filterRegistryGallery,
} from '../src/features/registry/registryGallery.ts';
import {
  buildRegistryGalleryEntry,
  ownerUidFromPrivateDerivativePath,
  ownerUidFromPrivateDraftStoragePath,
  resolveGallerySlideAccess,
} from '../src/domain/gallery.ts';
import {
  normalizeRegistryThumbnail,
  registryThumbnailSrc,
  registryThumbnailState,
  REGISTRY_THUMBNAIL_STATE_LABELS,
} from '../src/domain/registryThumbnail.ts';

const DIGEST = `sha256:${'c'.repeat(64)}`;
const INLINE = { kind: 'inline', dataUrl: `data:image/webp;base64,${Buffer.from('webp-240').toString('base64')}`, width: 240, height: 160, assetId: 'front', sha256: DIGEST };
const BUNDLE = { kind: 'bundle', path: '/assets/demo-watches/derivatives/rolex-submariner/main.240.webp', width: 240, height: 240, assetId: 'front', sha256: DIGEST };

const item = (overrides = {}) => ({
  cartularyId: 'cart_gallery_v3',
  organizationId: 'org_gallery_v3',
  registryId: 'reg_gallery_v3',
  collectionId: 'col_pilots',
  assetType: 'watch',
  displayTitle: 'Maison Modèle',
  makerName: 'Maison',
  modelName: 'Modèle',
  referenceCode: 'REF-3251',
  manufactureYear: 2002,
  lifecycleStatus: 'review',
  possessionStatus: 'in_possession',
  completenessLevel: 'imported_unreviewed',
  primaryAssetId: 'front',
  sourceRevision: 2,
  projectionStatus: 'active',
  contentHash: 'sha256:test',
  thumbnail: INLINE,
  primaryMediaKind: 'image',
  ...overrides,
});

test('la carte de la Galerie se construit depuis item.thumbnail seulement, sans diapositive', () => {
  const entry = buildRegistryGalleryEntry(item());
  assert.equal(entry.thumbnailState, 'ready');
  assert.equal(entry.thumbnailSrc, INLINE.dataUrl);
  assert.deepEqual(entry.thumbnail, INLINE);
  assert.equal('slides' in entry, false);
  const bundle = buildRegistryGalleryEntry(item({ thumbnail: BUNDLE }));
  assert.equal(bundle.thumbnailSrc, BUNDLE.path);
  assert.equal(bundle.thumbnailState, 'ready');
});

test('sans vignette, l’état est honnête : préparation pour une image connue, indisponible sinon', () => {
  assert.equal(registryThumbnailState(item({ thumbnail: null })), 'pending');
  assert.equal(registryThumbnailState(item({ thumbnail: undefined, primaryMediaKind: 'video' })), 'unavailable');
  assert.equal(registryThumbnailState(item({ thumbnail: null, primaryMediaKind: undefined })), 'unavailable');
  assert.equal(registryThumbnailState(item({ thumbnail: null, primaryAssetId: null })), 'none');
  assert.equal(registryThumbnailState(item({ thumbnail: { ...INLINE, dataUrl: 'javascript:alert(1)' } })), 'pending');
  assert.equal(REGISTRY_THUMBNAIL_STATE_LABELS.pending, 'Vignette en préparation');
  assert.equal(REGISTRY_THUMBNAIL_STATE_LABELS.unavailable, 'Aucune vignette disponible');
  assert.equal(REGISTRY_THUMBNAIL_STATE_LABELS.failed, 'Copie de présentation non produite');
});

test('thumbnailStatus serveur (K3 étendu, tour 4 point 2) : prime sur la nature de la couverture, jamais « en préparation » perpétuel', () => {
  assert.equal(registryThumbnailState(item({ thumbnail: null, thumbnailStatus: 'pending' })), 'pending');
  assert.equal(registryThumbnailState(item({ thumbnail: null, thumbnailStatus: 'failed' })), 'failed');
  assert.equal(registryThumbnailState(item({ thumbnail: null, primaryMediaKind: 'video', thumbnailStatus: 'failed' })), 'failed');
  assert.equal(registryThumbnailState(item({ thumbnail: null, thumbnailStatus: 'none' })), 'unavailable', 'image sans dérivé possible : aucune promesse');
  assert.equal(registryThumbnailState(item({ thumbnail: null, primaryMediaKind: 'video', thumbnailStatus: 'none' })), 'unavailable');
  assert.equal(registryThumbnailState(item({ thumbnail: null, thumbnailStatus: 'ready' })), 'unavailable', 'statut « ready » sans vignette lisible : jamais « en préparation »');
  assert.equal(registryThumbnailState(item({ thumbnail: INLINE, thumbnailStatus: 'failed' })), 'ready', 'une vignette valide prime toujours');
  assert.equal(registryThumbnailState(item({ thumbnail: null, primaryAssetId: null, thumbnailStatus: 'pending' })), 'none');
  assert.equal(registryThumbnailState(item({ thumbnail: null, thumbnailStatus: 'unknown-status' })), 'pending', 'statut inconnu : repli sur la nature de la couverture');
  assert.equal(buildRegistryGalleryEntry(item({ thumbnail: null, thumbnailStatus: 'failed' })).thumbnailState, 'failed');
});

test('la validation client refuse toute vignette hors contrat', () => {
  assert.deepEqual(normalizeRegistryThumbnail({ ...INLINE, extra: 'x' }), INLINE);
  assert.equal(registryThumbnailSrc({ ...INLINE, dataUrl: `data:image/png;base64,${'A'.repeat(8)}` }), null);
  assert.equal(registryThumbnailSrc({ ...INLINE, dataUrl: `data:image/webp;base64,${'A'.repeat(24_001 - 'data:image/webp;base64,'.length + 1)}` }), null);
  assert.equal(registryThumbnailSrc({ ...INLINE, width: 241 }), null);
  assert.equal(registryThumbnailSrc({ ...BUNDLE, path: '//evil.example/x.240.webp' }), null);
  assert.equal(registryThumbnailSrc({ ...BUNDLE, path: '/assets/../secret.240.webp' }), null);
  assert.equal(registryThumbnailSrc({ ...BUNDLE, path: '/assets/x.240.jpg' }), null);
  assert.equal(registryThumbnailSrc({ ...BUNDLE, path: 'https://evil.example/assets/x.240.webp' }), null);
  assert.equal(registryThumbnailSrc({ ...BUNDLE, kind: 'storage', path: 'private-derivatives/owner/x.webp' }), null);
  assert.equal(registryThumbnailSrc({ ...INLINE, sha256: 'md5:abc' }), null);
  assert.equal(registryThumbnailSrc(null), null);
});

test('les filtres de la Galerie ne portent que sur l’item et ne modifient pas les entrées', () => {
  const entry = buildRegistryGalleryEntry(item());
  const original = structuredClone(entry);
  assert.deepEqual(Object.keys(DEFAULT_REGISTRY_GALLERY_FILTERS).sort(), ['assetType', 'collectionId', 'makerName', 'query']);
  assert.equal(filterRegistryGallery([entry], { query: 'maison 3251', assetType: 'watch', collectionId: 'col_pilots', makerName: 'Maison' }).length, 1);
  assert.equal(filterRegistryGallery([entry], { ...DEFAULT_REGISTRY_GALLERY_FILTERS, makerName: 'Autre' }).length, 0);
  assert.equal(filterRegistryGallery([buildRegistryGalleryEntry(item({ thumbnail: null, primaryAssetId: null }))], DEFAULT_REGISTRY_GALLERY_FILTERS).length, 1);
  assert.deepEqual(entry, original);
});

test('l’accès à une diapositive est décidé sans requête : bundle, propriétaire, membre restreint, inconnu', () => {
  assert.equal(resolveGallerySlideAccess({ url: '/assets/IWC/derivatives/x.1200.webp', binaryId: null, ownerUid: null, viewerUid: 'member' }), 'bundle');
  assert.equal(resolveGallerySlideAccess({ url: null, binaryId: 'bin', ownerUid: 'owner-v3', viewerUid: 'owner-v3' }), 'owner');
  assert.equal(resolveGallerySlideAccess({ url: null, binaryId: 'bin', ownerUid: 'owner-v3', viewerUid: 'member' }), 'restricted');
  assert.equal(resolveGallerySlideAccess({ url: null, binaryId: 'bin', ownerUid: 'owner-v3', viewerUid: null }), 'restricted');
  assert.equal(resolveGallerySlideAccess({ url: null, binaryId: null, ownerUid: 'owner-v3', viewerUid: 'owner-v3' }), 'unavailable');
  assert.equal(resolveGallerySlideAccess({ url: null, binaryId: 'bin', ownerUid: null, viewerUid: 'owner-v3' }), 'unavailable');
});

test('le propriétaire d’une copie privée est dérivé du chemin sans requête Storage', () => {
  assert.equal(ownerUidFromPrivateDraftStoragePath(
    `private-drafts/owner-123/cart_iwc/binary-123/${'a'.repeat(64)}/original`,
  ), 'owner-123');
  assert.equal(ownerUidFromPrivateDraftStoragePath('public/code/asset/web-v1'), null);
  assert.equal(ownerUidFromPrivateDraftStoragePath('private-drafts/owner/cart/bin/hash/original'), null);
  assert.equal(ownerUidFromPrivateDerivativePath('private-derivatives/owner-123/cart_v3/bin_v3/presentation-v3-480.webp'), 'owner-123');
  assert.equal(ownerUidFromPrivateDerivativePath('private-derivatives/owner-123/cart_v3/bin_v3/presentation-v2.webp'), null);
  assert.equal(ownerUidFromPrivateDerivativePath('private-drafts/owner-123/cart_v3/bin_v3/presentation-v3-480.webp'), null);
});
