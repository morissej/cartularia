import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [app, modals, registry, carousel, privateImage, privateMedia] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/cartulary/modals/CartularyModals.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/registry/RegistryApp.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/MediaCarousel.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/PrivateMediaImage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/privateMedia.ts', import.meta.url), 'utf8'),
]);

test('les surfaces lourdes restent des frontières dynamiques ciblées', () => {
  assert.match(app, /lazy\(\(\) => import\('\.\/components\/AuditPanel\.tsx'\)/);
  assert.match(app, /lazy\(\(\) => import\('\.\/components\/Spin360\.tsx'\)/);
  assert.match(modals, /lazy\(\(\) => import\('\.\.\/\.\.\/\.\.\/components\/Spin360\.tsx'\)/);
  for (const component of ['RegistryItems', 'RegistryComparison', 'RegistryAdministration', 'RegistryAccessCenter', 'RegistryFollowUp', 'RegistryGallery', 'RegistryIntegrity', 'NewCartularyPage']) {
    assert.match(registry, new RegExp(`lazy\\(\\(\\) => import\\('\\.\\/${component}\\.tsx'\\)`));
  }
});

test('le carrousel ne recrée plus les actifs uniquement pour changer leur source', () => {
  assert.doesNotMatch(carousel, /asset=\{\{\s*\.\.\./);
  assert.match(carousel, /sourceOverride=\{poster\}/);
  assert.match(carousel, /sourceOverride=\{thumbnail\}/);
  assert.match(privateImage, /acquirePrivateMediaObjectUrl/);
});

test('le cache média est borné et les URL de Galerie sont libérables', () => {
  assert.match(privateMedia, /MAXIMUM_IDLE_OBJECT_URLS = 24/);
  assert.match(privateMedia, /releasePrivateMediaObjectUrl/);
  assert.match(privateMedia, /objectUrlCache\.clear\(\)/);
});
