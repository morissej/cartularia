import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adjacentCartularyPage,
  applicationRouteFromPathname,
  cartularyPageFromHash,
  normalizeInterfaceLanguage,
} from '../src/utils/interfaceState.ts';
import {
  cartularyIdFromLocation,
  IWC_CARTULARY_ID,
  ROLEX_CARTULARY_ID,
} from '../src/domain/cartularyIds.ts';

test('les fragments absents ou inconnus reviennent sur une page d’accueil valide', () => {
  assert.equal(cartularyPageFromHash(''), 'cover');
  assert.equal(cartularyPageFromHash('#inconnue'), 'cover');
  assert.equal(cartularyPageFromHash('#value'), 'value');
  assert.equal(cartularyPageFromHash('#publication'), 'publication');
});

test('la navigation précédente et suivante ne peut jamais produire undefined', () => {
  assert.equal(adjacentCartularyPage('cover', 'previous'), null);
  assert.equal(adjacentCartularyPage('cover', 'next'), 'media');
  assert.equal(adjacentCartularyPage('media', 'previous'), 'cover');
  assert.equal(adjacentCartularyPage('value', 'next'), 'publication');
  assert.equal(adjacentCartularyPage('publication', 'next'), null);
});

test('les routes inconnues ne sont pas assimilées au Cartulaire privé', () => {
  assert.equal(applicationRouteFromPathname('/'), 'home');
  assert.equal(applicationRouteFromPathname('/account/create'), 'account-create');
  assert.equal(applicationRouteFromPathname('/account/sign-in'), 'account-sign-in');
  assert.equal(applicationRouteFromPathname('/cartulary'), 'cartulary');
  assert.equal(applicationRouteFromPathname('/watch-website'), 'watch-website');
  assert.equal(applicationRouteFromPathname('/collection-website'), 'collection-website');
  assert.equal(applicationRouteFromPathname('/community/'), 'community');
  assert.equal(applicationRouteFromPathname('/registry/example'), 'registry');
  assert.equal(applicationRouteFromPathname('/invitation/accept'), 'invitation');
  assert.equal(applicationRouteFromPathname('/personal-vault'), 'personal-vault');
  assert.equal(applicationRouteFromPathname('/personal-vault.html'), 'personal-vault');
  assert.equal(applicationRouteFromPathname('/adresse-inconnue'), 'not-found');
});

test('la route Cartulaire conserve l’identifiant demandé sans contaminer les autres surfaces', () => {
  const rolexSearch = `?cartularyId=${ROLEX_CARTULARY_ID}`;
  assert.equal(cartularyIdFromLocation({ pathname: '/cartulary', search: rolexSearch }), ROLEX_CARTULARY_ID);
  assert.equal(cartularyIdFromLocation({ pathname: '/cartulary/', search: rolexSearch }), ROLEX_CARTULARY_ID);
  assert.equal(cartularyIdFromLocation({ pathname: '/', search: rolexSearch }), IWC_CARTULARY_ID);
  assert.equal(cartularyIdFromLocation({ pathname: '/registry/reg_collection_privee/items', search: rolexSearch }), IWC_CARTULARY_ID);
  assert.equal(cartularyIdFromLocation({ pathname: '/cartulary', search: '?cartularyId=../../secret' }), IWC_CARTULARY_ID);
});

test('les préférences persistées invalides utilisent des valeurs sûres', () => {
  assert.equal(normalizeInterfaceLanguage('EN'), 'EN');
  assert.equal(normalizeInterfaceLanguage('DE'), 'FR');
});
