import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_INTERFACE_LANGUAGE,
  adjacentCartularyPage,
  applicationRouteFromPathname,
  cartularyPageFromHash,
  normalizeInterfaceLanguage,
  pageScrollBehavior,
} from '../src/utils/interfaceState.ts';
import {
  cartularyIdFromLocation,
  IWC_CARTULARY_ID,
  ROLEX_CARTULARY_ID,
} from '../src/domain/cartularyIds.ts';
import { DEMO_SUBMARINER_CARTULARY_ID } from '../src/data/demoCartularies.ts';

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
  assert.equal(applicationRouteFromPathname('/administration'), 'administration');
  assert.equal(applicationRouteFromPathname('/cartulary'), 'cartulary');
  assert.equal(applicationRouteFromPathname('/cartulary-demo'), 'cartulary-demo');
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
  assert.equal(
    cartularyIdFromLocation({ pathname: '/cartulary-demo', search: '?cartularyId=cart_demo_rolex_submariner_124060' }),
    'cart_demo_rolex_submariner_124060',
  );
});

test('la route de démonstration ne retombe jamais sur un Cartulaire privé', () => {
  assert.equal(DEMO_SUBMARINER_CARTULARY_ID, 'cart_demo_rolex_submariner_124060');
  // Adresse tapée à la main ou lien tronqué : la Submariner, pas l’IWC (qui exigerait une session).
  assert.equal(cartularyIdFromLocation({ pathname: '/cartulary-demo', search: '' }), DEMO_SUBMARINER_CARTULARY_ID);
  assert.equal(cartularyIdFromLocation({ pathname: '/cartulary-demo/', search: '?returnTo=%2Fregistry' }), DEMO_SUBMARINER_CARTULARY_ID);
  assert.equal(cartularyIdFromLocation({ pathname: '/cartulary-demo', search: '?cartularyId=../../secret' }), DEMO_SUBMARINER_CARTULARY_ID);
  assert.equal(cartularyIdFromLocation({ pathname: '/cartulary-demo', search: `?cartularyId=${ROLEX_CARTULARY_ID}` }), DEMO_SUBMARINER_CARTULARY_ID);
  assert.equal(cartularyIdFromLocation({ pathname: '/cartulary-demo', search: '?cartularyId=cart_demo_ap_royal_oak_15510st' }), 'cart_demo_ap_royal_oak_15510st');
  // Le repli propriétaire reste inchangé hors de la route de démonstration.
  assert.equal(cartularyIdFromLocation({ pathname: '/cartulary', search: '' }), IWC_CARTULARY_ID);
  assert.equal(cartularyIdFromLocation({ pathname: '/cartulary-view', search: '' }), IWC_CARTULARY_ID);
});

test('les préférences persistées invalides utilisent des valeurs sûres', () => {
  assert.equal(normalizeInterfaceLanguage('EN'), 'EN');
  assert.equal(normalizeInterfaceLanguage('DE'), 'FR');
  // V6 (V-D9, G2) : bascule masquée, la langue de l'interface du Cartulaire est FR ; une clé résiduelle « EN » n'est plus relue.
  assert.equal(DEFAULT_INTERFACE_LANGUAGE, 'FR');
});

test('V6 relecture (F7) : le retour en haut de page est immédiat sous prefers-reduced-motion, lisse sinon, et tolère un environnement sans matchMedia', () => {
  const queries = [];
  assert.equal(pageScrollBehavior({ matchMedia: (query) => { queries.push(query); return { matches: true }; } }), 'instant');
  assert.equal(pageScrollBehavior({ matchMedia: () => ({ matches: false }) }), 'smooth');
  assert.equal(pageScrollBehavior({}), 'smooth', 'jsdom (tests/ui) n’implémente pas matchMedia');
  assert.deepEqual(queries, ['(prefers-reduced-motion: reduce)']);
});
