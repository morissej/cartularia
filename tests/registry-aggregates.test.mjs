import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRegistryAggregates } from '../src/features/registry/registryAggregates.ts';

const item = (overrides) => ({
  cartularyId: 'cartulary-default',
  organizationId: 'org_demo',
  registryId: 'reg_collection_privee',
  collectionId: 'col_watches',
  assetType: 'watch',
  displayTitle: 'Montre exemple',
  makerName: 'Maison exemple',
  modelName: 'Modèle exemple',
  referenceCode: null,
  manufactureYear: null,
  lifecycleStatus: 'active',
  possessionStatus: 'in_possession',
  completenessLevel: 'complete',
  primaryAssetId: null,
  sourceRevision: 1,
  projectionStatus: 'active',
  contentHash: 'sha256:test',
  ...overrides,
});

const fixtures = [
  item({ cartularyId: 'watch-active', displayTitle: 'IWC UTC', sourceRevision: 3, updatedAt: { seconds: 200, nanoseconds: 0 } }),
  item({
    cartularyId: 'car-review',
    collectionId: 'col_vehicles',
    assetType: 'car',
    displayTitle: 'Bentley GT',
    lifecycleStatus: 'review',
    completenessLevel: 'imported_unreviewed',
    sourceRevision: 2,
    updatedAt: { seconds: 300, nanoseconds: 0 },
  }),
  item({
    cartularyId: 'watch-suspended',
    displayTitle: 'Montre suspendue',
    lifecycleStatus: 'suspended',
    possessionStatus: 'stolen',
    completenessLevel: 'partial',
    sourceRevision: 4,
    updatedAt: { seconds: 150, nanoseconds: 0 },
  }),
  item({
    cartularyId: 'wine-import',
    assetType: 'wine',
    displayTitle: 'Caisse millésimée',
    completenessLevel: 'imported_unreviewed',
    sourceRevision: 5,
    updatedAt: { seconds: 100, nanoseconds: 0 },
  }),
  item({ cartularyId: 'inactive-projection', projectionStatus: 'inactive' }),
];

test('les agrégats ignorent toute projection non active et comptent le noyau multi-actifs', () => {
  const summary = buildRegistryAggregates(fixtures);
  assert.equal(summary.total, 4);
  assert.equal(summary.collectionCount, 2);
  assert.equal(summary.assetTypeCount, 3);
  assert.deepEqual(summary.byAssetType, [
    { key: 'watch', count: 2 },
    { key: 'car', count: 1 },
    { key: 'wine', count: 1 },
  ]);
});

test('un même Cartulaire à revoir n’est compté qu’une fois dans le KPI', () => {
  const summary = buildRegistryAggregates(fixtures);
  assert.equal(summary.needsReviewCount, 2);
  assert.equal(summary.attention.review, 2);
  assert.equal(summary.attention.suspended, 1);
  assert.equal(summary.attention.sensitivePossession, 1);
});

test('les mises à jour récentes sont ordonnées sans modifier la source', () => {
  const sourceOrder = fixtures.map(({ cartularyId }) => cartularyId);
  const summary = buildRegistryAggregates(fixtures);
  assert.deepEqual(summary.recentItems.map(({ cartularyId }) => cartularyId), [
    'car-review',
    'watch-active',
    'watch-suspended',
    'wine-import',
  ]);
  assert.deepEqual(fixtures.map(({ cartularyId }) => cartularyId), sourceOrder);
});

test('un Registre vide retourne des séries et indicateurs vides', () => {
  const summary = buildRegistryAggregates([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.collectionCount, 0);
  assert.equal(summary.needsReviewCount, 0);
  assert.deepEqual(summary.byAssetType, []);
  assert.deepEqual(summary.recentItems, []);
});
