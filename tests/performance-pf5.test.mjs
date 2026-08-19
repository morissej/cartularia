import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [app, persistence, privateImage] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/persistence/useHybridPersistence.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/PrivateMediaImage.tsx', import.meta.url), 'utf8'),
]);

test('le Cartulaire IWC local désactive explicitement la synchronisation distante', () => {
  assert.match(app, /useHybridPersistence\(mockCartulary\.id, !isIwcCartulary\)/);
});

test('Auth, le cloud et les projections publiques ne sont plus des imports initiaux', () => {
  assert.doesNotMatch(persistence, /^import \{ onAuthStateChanged \} from 'firebase\/auth';/m);
  assert.doesNotMatch(persistence, /^import \{ auth \} from '\.\.\/firebase/m);
  assert.match(persistence, /^import type \{ CloudSyncReport \} from '\.\/cloudDraft';/m);
  assert.doesNotMatch(persistence, /^import \{ deletePrivateCloudDraft,/m);
  assert.match(persistence, /import\('firebase\/auth'\)/);
  assert.match(persistence, /import\('\.\.\/firebase\.ts'\)/);
  assert.match(persistence, /await import\('\.\/cloudDraft\.ts'\)/);
  assert.doesNotMatch(app, /^import \{ loadPublicProjection \} from '\.\/services\/projections/m);
  assert.match(app, /import\('\.\/services\/projections\.ts'\)/);
});

test('un original privé charge son service uniquement lorsqu’il en a besoin', () => {
  assert.doesNotMatch(privateImage, /^import \{ acquirePrivateMediaObjectUrl \}/m);
  assert.match(privateImage, /import\('\.\.\/services\/privateMedia\.ts'\)/);
});
