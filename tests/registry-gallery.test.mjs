import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterRegistryGallery,
  gallerySlidesForCategory,
} from '../src/features/registry/registryGallery.ts';

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
    { assetId: 'front', cartularyId: 'cart_iwc', displayName: 'Face', url: '/face.jpg', thumbnailUrl: '/face.jpg', category: 'ensemble', capturedAt: null, tags: ['slideshow'], source: 'local_prototype' },
    { assetId: 'back', cartularyId: 'cart_iwc', displayName: 'Fond', url: '/back.jpg', thumbnailUrl: '/back.jpg', category: 'mouvement', capturedAt: null, tags: ['slideshow'], source: 'local_prototype' },
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
