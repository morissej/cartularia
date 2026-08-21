import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectionWebsiteIsPublished,
  collectionWebsiteItemProjection,
  collectionWebsitePath,
  collectionWebsitePublicationId,
  normalizeCollectionSlug,
  registryCollectionId,
} from '../src/domain/collections.ts';

test('le slug du site de Collection est lisible, stable et sans accents', () => {
  assert.equal(normalizeCollectionSlug('  Art & Design — Été 2026  '), 'art-design-ete-2026');
  assert.equal(normalizeCollectionSlug(''), 'collection');
});

test('les identifiants de Collection restent canoniques et non ambigus', () => {
  const first = registryCollectionId('Objets de voyage');
  const second = registryCollectionId('Objets de voyage');
  assert.match(first, /^col_objets_de_voyage_[a-f0-9]{8}$/);
  assert.notEqual(first, second);
});

test('le mini-site possède une adresse stable et exige un consentement explicite', () => {
  assert.equal(collectionWebsitePublicationId('reg_demo', 'col_pilots'), 'reg_demo--col_pilots');
  assert.equal(collectionWebsitePath('reg_demo', 'col_pilots'), '/collection-website?publicationId=reg_demo--col_pilots');
  assert.equal(collectionWebsiteIsPublished({ status: 'published', visibility: 'public', publicationConsent: true }), true);
  assert.equal(collectionWebsiteIsPublished({ status: 'published', visibility: 'public' }), false);
  assert.equal(collectionWebsiteIsPublished({ status: 'draft', visibility: 'secret', publicationConsent: true }), false);
});

test('la projection publique de Collection exclut les champs privés du Registre', () => {
  const projection = collectionWebsiteItemProjection({
    cartularyId: 'cart_rolex',
    organizationId: 'org_demo',
    registryId: 'reg_demo',
    collectionId: 'col_pilots',
    assetType: 'watch',
    displayTitle: 'Rolex GMT-Master',
    makerName: 'Rolex',
    modelName: 'GMT-Master',
    referenceCode: '1675',
    manufactureYear: 1969,
    lifecycleStatus: 'active',
    userAlias: 'Alias privé',
    objectCode: 'ROL-PUBLIC',
    possessionStatus: 'in_possession',
    purchasePrice: 21_900,
    completenessLevel: 'complete',
    primaryAssetId: 'asset-secret',
    sourceRevision: 11,
    projectionStatus: 'active',
    contentHash: 'sha256:secret',
  }, 'col_pilots');
  assert.deepEqual(Object.keys(projection).sort(), [
    'assetType', 'cartularyId', 'collectionId', 'displayTitle', 'makerName',
    'manufactureYear', 'modelName', 'publicCode', 'referenceCode',
  ]);
  assert.equal(projection.publicCode, 'ROL-PUBLIC');
  assert.equal('purchasePrice' in projection, false);
  assert.equal('userAlias' in projection, false);
});
