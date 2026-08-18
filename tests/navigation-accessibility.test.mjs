import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  registryNavigationTarget,
  shouldInterceptRegistryNavigation,
} from '../src/features/registry/registryRouting.ts';
import {
  horizontalNavigationDirection,
  targetConsumesHorizontalNavigation,
} from '../src/utils/horizontalNavigation.ts';

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const plainGesture = {
  defaultPrevented: false,
  button: 0,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  target: null,
  download: false,
};

test('la navigation interne conserve chemin, recherche et fragment du Registre', () => {
  assert.equal(
    registryNavigationTarget('/registry/reg_demo/gallery?view=all#results', 'http://127.0.0.1:5175/registry/reg_demo/items'),
    '/registry/reg_demo/gallery?view=all#results',
  );
  assert.equal(
    registryNavigationTarget('follow-up', 'https://cartularia.web.app/registry/reg_demo/items'),
    '/registry/reg_demo/follow-up',
  );
});

test('les liens externes, hors Registre et ancres locales gardent leur comportement natif', () => {
  const current = 'https://cartularia.web.app/registry/reg_demo/items';
  assert.equal(registryNavigationTarget('https://example.com/registry/reg_demo/items', current), null);
  assert.equal(registryNavigationTarget('/watch-website', current), null);
  assert.equal(registryNavigationTarget('#registry-main-content', current), null);
  assert.equal(registryNavigationTarget('not a valid url', 'not a valid current url'), null);
});

test('seul un clic principal simple est intercepté', () => {
  assert.equal(shouldInterceptRegistryNavigation(plainGesture), true);
  assert.equal(shouldInterceptRegistryNavigation({ ...plainGesture, metaKey: true }), false);
  assert.equal(shouldInterceptRegistryNavigation({ ...plainGesture, ctrlKey: true }), false);
  assert.equal(shouldInterceptRegistryNavigation({ ...plainGesture, button: 1 }), false);
  assert.equal(shouldInterceptRegistryNavigation({ ...plainGesture, target: '_blank' }), false);
  assert.equal(shouldInterceptRegistryNavigation({ ...plainGesture, download: true }), false);
  assert.equal(shouldInterceptRegistryNavigation({ ...plainGesture, defaultPrevented: true }), false);
});

test('les flèches horizontales produisent une direction stable', () => {
  assert.equal(horizontalNavigationDirection('ArrowLeft'), -1);
  assert.equal(horizontalNavigationDirection('ArrowRight'), 1);
  assert.equal(horizontalNavigationDirection('Escape'), null);
});

test('les champs, contenus éditables et lecteurs média conservent leurs flèches natives', () => {
  assert.equal(targetConsumesHorizontalNavigation({ tagName: 'input' }), true);
  assert.equal(targetConsumesHorizontalNavigation({ tagName: 'VIDEO' }), true);
  assert.equal(targetConsumesHorizontalNavigation({ tagName: 'button' }), false);
  assert.equal(targetConsumesHorizontalNavigation({ isContentEditable: true }), true);
  assert.equal(targetConsumesHorizontalNavigation({ getAttribute: (name) => name === 'role' ? 'slider' : null }), true);
});

test('le routage et le clavier sont effectivement raccordés aux composants', () => {
  const registryApp = readFileSync(resolve(rootDirectory, 'src/features/registry/RegistryApp.tsx'), 'utf8');
  const carousel = readFileSync(resolve(rootDirectory, 'src/components/MediaCarousel.tsx'), 'utf8');
  const app = readFileSync(resolve(rootDirectory, 'src/App.tsx'), 'utf8');
  const modals = readFileSync(resolve(rootDirectory, 'src/features/cartulary/modals/CartularyModals.tsx'), 'utf8');

  assert.match(registryApp, /window\.history\.pushState/);
  assert.match(registryApp, /addEventListener\('popstate'/);
  assert.match(registryApp, /registry-main-content/);
  assert.match(carousel, /onKeyDown=\{handleKeyDown\}/);
  assert.match(modals, /media-modal__arrow--previous/);
  assert.match(app, /targetConsumesHorizontalNavigation\(event\.target\)/);
});
