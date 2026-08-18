import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterRegistryGallery,
  gallerySlidesForCategory,
} from '../src/features/registry/registryGallery.ts';
import { ownerUidFromPrivateDraftStoragePath } from '../src/domain/gallery.ts';

const entry = {
  item: {
    cartularyId: 'cart_iwc',
    organizationId: 'org_demo',
    registryId: 'reg_demo',
    collectionId: 'col_pilots',
    assetType: 'watch',
    displayTitle: 'IWC Flieger UTC',
    makerName: 'IWC Schaffhausen',
    modelName: 'Flieger UTC',
    referenceCode: 'IW3251-001',
    manufactureYear: 2002,
    lifecycleStatus: 'review',
    possessionStatus: 'in_possession',
    completenessLevel: 'imported_unreviewed',
    primaryAssetId: 'front',
    sourceRevision: 2,
    projectionStatus: 'active',
    contentHash: 'sha256:test',
  },
  primaryAssetId: 'front',
  slides: [
    { assetId: 'front', cartularyId: 'cart_iwc', displayName: 'Face', url: '/face.jpg', thumbnailUrl: '/face.jpg', category: 'ensemble', capturedAt: null, tags: ['slideshow'], source: 'prototype_bundle' },
    { assetId: 'back', cartularyId: 'cart_iwc', displayName: 'Fond', url: '/back.jpg', thumbnailUrl: '/back.jpg', category: 'mouvement', capturedAt: null, tags: ['slideshow'], source: 'prototype_bundle' },
  ],
};

test('la Galerie filtre le Cartulaire sans modifier ses références média', () => {
  const original = structuredClone(entry);
  const matches = filterRegistryGallery([entry], {
    query: 'iwc 3251',
    assetType: 'watch',
    collectionId: 'col_pilots',
    makerName: 'IWC Schaffhausen',
    category: 'mouvement',
  });
  assert.equal(matches.length, 1);
  assert.deepEqual(entry, original);
});

test('le filtre de vue personnalise les photos du diaporama', () => {
  assert.deepEqual(gallerySlidesForCategory(entry, 'mouvement').map((slide) => slide.assetId), ['back']);
  assert.equal(gallerySlidesForCategory(entry, 'all').length, 2);
  assert.equal(filterRegistryGallery([entry], { query: '', assetType: 'all', collectionId: 'all', makerName: 'all', category: 'cadran' }).length, 0);
});

test('un Cartulaire sans aperçu reste visible dans la Galerie générale', () => {
  const entryWithoutPreview = { ...entry, slides: [] };
  assert.equal(filterRegistryGallery([entryWithoutPreview], {
    query: '', assetType: 'all', collectionId: 'all', makerName: 'all', category: 'all',
  }).length, 1);
  assert.equal(filterRegistryGallery([entryWithoutPreview], {
    query: '', assetType: 'all', collectionId: 'all', makerName: 'all', category: 'ensemble',
  }).length, 0);
});

test('une diapositive privée non encore chargée reste filtrable et comptée', () => {
  const pendingEntry = {
    ...entry,
    slides: [
      ...entry.slides,
      {
        assetId: 'side', cartularyId: 'cart_iwc', displayName: 'Profil',
        url: '', thumbnailUrl: '', storagePath: 'private-drafts/owner/cart_iwc/bin/hash/original',
        category: 'boite', capturedAt: null, tags: ['slideshow'], source: 'firebase_storage',
      },
    ],
  };
  assert.equal(gallerySlidesForCategory(pendingEntry, 'all').length, 3);
  assert.deepEqual(gallerySlidesForCategory(pendingEntry, 'boite').map((slide) => slide.assetId), ['side']);
});

test('le propriétaire d’un original privé est dérivé du chemin sans requête Storage', () => {
  assert.equal(ownerUidFromPrivateDraftStoragePath(
    `private-drafts/owner-123/cart_iwc/binary-123/${'a'.repeat(64)}/original`,
  ), 'owner-123');
  assert.equal(ownerUidFromPrivateDraftStoragePath('public/code/asset/web-v1'), null);
  assert.equal(ownerUidFromPrivateDraftStoragePath('private-drafts/owner/cart/bin/hash/original'), null);
});
