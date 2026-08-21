import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCartularyHref,
  DEFAULT_REGISTRY_CATALOG_FILTERS,
  filterAndSortRegistryItems,
  isRegistryReturnPath,
} from '../src/features/registry/registryCatalog.ts';

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
  completenessLevel: 'imported_unreviewed',
  primaryAssetId: null,
  sourceRevision: 1,
  projectionStatus: 'active',
  contentHash: 'sha256:test',
  ...overrides,
});

const fixtures = [
  item({
    cartularyId: 'iwc-flieger-utc',
    displayTitle: 'IWC Flieger UTC',
    makerName: 'IWC Schaffhausen',
    modelName: 'Flieger UTC',
    referenceCode: '3251',
    manufactureYear: 1999,
    sourceRevision: 4,
    updatedAt: { seconds: 200, nanoseconds: 0 },
  }),
  item({
    cartularyId: 'car-bentley-gt',
    collectionId: 'col_vehicles',
    assetType: 'car',
    displayTitle: 'Bentley Continental GT',
    makerName: 'Bentley',
    modelName: 'Continental GT',
    referenceCode: 'SCBCE63W',
    manufactureYear: 2018,
    lifecycleStatus: 'review',
    sourceRevision: 2,
    updatedAt: { seconds: 300, nanoseconds: 0 },
  }),
  item({
    cartularyId: 'watch-geneve',
    displayTitle: 'Pièce de Genève',
    makerName: 'Atelier Genève',
    modelName: 'Classique',
    manufactureYear: 1965,
    lifecycleStatus: 'archived',
    sourceRevision: 7,
    updatedAt: { seconds: 100, nanoseconds: 0 },
  }),
];

test('la recherche est multi-termes et insensible aux accents', () => {
  const result = filterAndSortRegistryItems(fixtures, {
    ...DEFAULT_REGISTRY_CATALOG_FILTERS,
    query: 'piece geneve',
  });
  assert.deepEqual(result.map(({ cartularyId }) => cartularyId), ['watch-geneve']);
});

test('les facettes type, collection et statut patrimonial se combinent', () => {
  const result = filterAndSortRegistryItems(fixtures, {
    ...DEFAULT_REGISTRY_CATALOG_FILTERS,
    assetType: 'car',
    collectionId: 'col_vehicles',
    patrimonialStatus: 'Patrimonial',
  });
  assert.deepEqual(result.map(({ cartularyId }) => cartularyId), ['car-bentley-gt']);
});

test('une collection secondaire retrouve aussi le Cartulaire sans casser la collection principale', () => {
  const multiCollectionItem = item({
    cartularyId: 'watch-multi-collection',
    collectionId: 'col_watches',
    collectionIds: ['col_watches', 'col_travel'],
  });
  const result = filterAndSortRegistryItems([multiCollectionItem], {
    ...DEFAULT_REGISTRY_CATALOG_FILTERS,
    collectionId: 'col_travel',
  });
  assert.deepEqual(result.map(({ cartularyId }) => cartularyId), ['watch-multi-collection']);
});

test('les trois tris restent déterministes et ne modifient pas la source', () => {
  const sourceOrder = fixtures.map(({ cartularyId }) => cartularyId);
  const recent = filterAndSortRegistryItems(fixtures, DEFAULT_REGISTRY_CATALOG_FILTERS);
  const alphabetical = filterAndSortRegistryItems(fixtures, {
    ...DEFAULT_REGISTRY_CATALOG_FILTERS,
    sort: 'title-asc',
  });
  const byYear = filterAndSortRegistryItems(fixtures, {
    ...DEFAULT_REGISTRY_CATALOG_FILTERS,
    sort: 'year-desc',
  });

  assert.deepEqual(recent.map(({ cartularyId }) => cartularyId), ['car-bentley-gt', 'iwc-flieger-utc', 'watch-geneve']);
  assert.deepEqual(alphabetical.map(({ cartularyId }) => cartularyId), ['car-bentley-gt', 'iwc-flieger-utc', 'watch-geneve']);
  assert.deepEqual(byYear.map(({ cartularyId }) => cartularyId), ['car-bentley-gt', 'iwc-flieger-utc', 'watch-geneve']);
  assert.deepEqual(fixtures.map(({ cartularyId }) => cartularyId), sourceOrder);
});

test('le lien Cartulaire conserve le contexte et encode les paramètres', () => {
  const href = buildCartularyHref('cartulary/à vérifier', '/registry/reg_demo/items?q=IWC UTC');
  const url = new URL(href, 'https://cartularia.test');
  assert.equal(url.pathname, '/cartulary-view');
  assert.equal(url.searchParams.get('cartularyId'), 'cartulary/à vérifier');
  assert.equal(url.searchParams.get('returnTo'), '/registry/reg_demo/items?q=IWC UTC');
});

test('le Cartulaire IWC du pilote ouvre l’interface complète existante', () => {
  const href = buildCartularyHref('cart_iwc_flieger_utc_2002', '/registry/reg_demo/gallery');
  const url = new URL(href, 'https://cartularia.test');
  assert.equal(url.pathname, '/cartulary');
  assert.equal(url.searchParams.get('returnTo'), '/registry/reg_demo/gallery');
});

test('le Cartulaire Rolex ouvre la même interface complète que l’IWC', () => {
  const href = buildCartularyHref('cart_rolex_gmt_master_mark_i_long_e_1675_642cf3adba60', '/registry/reg_demo/items');
  assert.equal(new URL(href, 'https://cartularia.test').pathname, '/cartulary');
});

test('toute nouvelle montre est dirigée vers le Cartulaire complet', () => {
  const href = buildCartularyHref('cart_watch_future_0001', '/registry/reg_demo/items', 'watch');
  assert.equal(new URL(href, 'https://cartularia.test').pathname, '/cartulary');
});

test('le retour n’accepte qu’un chemin interne du Registre', () => {
  assert.equal(isRegistryReturnPath('/registry/reg_demo/items?q=iwc'), true);
  assert.equal(isRegistryReturnPath('//example.com/registry/reg_demo'), false);
  assert.equal(isRegistryReturnPath('/community'), false);
  assert.equal(isRegistryReturnPath('/registry\\example.com'), false);
  assert.equal(isRegistryReturnPath(null), false);
});
