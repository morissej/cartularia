import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildRegistryValuationProjection,
  buildRegistryValuationSnapshot,
  createRegistryValuationSnapshot,
} from '../scripts/lib/registry-valuation-command.mjs';
import { createMemoryFirestore } from './helpers/memory-firestore.mjs';

const registry = { id: 'reg_test', organizationId: 'org_test', referenceCurrency: 'EUR' };
const root = (id, title = id) => ({
  id, organizationId: 'org_test', registryId: 'reg_test', collectionId: 'col_test', collectionIds: ['col_test'],
  assetType: 'watch', displayTitle: title, revision: 2,
});
const retained = (overrides = {}) => ({
  amount: 10_000, currency: 'EUR', level: 'owner_declared', observedAt: '2026-09-01',
  sourceLabel: 'Décision documentée du propriétaire', confidence: 'low', ...overrides,
});

test('la projection exige sans inférence montant, devise, niveau, date, source et confiance', () => {
  const eligible = buildRegistryValuationProjection({ root: root('cart_eligible'), retainedValue: retained(), insuranceCoverages: [], sourceRevision: 3 });
  assert.equal(eligible.eligibility, 'eligible');
  assert.deepEqual(eligible.exclusionReasons, []);
  assert.equal(eligible.marketValue.level, 'owner_declared');

  const excluded = buildRegistryValuationProjection({ root: root('cart_excluded'), retainedValue: { amount: 10_000 }, insuranceCoverages: [], sourceRevision: 3 });
  assert.equal(excluded.eligibility, 'excluded');
  assert.deepEqual(excluded.exclusionReasons, ['missing_currency', 'missing_level', 'missing_date', 'missing_source', 'missing_confidence']);
  assert.equal(excluded.marketValue.currency, null);
});

test('l’arrêté additionne par niveau, sépare assurance et marché et mesure la faible confiance', () => {
  const owner = buildRegistryValuationProjection({
    root: root('cart_owner', 'Montre propriétaire'), retainedValue: retained(), sourceRevision: 3,
    insuranceCoverages: [
      { contractId: 'contract_eur', carrierLabel: 'Assureur A', contractReference: 'A-1', insuredAmount: 12_000, currency: 'EUR', effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', basisLabel: 'Capital convenu', status: 'active' },
      { contractId: 'contract_chf', carrierLabel: 'Assureur B', contractReference: 'B-1', insuredAmount: 1_000, currency: 'CHF', effectiveFrom: '2026-01-01', effectiveTo: null, basisLabel: 'Capital déclaré', status: 'active' },
    ],
  });
  const professional = buildRegistryValuationProjection({ root: root('cart_pro', 'Objet expertisé'), retainedValue: retained({ amount: 20_000, level: 'professional', confidence: 'high' }), insuranceCoverages: [], sourceRevision: 4 });
  const snapshot = buildRegistryValuationSnapshot({ projections: [professional, owner], registry, snapshotId: 'statement_test_1', asOfDate: '2026-09-22', actorUid: 'owner_test', occurredAt: '2026-09-22T10:00:00.000Z' });
  assert.equal(snapshot.totalMarketValue, 30_000);
  assert.equal(snapshot.totalInsuredCapital, 12_000);
  assert.equal(snapshot.coverageGap, 18_000);
  assert.equal(snapshot.uninsuredLineCount, 1);
  assert.equal(snapshot.lowConfidenceValue, 10_000);
  assert.equal(snapshot.lowConfidenceShare, 1 / 3);
  assert.equal(snapshot.totalsByLevel.owner_declared, 10_000);
  assert.equal(snapshot.totalsByLevel.professional, 20_000);
  assert.deepEqual(snapshot.lines.find((line) => line.cartularyId === 'cart_owner').insuranceWarnings, ['insurance_currency_mismatch:contract_chf']);
});

test('les devises étrangères, valeurs futures et métadonnées incomplètes sont exclues et signalées', () => {
  const foreign = buildRegistryValuationProjection({ root: root('cart_chf', 'Objet CHF'), retainedValue: retained({ currency: 'CHF' }), insuranceCoverages: [] });
  const future = buildRegistryValuationProjection({ root: root('cart_future', 'Objet futur'), retainedValue: retained({ observedAt: '2026-10-01' }), insuranceCoverages: [] });
  const incomplete = buildRegistryValuationProjection({ root: root('cart_missing', 'Objet incomplet'), retainedValue: retained({ sourceLabel: '' }), insuranceCoverages: [] });
  const snapshot = buildRegistryValuationSnapshot({ projections: [foreign, future, incomplete], registry, snapshotId: 'statement_test_2', asOfDate: '2026-09-22', actorUid: 'owner_test', occurredAt: '2026-09-22T10:00:00.000Z' });
  assert.equal(snapshot.totalMarketValue, 0);
  assert.deepEqual(snapshot.excludedLines, [
    { cartularyId: 'cart_chf', displayTitle: 'Objet CHF', reasons: ['currency_mismatch'] },
    { cartularyId: 'cart_future', displayTitle: 'Objet futur', reasons: ['value_after_statement'] },
    { cartularyId: 'cart_missing', displayTitle: 'Objet incomplet', reasons: ['missing_source'] },
  ]);
});

test('un contrat incomplet ou dont les dates sont incohérentes ne contribue jamais au capital assuré', () => {
  const projection = buildRegistryValuationProjection({
    root: root('cart_bad_insurance'), retainedValue: retained(), sourceRevision: 3,
    insuranceCoverages: [{
      contractId: 'contract_bad_dates', carrierLabel: 'Assureur', contractReference: 'BAD-1', insuredAmount: 12_000,
      currency: 'EUR', effectiveFrom: '2026-09-01', effectiveTo: '2026-01-01', basisLabel: 'Capital convenu', status: 'active',
    }],
  });
  assert.deepEqual(projection.insuranceContracts, []);
  assert.deepEqual(projection.insuranceWarnings, ['invalid_insurance_contract:contract_bad_dates']);
  const snapshot = buildRegistryValuationSnapshot({ projections: [projection], registry, snapshotId: 'statement_bad_insurance', asOfDate: '2026-09-22', actorUid: 'owner_test', occurredAt: '2026-09-22T10:00:00.000Z' });
  assert.equal(snapshot.totalInsuredCapital, 0);
  assert.equal(snapshot.uninsuredLineCount, 1);
});

test('un nouvel arrêté ne recalcule ni ne modifie le snapshot antérieur', () => {
  const projection = buildRegistryValuationProjection({ root: root('cart_history'), retainedValue: retained(), insuranceCoverages: [] });
  const first = buildRegistryValuationSnapshot({ projections: [projection], registry, snapshotId: 'statement_history_1', asOfDate: '2026-09-01', actorUid: 'owner_test', occurredAt: '2026-09-01T10:00:00.000Z' });
  const updated = buildRegistryValuationProjection({ root: root('cart_history'), retainedValue: retained({ amount: 15_000, observedAt: '2026-09-22' }), insuranceCoverages: [] });
  const second = buildRegistryValuationSnapshot({ projections: [updated], registry, snapshotId: 'statement_history_2', asOfDate: '2026-09-22', actorUid: 'owner_test', occurredAt: '2026-09-22T10:00:00.000Z' });
  assert.equal(first.totalMarketValue, 10_000);
  assert.equal(second.totalMarketValue, 15_000);
  assert.equal(first.lines[0].marketValue, 10_000);
  assert.notEqual(first.contentHash, second.contentHash);
});

test('la commande serveur réserve la création au propriétaire autorisé et rejoue le snapshot sans le recalculer', async () => {
  const projection = buildRegistryValuationProjection({ root: root('cart_command'), retainedValue: retained(), insuranceCoverages: [] });
  const firestore = createMemoryFirestore({
    'registries/reg_test': registry,
    'registries/reg_test/valuationItems/cart_command': projection,
    'organizations/org_test/memberships/owner_test': {
      uid: 'owner_test', status: 'active', roles: ['legal_owner'], permissions: ['valuation.read', 'cartulary.edit'],
      scopes: { registryIds: ['reg_test'] }, invitationManaged: false,
    },
  });
  const first = await createRegistryValuationSnapshot({
    firestore, actorUid: 'owner_test', registryId: 'reg_test', snapshotId: 'statement_command_1',
    asOfDate: '2026-09-22', occurredAt: '2026-09-22T10:00:00.000Z',
  });
  assert.equal(first.replayed, false);
  assert.equal(first.totalMarketValue, 10_000);
  await firestore.doc('registries/reg_test/valuationItems/cart_command').update({
    ...buildRegistryValuationProjection({ root: root('cart_command'), retainedValue: retained({ amount: 99_000 }), insuranceCoverages: [] }),
  });
  const replay = await createRegistryValuationSnapshot({
    firestore, actorUid: 'owner_test', registryId: 'reg_test', snapshotId: 'statement_command_1',
    asOfDate: '2026-09-22', occurredAt: '2026-09-22T12:00:00.000Z',
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.totalMarketValue, 10_000);

  await assert.rejects(createRegistryValuationSnapshot({
    firestore, actorUid: 'reader_test', registryId: 'reg_test', snapshotId: 'statement_command_2',
    asOfDate: '2026-09-22', occurredAt: '2026-09-22T12:00:00.000Z',
  }), { code: 'permission_denied' });
});

test('le parcours rendu explicite le snapshot, les exclusions, les deux colonnes et l’absence de conversion', () => {
  const source = readFileSync(new URL('../src/features/registry/RegistryValuationSummary.tsx', import.meta.url), 'utf8');
  assert.match(source, /Arrêté de valeur/);
  assert.match(source, /Valeur de marché/);
  assert.match(source, /Capital assuré/);
  assert.match(source, /Lignes exclues de l’arrêté/);
  assert.match(source, /Aucun taux de change n’est appliqué/);
  assert.match(source, /Snapshot immuable/);
});
