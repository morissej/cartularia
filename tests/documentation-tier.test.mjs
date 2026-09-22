import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildDocumentationAssessment,
  buildRegistryDocumentationSummary,
  deriveWatchDocumentationFacts,
  getRegistryDocumentationSummary,
} from '../scripts/lib/documentation-tier-command.mjs';
import { buildRegistryValuationProjection } from '../scripts/lib/registry-valuation-command.mjs';
import { createMemoryFirestore } from './helpers/memory-firestore.mjs';

const TIERS = ['P0', 'P1', 'P2', 'P3', 'P4'];
const CRITERIA = {
  P0: ['piece_identity', 'reference_photo', 'acquisition_proof'],
  P1: ['serials_concordant', 'technical_sheet', 'photo_series_level_1'],
  P2: ['photo_series_level_2', 'associated_set_inventory', 'maintenance_history', 'documented_cost_basis'],
  P3: ['dated_condition_report_dev03', 'dated_sourced_valuation_dev04', 'issued_seal'],
  P4: ['independent_physical_control', 'professional_valuation'],
};
const registry = { id: 'reg_test', organizationId: 'org_test', referenceCurrency: 'EUR' };
const cartulary = (id = 'cart_watch_a', overrides = {}) => ({
  id, organizationId: 'org_test', registryId: 'reg_test', collectionId: 'col_main', collectionIds: ['col_main'],
  assetType: 'watch', displayTitle: `Montre ${id}`, completenessLevel: 'complete', ...overrides,
});
const evidence = (id) => [{ kind: 'test_evidence', reference: `test:${id}`, revision: 4, observedAt: '2026-09-22T08:00:00.000Z' }];
const factsForTier = (tier) => Object.fromEntries(Object.entries(CRITERIA).flatMap(([criterionTier, ids]) => ids.map((id) => [id, {
  status: TIERS.indexOf(criterionTier) <= TIERS.indexOf(tier) ? 'proven' : 'missing',
  evidenceRefs: TIERS.indexOf(criterionTier) <= TIERS.indexOf(tier) ? evidence(id) : [],
}])));
const assessment = (id, tier, overrides = {}) => buildDocumentationAssessment({
  cartulary: cartulary(id, overrides), facts: factsForTier(tier), evaluatedAt: '2026-09-22T10:00:00.000Z', dataRevision: 4,
});
const valuation = (id, amount, overrides = {}) => buildRegistryValuationProjection({
  root: cartulary(id, { revision: 4, ...overrides }),
  retainedValue: { amount, currency: 'EUR', level: 'owner_declared', observedAt: '2026-09-20', sourceLabel: 'Source test documentée', confidence: 'low' },
  insuranceCoverages: [], sourceRevision: 4,
});

test('les cinq paliers P0 à P4 sont déterministes et cumulatifs', () => {
  for (const tier of TIERS) {
    const result = assessment(`cart_${tier.toLowerCase()}`, tier);
    assert.equal(result.assessmentStatus, 'evaluated');
    assert.equal(result.documentationTier, tier);
    assert.equal(result.nextTier, TIERS[TIERS.indexOf(tier) + 1] || null);
    assert.equal(result.visibility, 'secret');
    assert.match(result.contentHash, /^sha256:[a-f0-9]{64}$/);
  }
});

test('une preuve absente ou non vérifiée ne satisfait jamais un critère', () => {
  const facts = factsForTier('P1');
  facts.reference_photo = { status: 'proven', evidenceRefs: [] };
  facts.acquisition_proof = { status: 'unverified', evidenceRefs: evidence('acquisition') };
  const result = buildDocumentationAssessment({ cartulary: cartulary(), facts, evaluatedAt: '2026-09-22T10:00:00.000Z', dataRevision: 2 });
  assert.equal(result.documentationTier, null);
  assert.equal(result.criteria.find(({ criterionId }) => criterionId === 'reference_photo').status, 'unverified');
  assert.equal(result.criteria.find(({ criterionId }) => criterionId === 'acquisition_proof').satisfied, false);
});

test('P3 reste bloqué si DEV-03 ou DEV-04 est indisponible, même avec un Sceau', () => {
  const facts = factsForTier('P3');
  facts.dated_condition_report_dev03 = { status: 'unavailable', evidenceRefs: [] };
  facts.dated_sourced_valuation_dev04 = { status: 'unavailable', evidenceRefs: [] };
  const result = buildDocumentationAssessment({ cartulary: cartulary(), facts, evaluatedAt: '2026-09-22T10:00:00.000Z', dataRevision: 3 });
  assert.equal(result.documentationTier, 'P2');
  assert.equal(result.nextTier, 'P3');
  assert.ok(result.warnings.includes('dependency_unavailable:dated_condition_report_dev03'));
  assert.equal(result.criteria.find(({ criterionId }) => criterionId === 'issued_seal').satisfied, true);
});

test('la dérivation ne confond pas une valeur DEV-08 avec DEV-04 et accepte seulement les sorties explicitement attribuées', () => {
  const retainedValue = { level: 'professional', observedAt: '2026-09-20', sourceLabel: 'Rapport professionnel' };
  const withoutDependencies = deriveWatchDocumentationFacts({ cartularyId: 'cart_watch_a', retainedValue, sections: [], assets: [], seal: null });
  assert.equal(withoutDependencies.dated_condition_report_dev03.status, 'unavailable');
  assert.equal(withoutDependencies.dated_sourced_valuation_dev04.status, 'unavailable');
  assert.equal(withoutDependencies.professional_valuation.status, 'proven');

  const withDependencies = deriveWatchDocumentationFacts({
    cartularyId: 'cart_watch_a',
    retainedValue: { ...retainedValue, developmentId: 'DEV-04' },
    sections: [{ id: 'condition.dev03', revision: 5, fields: { 'condition.dev03.datedReport': { value: 'Rapport DEV-03 daté', proofStatus: 'documented', sourceRefs: ['source_dev03'], observedAt: '2026-09-20' } } }],
    assets: [], seal: null,
  });
  assert.equal(withDependencies.dated_condition_report_dev03.status, 'proven');
  assert.equal(withDependencies.dated_sourced_valuation_dev04.status, 'proven');
});

test('le palier documentaire est indépendant de completenessLevel et le noyau reste multi-actifs', () => {
  assert.equal(assessment('cart_complete', 'P0', { completenessLevel: 'complete' }).documentationTier, 'P0');
  const other = buildDocumentationAssessment({ cartulary: cartulary('cart_car', { assetType: 'car', completenessLevel: 'complete' }), facts: {}, evaluatedAt: '2026-09-22T10:00:00.000Z', dataRevision: 1 });
  assert.equal(other.assessmentStatus, 'not_configured');
  assert.equal(other.documentationTier, null);
  assert.equal(other.verticalProfile, null);
});

test('les actions sont structurées, ordonnées gratuit puis temps puis prestation, sans gain inventé', () => {
  const facts = factsForTier('P2');
  facts.issued_seal = { status: 'missing', evidenceRefs: [] };
  const result = buildDocumentationAssessment({ cartulary: cartulary(), facts, evaluatedAt: '2026-09-22T10:00:00.000Z', dataRevision: 4 });
  assert.deepEqual(result.actions.map(({ costCategory }) => costCategory), ['free', 'time', 'time']);
  for (const action of result.actions) {
    assert.ok(action.action && action.expectedProof && action.priorityReason);
    assert.equal(action.gainMeasurementStatus, 'unmeasured');
    assert.equal(action.gainMeasurementLabel, 'gain non mesuré');
  }
  assert.equal(result.measurement.monetaryGain, null);
  assert.equal(result.measurement.measuredCoefficient, null);
  assert.deepEqual(result.measurement.h3Model, {
    activationStatus: 'inactive', modelVersion: null, source: null, sourceRightToUse: null,
    studiedSegment: null, sampleSize: null, coefficient: null, confidenceInterval: null, measuredAt: null,
  });
});

test('l’agrégat croise seulement les lignes DEV-08 éligibles et distingue P2+ de sous P2', () => {
  const p1 = assessment('cart_p1', 'P1');
  const p2 = assessment('cart_p2', 'P2');
  const future = valuation('cart_future', 30_000);
  future.marketValue.observedAt = '2026-10-01';
  const summary = buildRegistryDocumentationSummary({
    registry,
    documentationItems: [p1, p2, assessment('cart_future', 'P4')],
    valuationItems: [valuation('cart_p1', 10_000), valuation('cart_p2', 20_000), future],
    asOfDate: '2026-09-22', generatedAt: '2026-09-22T10:00:00.000Z',
  });
  assert.equal(summary.securedValue, 20_000);
  assert.equal(summary.exposedValue, 10_000);
  assert.equal(summary.distributionByTier.P1, 1);
  assert.equal(summary.distributionByTier.P2, 1);
  assert.deepEqual(summary.excludedLines, [{ cartularyId: 'cart_future', displayTitle: 'Montre cart_future', reasons: ['value_after_statement'] }]);
  assert.equal(summary.priorityActions.length <= 10, true);
  assert.deepEqual(summary.tierHistory, { status: 'unavailable', reason: 'no_reliable_documentation_snapshot_history', points: [] });
});

test('la commande serveur respecte mandats Cartulaire et Collection', async () => {
  const a = assessment('cart_scope_a', 'P1', { collectionId: 'col_a', collectionIds: ['col_a'] });
  const b = assessment('cart_scope_b', 'P2', { collectionId: 'col_b', collectionIds: ['col_b', 'col_shared'] });
  const firestore = createMemoryFirestore({
    'registries/reg_test': registry,
    'registries/reg_test/documentationItems/cart_scope_a': { ...a, projectionStatus: 'active' },
    'registries/reg_test/documentationItems/cart_scope_b': { ...b, projectionStatus: 'active' },
    'registries/reg_test/valuationItems/cart_scope_a': valuation('cart_scope_a', 10_000, { collectionId: 'col_a', collectionIds: ['col_a'] }),
    'registries/reg_test/valuationItems/cart_scope_b': valuation('cart_scope_b', 20_000, { collectionId: 'col_b', collectionIds: ['col_b', 'col_shared'] }),
    'organizations/org_test/memberships/guest_test': {
      uid: 'guest_test', status: 'active', roles: ['guest'], permissions: ['registry.read', 'valuation.read'], scopes: { registryIds: ['reg_test'] },
      invitationManaged: true, invitationGrants: { reg_test: { registry: false, cartularyIds: [], collectionIds: ['col_shared'] } },
    },
  });
  const summary = await getRegistryDocumentationSummary({ firestore, actorUid: 'guest_test', registryId: 'reg_test', asOfDate: '2026-09-22', occurredAt: '2026-09-22T10:00:00.000Z' });
  assert.deepEqual(summary.lines.map(({ cartularyId }) => cartularyId), ['cart_scope_b']);
  assert.equal(summary.securedValue, 20_000);
  assert.equal(summary.authorizationScope.registry, false);
});

test('une ancienne donnée sans évaluation reste non évaluée, jamais P0', () => {
  const result = buildDocumentationAssessment({ cartulary: cartulary('cart_legacy'), facts: null, evaluatedAt: '2026-09-22T10:00:00.000Z', dataRevision: 0 });
  assert.equal(result.assessmentStatus, 'not_evaluated');
  assert.equal(result.documentationTier, null);
  assert.equal(result.nextTier, 'P0');
  assert.deepEqual(result.actions, []);
});

test('aucun palier ni agrégat Secret n’entre dans la projection publique et les interfaces emploient le vocabulaire demandé', () => {
  const publicProjection = readFileSync(new URL('../scripts/lib/projection-command.mjs', import.meta.url), 'utf8');
  const publicWritePath = publicProjection.slice(publicProjection.indexOf('export const publishPublicBlocks'), publicProjection.indexOf('export const createReportProjection'));
  const cartularyUi = readFileSync(new URL('../src/features/cartulary/components/DocumentationTierPanel.tsx', import.meta.url), 'utf8');
  const registryUi = readFileSync(new URL('../src/features/registry/RegistryDocumentationSummary.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(publicWritePath, /documentationItems|documentationAssessment|documentationTier|securedValue|exposedValue/);
  assert.match(cartularyUi, /valeur défendue/);
  assert.match(cartularyUi, /décote évitée/);
  assert.match(cartularyUi, /Palier de complétude documentaire/);
  assert.doesNotMatch(`${cartularyUi}\n${registryUi}`, /prime garantie|garantie de valeur|optimisation/i);
  assert.match(registryUi, /ordre de grandeur non mesuré|measurement\.label/);
});
