import assert from 'node:assert/strict';
import test from 'node:test';
import { cartularyNeedsReview } from '../scripts/lib/cartulary-review-policy.mjs';
import { DEMO_CARTULARIES } from '../src/data/demoCartularies.ts';
import { buildDemoRegistryItem } from '../src/data/demoCartularyDocuments.ts';
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

test('le compteur À revoir applique le prédicat partagé avec le catalogue (P-C5)', () => {
  const expected = fixtures
    .filter((candidate) => candidate.projectionStatus === 'active')
    .filter(cartularyNeedsReview);
  const summary = buildRegistryAggregates(fixtures);
  assert.deepEqual(expected.map(({ cartularyId }) => cartularyId), ['car-review', 'wine-import']);
  assert.equal(summary.needsReviewCount, expected.length);
  // Un objet reçu par cession est `active` mais reste `imported_unreviewed` : compté, comme il sera listé.
  const transferred = item({ cartularyId: 'watch-transferred', lifecycleStatus: 'active', completenessLevel: 'imported_unreviewed' });
  assert.equal(buildRegistryAggregates([...fixtures, transferred]).needsReviewCount, expected.length + 1);
  // Une projection inactive à revoir n'entre jamais dans le compteur.
  const inactive = item({ cartularyId: 'watch-inactive-review', lifecycleStatus: 'review', projectionStatus: 'inactive' });
  assert.equal(buildRegistryAggregates([...fixtures, inactive]).needsReviewCount, expected.length);
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

test('le Registre démo enrichi n’affiche plus « À revoir 5 » : cinq projections « Complet », aucun signal de revue', () => {
  const summary = buildRegistryAggregates(DEMO_CARTULARIES.map((cartulary) => buildDemoRegistryItem(cartulary, 'sha256:test')));
  assert.equal(summary.total, 5);
  assert.equal(summary.needsReviewCount, 0);
  assert.equal(summary.attention.review, 0);
  assert.equal(summary.attention.total, 0);
  assert.deepEqual(summary.byCompleteness, [{ key: 'complete', count: 5 }]);
  assert.deepEqual(summary.byLifecycle, [{ key: 'active', count: 5 }]);
});
