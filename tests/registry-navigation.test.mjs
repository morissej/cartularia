import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isRegistrySidebarCurrent,
  REGISTRY_SECTIONS,
  REGISTRY_SIDEBAR_SECTIONS,
} from '../src/features/registry/registryRouting.ts';
import { REGISTRY_COMPARISON_MAX } from '../src/features/registry/registryComparison.ts';
import {
  COMPARISON_SELECTION_EVENT,
  readComparisonSelectionCount,
  readComparisonSelectionIds,
} from '../src/features/registry/comparisonSelection.ts';

test('la barre latérale du Registre expose la Comparaison entre la Galerie et le Suivi, sans la création', () => {
  const galleryIndex = REGISTRY_SIDEBAR_SECTIONS.indexOf('gallery');
  const compareIndex = REGISTRY_SIDEBAR_SECTIONS.indexOf('compare');
  const followUpIndex = REGISTRY_SIDEBAR_SECTIONS.indexOf('follow-up');
  assert.ok(compareIndex > -1, 'compare absente de la barre latérale');
  assert.equal(compareIndex, galleryIndex + 1);
  assert.equal(followUpIndex, compareIndex + 1);
  assert.equal(REGISTRY_SIDEBAR_SECTIONS.includes('new'), false);
  assert.equal(new Set(REGISTRY_SIDEBAR_SECTIONS).size, REGISTRY_SIDEBAR_SECTIONS.length);
  for (const section of REGISTRY_SIDEBAR_SECTIONS) {
    assert.ok(REGISTRY_SECTIONS.includes(section), `${section} n'est pas une section routée`);
  }
  assert.equal(REGISTRY_SIDEBAR_SECTIONS.length, REGISTRY_SECTIONS.length - 1);
});

test('l’entrée courante de la barre latérale suit la section active ; la création reste rattachée au Catalogue', () => {
  assert.equal(isRegistrySidebarCurrent('compare', 'compare'), true);
  assert.equal(isRegistrySidebarCurrent('compare', 'items'), false);
  assert.equal(isRegistrySidebarCurrent('new', 'items'), true);
  assert.equal(isRegistrySidebarCurrent('new', 'compare'), false);
  assert.equal(isRegistrySidebarCurrent('items', 'items'), true);
  assert.equal(isRegistrySidebarCurrent('gallery', 'items'), false);
});

test('le compteur de comparaison se lit dans l’URL du Catalogue comme dans celle de la Comparaison', () => {
  assert.equal(readComparisonSelectionCount('?compare=a,b'), 2);
  assert.equal(readComparisonSelectionCount('?items=a,b,c&returnTo=/registry/r/items'), 3);
  assert.equal(readComparisonSelectionCount(''), 0);
  assert.equal(readComparisonSelectionCount('?view=list'), 0);
  assert.equal(readComparisonSelectionCount('?compare=a,b,c,d,e'), REGISTRY_COMPARISON_MAX);
  assert.deepEqual(readComparisonSelectionIds('?compare=a,%20b,a,'), ['a', 'b']);
  assert.equal(COMPARISON_SELECTION_EVENT, 'cartularia:registry-comparison-selection');
});
