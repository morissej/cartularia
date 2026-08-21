import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRegistryComparisonHref,
  buildRegistryComparisonRows,
  REGISTRY_COMPARISON_FIELD_IDS,
  sanitizeComparisonIds,
  selectRegistryComparisonItems,
  toggleRegistryComparisonId,
} from '../src/features/registry/registryComparison.ts';

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
  patrimonialStatus: 'Patrimonial',
  possessionStatus: 'in_possession',
  completenessLevel: 'documented',
  primaryAssetId: 'asset-secret',
  sourceRevision: 1,
  projectionStatus: 'active',
  contentHash: 'sha256:secret',
  updatedAt: { seconds: 1_787_318_400, nanoseconds: 0 },
  ...overrides,
});

const fixtures = [
  item({ cartularyId: 'watch-iwc', displayTitle: 'IWC Flieger UTC', makerName: 'IWC', referenceCode: '3251', manufactureYear: 1999 }),
  item({ cartularyId: 'car-bentley', collectionId: 'col_cars', assetType: 'car', displayTitle: 'Bentley Continental GT', makerName: 'Bentley', modelName: 'Continental GT', manufactureYear: 2018, lifecycleStatus: 'review', sourceRevision: 3 }),
  item({ cartularyId: 'watch-archived', displayTitle: 'Projection retirée', projectionStatus: 'withdrawn' }),
];

test('la sélection URL est dédupliquée, nettoyée et limitée à quatre Cartulaires', () => {
  assert.deepEqual(sanitizeComparisonIds(' watch-iwc,car-bentley,watch-iwc,third,fourth,fifth '), [
    'watch-iwc',
    'car-bentley',
    'third',
    'fourth',
  ]);
});

test('le sélecteur ajoute, retire et refuse un cinquième Cartulaire', () => {
  assert.deepEqual(toggleRegistryComparisonId(['a', 'b'], 'c'), ['a', 'b', 'c']);
  assert.deepEqual(toggleRegistryComparisonId(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(toggleRegistryComparisonId(['a', 'b', 'c', 'd'], 'e'), ['a', 'b', 'c', 'd']);
});

test('seules les projections actives et accessibles sont retenues dans l’ordre demandé', () => {
  const result = selectRegistryComparisonItems(fixtures, ['car-bentley', 'unknown', 'watch-archived', 'watch-iwc']);
  assert.deepEqual(result.map(({ cartularyId }) => cartularyId), ['car-bentley', 'watch-iwc']);
});

test('la matrice signale les différences sans modifier les projections sources', () => {
  const source = fixtures.slice(0, 2);
  const before = structuredClone(source);
  const rows = buildRegistryComparisonRows(source);
  assert.equal(rows.find(({ id }) => id === 'assetType').allEqual, false);
  assert.equal(rows.find(({ id }) => id === 'completenessLevel').allEqual, true);
  assert.equal(rows.find(({ id }) => id === 'purchasePrice').values[0], 'Non renseignée');
  assert.deepEqual(source, before);
});

test('la liste blanche exclut identifiants internes, médias, empreintes et données non projetées', () => {
  for (const forbidden of ['primaryAssetId', 'contentHash', 'organizationId', 'registryId', 'cartularyId', 'value', 'media', 'proofs', 'archives']) {
    assert.equal(REGISTRY_COMPARISON_FIELD_IDS.includes(forbidden), false, forbidden);
  }
  assert.deepEqual(REGISTRY_COMPARISON_FIELD_IDS, [
    'assetType',
    'collectionId',
    'makerName',
    'modelName',
    'referenceCode',
    'manufactureYear',
    'possessionStatus',
    'patrimonialStatus',
    'lifecycleStatus',
    'purchasePrice',
    'costBasis',
    'grossValuation',
    'netValuation',
    'netAfterTaxValuation',
    'completenessLevel',
    'sourceRevision',
    'updatedAt',
  ]);
});

test('le lien de comparaison encode la sélection et refuse un retour externe', () => {
  const href = buildRegistryComparisonHref('reg/privé', ['watch-iwc', 'car-bentley'], '/registry/reg_demo/items?q=IWC');
  const url = new URL(href, 'https://cartularia.test');
  assert.equal(url.pathname, '/registry/reg%2Fpriv%C3%A9/compare');
  assert.equal(url.searchParams.get('items'), 'watch-iwc,car-bentley');
  assert.equal(url.searchParams.get('returnTo'), '/registry/reg_demo/items?q=IWC');
  assert.equal(buildRegistryComparisonHref('reg_demo', ['a', 'b'], '//example.test').includes('returnTo'), false);
});
