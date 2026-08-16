import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  collectRegistryPilotChecks,
  evaluateRegistryPilotReadiness,
  REGISTRY_PILOT_CHECK_IDS,
} from '../scripts/lib/registry-pilot-readiness.mjs';
import {
  parseRegistryRoute,
  registryHref,
  REGISTRY_SECTIONS,
} from '../src/features/registry/registryRouting.ts';

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const productionPolicy = JSON.parse(readFileSync(resolve(rootDirectory, 'config/production-policy.json'), 'utf8'));

test('la recette couvre une fois chacune des dix dimensions du pilote', () => {
  assert.equal(new Set(REGISTRY_PILOT_CHECK_IDS).size, 10);
  assert.deepEqual(Object.keys(collectRegistryPilotChecks(rootDirectory)), REGISTRY_PILOT_CHECK_IDS);
});

test('le dépôt courant satisfait la matrice statique R8', () => {
  const checks = collectRegistryPilotChecks(rootDirectory);
  assert.deepEqual(
    Object.entries(checks).filter(([, check]) => !check.passed).map(([id]) => id),
    [],
  );
});

test('un pilote prêt ne fabrique pas une autorisation de production', () => {
  const readiness = evaluateRegistryPilotReadiness({
    checks: collectRegistryPilotChecks(rootDirectory),
    productionPolicy,
  });
  assert.equal(readiness.constructionStatus, 'complete');
  assert.equal(readiness.pilotStatus, 'ready');
  assert.equal(readiness.goLiveAuthorization, 'blocked');
  assert.ok(readiness.productionBlockers.includes('D-01_region_firestore_storage'));
  assert.ok(readiness.productionBlockers.includes('autorisation_deploiement_distant'));
  assert.match(readiness.reportDigest, /^sha256:[a-f0-9]{64}$/);
});

test('tout échec de recette bloque le pilote et la mise en service', () => {
  const checks = collectRegistryPilotChecks(rootDirectory);
  checks.keyboard_accessibility = { passed: false, evidence: [] };
  const readiness = evaluateRegistryPilotReadiness({ checks, productionPolicy });
  assert.equal(readiness.constructionStatus, 'incomplete');
  assert.equal(readiness.pilotStatus, 'blocked');
  assert.deepEqual(readiness.pilotBlockers, ['keyboard_accessibility']);
  assert.ok(readiness.productionBlockers.includes('controle_registryPilot'));
});

test('l’autorisation finale exige toutes les décisions confirmées', () => {
  const authorizedPolicy = structuredClone(productionPolicy);
  authorizedPolicy.regions = { status: 'confirmed', firestore: 'test-region', storage: 'test-region' };
  authorizedPolicy.privacy.encryptionAssessment = { status: 'confirmed', mode: 'approved' };
  authorizedPolicy.privacy.retentionMatrix = { status: 'confirmed', mode: 'approved' };
  authorizedPolicy.pricing = { status: 'confirmed', unitPrices: {} };
  authorizedPolicy.release.remoteDeploymentAuthorized = true;
  const readiness = evaluateRegistryPilotReadiness({
    checks: collectRegistryPilotChecks(rootDirectory),
    productionPolicy: authorizedPolicy,
  });
  assert.equal(readiness.pilotStatus, 'ready');
  assert.equal(readiness.goLiveAuthorization, 'authorized');
  assert.deepEqual(readiness.productionBlockers, []);
});

test('les huit routes du Registre sont stables et les identifiants restent opaques', () => {
  assert.deepEqual(REGISTRY_SECTIONS, ['overview', 'items', 'gallery', 'compare', 'follow-up', 'access', 'integrity', 'admin']);
  assert.deepEqual(parseRegistryRoute('/registry/reg%2Fprive/compare'), {
    registryId: 'reg/prive',
    section: 'compare',
  });
  assert.equal(registryHref('reg/prive', 'follow-up'), '/registry/reg%2Fprive/follow-up');
  assert.equal(registryHref('reg/prive', 'gallery'), '/registry/reg%2Fprive/gallery');
  assert.equal(registryHref('reg/prive', 'integrity'), '/registry/reg%2Fprive/integrity');
});

test('une route inconnue revient à la synthèse sans changer le contexte', () => {
  assert.deepEqual(parseRegistryRoute('/registry/reg_demo/inconnue'), {
    registryId: 'reg_demo',
    section: 'overview',
  });
  assert.deepEqual(parseRegistryRoute('/registry'), {
    registryId: null,
    section: 'overview',
  });
});
