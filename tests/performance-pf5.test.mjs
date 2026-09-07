import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const [app, persistence, privateImage] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/persistence/useHybridPersistence.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/PrivateMediaImage.tsx', import.meta.url), 'utf8'),
]);

test('les démos et minisites ne synchronisent aucun brouillon privé, les autres Cartulaires le peuvent', () => {
  const parsed = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const calls = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'useHybridPersistence') calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].arguments.length, 2, 'la politique de synchronisation doit être explicite');
  const expression = calls[0].arguments[1].getText(parsed);
  // Execute only the actual boolean policy, not App or its Firebase imports.
  const enabled = new Function('isDemoCartulary', 'isWatchWebsite', `return (${expression});`);
  for (const isDemo of [false, true]) {
    for (const isWebsite of [false, true]) {
      assert.equal(enabled(isDemo, isWebsite), !isDemo && !isWebsite, `démo=${isDemo}, minisite=${isWebsite}`);
    }
  }
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
