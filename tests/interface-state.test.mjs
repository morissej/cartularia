import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adjacentCartularyPage,
  applicationRouteFromPathname,
  cartularyPageFromHash,
  normalizeAudience,
  normalizeInterfaceLanguage,
} from '../src/utils/interfaceState.ts';

test('les fragments absents ou inconnus reviennent sur une page d’accueil valide', () => {
  assert.equal(cartularyPageFromHash(''), 'cover');
  assert.equal(cartularyPageFromHash('#inconnue'), 'cover');
  assert.equal(cartularyPageFromHash('#value'), 'value');
});

test('la navigation précédente et suivante ne peut jamais produire undefined', () => {
  assert.equal(adjacentCartularyPage('cover', 'previous'), null);
  assert.equal(adjacentCartularyPage('cover', 'next'), 'media');
  assert.equal(adjacentCartularyPage('media', 'previous'), 'cover');
  assert.equal(adjacentCartularyPage('value', 'next'), null);
});

test('les routes inconnues ne sont pas assimilées au Cartulaire privé', () => {
  assert.equal(applicationRouteFromPathname('/'), 'cartulary');
  assert.equal(applicationRouteFromPathname('/watch-website'), 'watch-website');
  assert.equal(applicationRouteFromPathname('/community/'), 'community');
  assert.equal(applicationRouteFromPathname('/registry/example'), 'registry');
  assert.equal(applicationRouteFromPathname('/adresse-inconnue'), 'not-found');
});

test('les préférences persistées invalides utilisent des valeurs sûres', () => {
  assert.equal(normalizeInterfaceLanguage('EN'), 'EN');
  assert.equal(normalizeInterfaceLanguage('DE'), 'FR');
  assert.equal(normalizeAudience('Communauté'), 'Communauté');
  assert.equal(normalizeAudience('Tous'), 'Tous');
  assert.equal(normalizeAudience('Public'), 'Secret');
});
