import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCurrentRegistryValuation, summarizeCurrentValuation } from '../src/domain/currentRegistryValuation.ts';
import { buildRegistryValuationProjection } from '../scripts/lib/registry-valuation-command.mjs';

const item = (id, patch = {}) => ({ cartularyId: id, registryId: 'reg_test', organizationId: 'org_test', displayTitle: id, assetType: 'watch', collectionId: 'col_pilots', collectionIds: ['col_pilots'], projectionStatus: 'active', sourceRevision: 5, ...patch });
const projection = (id, amount, patch = {}) => buildRegistryValuationProjection({
  root: { ...item(id), id }, sourceRevision: 5, insuranceCoverages: [],
  retainedValue: { amount, currency: 'EUR', level: 'owner_declared', observedAt: '2026-09-26', sourceLabel: 'Valeur retenue', confidence: 'low', ...patch },
});
const sum = (items, valuations) => buildCurrentRegistryValuation(items, valuations, 'reg_test', 'EUR');

test('les deux montres sont comptées malgré la projection financière absente de l’IWC historique', () => {
  const items = [item('rolex'), item('iwc', { grossValuation: 2500, valuationCurrency: 'EUR' })];
  const valuations = [projection('rolex', 20750)];
  const before = JSON.stringify({ items, valuations });
  const current = sum(items, valuations);
  assert.equal(current.total, 23250);
  assert.equal(current.includedCount, 2);
  assert.equal(current.itemCount, 2);
  assert.equal(current.documentationIncompleteCount, 1);
  assert.equal(summarizeCurrentValuation(current.lines.filter(line => line.collectionIds.includes('col_pilots'))).total, 23250);
  assert.equal(JSON.stringify({ items, valuations }), before, 'lecture seule des données anciennes');
});

test('un objet commun à plusieurs Collections ne compte qu’une fois dans le Registre', () => {
  const rolex = item('rolex', { collectionIds: ['col_pilots', 'col_second', 'col_pilots'] });
  const current = sum([rolex, rolex, item('iwc')], [projection('rolex', 20750), projection('iwc', 2500), projection('outside', 99000)]);
  assert.equal(current.total, 23250);
  assert.equal(current.itemCount, 2);
  assert.equal(summarizeCurrentValuation(current.lines.filter(line => line.collectionIds.includes('col_second'))).total, 20750);
  assert.deepEqual(current.lines[0].collectionIds, ['col_pilots', 'col_second']);
});

test('une valeur courante connue reste incluse sans inventer les métadonnées de l’arrêté', () => {
  const value = buildRegistryValuationProjection({ root: { ...item('iwc'), id: 'iwc' }, retainedValue: { amount: 2500 }, currentValue: { amount: 2500, currency: 'EUR' }, insuranceCoverages: [], sourceRevision: 5 });
  assert.equal(value.eligibility, 'excluded');
  assert.equal(value.marketValue.currency, null);
  const current = sum([item('iwc')], [value]);
  assert.equal(current.total, 2500);
  assert.equal(current.documentationIncompleteCount, 1);
});

test('la création initialise le montant courant depuis la valeur du nouvel objet', () => {
  const value = buildRegistryValuationProjection({ root: { ...item('new'), id: 'new', grossValuation: 1234, valuationCurrency: 'EUR' }, retainedValue: {}, insuranceCoverages: [], sourceRevision: 5 });
  assert.equal(sum([item('new')], [value]).total, 1234);
  assert.equal(value.marketValue.amount, null);
});

test('un montant absent, une devise absente ou étrangère produisent des lignes explicites et un total partiel', () => {
  const current = sum([item('eur'), item('unknown'), item('chf'), item('no-currency')], [projection('eur', 100), projection('chf', 500, { currency: 'CHF' }), projection('no-currency', 200, { currency: '' })]);
  assert.equal(current.total, 100);
  assert.equal(current.itemCount, 4);
  assert.equal(current.missingCount, 3);
  assert.deepEqual(current.lines.map(line => line.issue), [null, 'missing_value', 'currency_mismatch', 'missing_currency']);
  assert.equal(sum([item('unknown')], []).total, null, 'absence de valeur distincte de zéro');
  assert.equal(sum([], []).total, 0, 'inventaire vide');
});

test('une mise à jour ou un retrait remplace la valeur précédente sans reprendre un ancien montant', () => {
  const items = [item('rolex', { grossValuation: 20750, valuationCurrency: 'EUR' })];
  assert.equal(sum(items, [projection('rolex', 22000)]).total, 22000);
  assert.equal(sum(items, [projection('rolex', 0)]).total, 0);
  assert.equal(sum(items, [{ ...projection('rolex', 20750), currentValue: { amount: null, currency: 'EUR' } }]).total, null);
  assert.equal(sum(items, [{ ...projection('rolex', 20750), projectionStatus: 'withdrawn' }]).lines[0].issue, 'inactive_valuation');
  assert.equal(sum(items, [{ ...projection('rolex', 20750), sourceRevision: 4 }]).lines[0].issue, 'stale_valuation');
});

test('les objets retirés, hors Registre et les valorisations d’une autre organisation ne contribuent pas', () => {
  const current = sum([item('active'), item('withdrawn', { projectionStatus: 'withdrawn' }), item('other', { registryId: 'reg_other' })], [projection('active', 100), projection('withdrawn', 100), projection('other', 100)]);
  assert.equal(current.total, 100);
  assert.equal(current.itemCount, 1);
  assert.equal(sum([item('active')], [{ ...projection('active', 100), organizationId: 'org_other' }]).total, null);
});

test('les centimes sont additionnés sans artefact de virgule flottante', () => {
  assert.equal(sum([item('a'), item('b')], [projection('a', 0.1), projection('b', 0.2)]).total, 0.3);
});
