import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveIsolatedVaultConfiguration } from '../src/personalVault/isolatedConfiguration.ts';

const configuration = (prefix, projectId) => Object.fromEntries(Object.entries({ PROJECT_ID: projectId, API_KEY: 'public-config', AUTH_DOMAIN: `${projectId}.firebaseapp.com`, APP_ID: `${projectId}-app` }).map(([key, value]) => [`${prefix}_${key}`, value]));
const valid = { VITE_FIREBASE_PROJECT_ID: 'registry-project', ...configuration('VITE_PERSONAL_FIREBASE', 'personal-project'), ...configuration('VITE_CODE_BRIDGE_FIREBASE', 'bridge-project') };
test('aucun client ne se connecte en production sans deux configurations dédiées complètes', () => {
  for (const env of [{}, { VITE_FIREBASE_PROJECT_ID: 'registry-project' }, { ...valid, VITE_CODE_BRIDGE_FIREBASE_API_KEY: '' }]) {
    const resolved = resolveIsolatedVaultConfiguration(env);
    assert.equal(resolved.available, false);
    assert.equal(resolved.personal, null);
    assert.equal(resolved.bridge, null);
  }
});
test('chaque collision des trois projets est refusée, même sans variable Registre redondante', () => {
  for (const env of [
    { ...valid, VITE_PERSONAL_FIREBASE_PROJECT_ID: 'registry-project' },
    { ...valid, VITE_CODE_BRIDGE_FIREBASE_PROJECT_ID: 'registry-project' },
    { ...valid, VITE_CODE_BRIDGE_FIREBASE_PROJECT_ID: 'personal-project' },
  ]) assert.equal(resolveIsolatedVaultConfiguration(env).available, false);
  assert.equal(resolveIsolatedVaultConfiguration(valid).available, true);
});
test('les valeurs par défaut locales exigent le mode émulateurs explicite', () => {
  const resolved = resolveIsolatedVaultConfiguration({ VITE_PERSONAL_USE_FIREBASE_EMULATORS: 'true' });
  assert.equal(resolved.available, true);
  assert.notEqual(resolved.personal.projectId, resolved.bridge.projectId);
  assert.equal(resolveIsolatedVaultConfiguration({ VITE_PERSONAL_USE_FIREBASE_EMULATORS: 'true', VITE_PERSONAL_FIREBASE_PROJECT_ID: 'partial' }).available, false);
});
