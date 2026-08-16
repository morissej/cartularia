import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRegistryFollowUpSummary,
  DEFAULT_REGISTRY_FOLLOW_UP_FILTERS,
  deriveFollowUpTimeStatus,
  filterAndSortRegistryFollowUps,
} from '../src/features/registry/registryFollowUp.ts';

const followUp = (overrides) => ({
  id: 'reminder-default',
  cartularyId: 'cartulary-default',
  organizationId: 'org_demo',
  registryId: 'reg_collection_privee',
  collectionId: 'col_watches',
  assetType: 'watch',
  displayTitle: 'Montre exemple',
  title: 'Action exemple',
  category: 'custom',
  dueAt: '2026-08-30T00:00:00.000Z',
  reminderStatus: 'planned',
  visibility: 'secret',
  ...overrides,
});

const now = new Date('2026-08-15T12:00:00.000Z');
const fixtures = [
  followUp({ id: 'late', title: 'Renouvellement assurance', category: 'insurance', dueAt: '2026-08-10T00:00:00.000Z' }),
  followUp({ id: 'today', cartularyId: 'car-demo', collectionId: 'col_vehicles', assetType: 'car', displayTitle: 'Bentley GT', title: 'Contrôle visuel', category: 'visual_evidence', dueAt: '2026-08-15T00:00:00.000Z' }),
  followUp({ id: 'soon', title: 'Entretien périodique', category: 'maintenance', dueAt: { seconds: 1_788_825_600, nanoseconds: 0 } }),
  followUp({ id: 'later', title: 'Action libre', dueAt: '2027-02-01T00:00:00.000Z' }),
  followUp({ id: 'done', title: 'Contrôle terminé', dueAt: '2026-08-01T00:00:00.000Z', reminderStatus: 'completed' }),
];

test('les échéances sont classées par date sans transformer le statut source', () => {
  assert.equal(deriveFollowUpTimeStatus(fixtures[0], now), 'overdue');
  assert.equal(deriveFollowUpTimeStatus(fixtures[1], now), 'due_soon');
  assert.equal(deriveFollowUpTimeStatus(fixtures[2], now), 'due_soon');
  assert.equal(deriveFollowUpTimeStatus(fixtures[3], now), 'scheduled');
  assert.equal(deriveFollowUpTimeStatus(fixtures[4], now), 'completed');
});

test('la synthèse distingue retard, trente jours, planifié et terminé', () => {
  assert.deepEqual(buildRegistryFollowUpSummary(fixtures, now), {
    total: 5,
    overdue: 1,
    dueSoon: 2,
    scheduled: 1,
    completed: 1,
  });
});

test('la recherche est multi-termes et insensible aux accents', () => {
  const result = filterAndSortRegistryFollowUps(fixtures, {
    ...DEFAULT_REGISTRY_FOLLOW_UP_FILTERS,
    query: 'controle visuel bentley',
  }, now);
  assert.deepEqual(result.map(({ id }) => id), ['today']);
});

test('les filtres nature, collection et échéance se combinent', () => {
  const result = filterAndSortRegistryFollowUps(fixtures, {
    ...DEFAULT_REGISTRY_FOLLOW_UP_FILTERS,
    timeStatus: 'due_soon',
    category: 'visual_evidence',
    collectionId: 'col_vehicles',
  }, now);
  assert.deepEqual(result.map(({ id }) => id), ['today']);
});

test('le tri place les urgences en tête sans modifier la source', () => {
  const sourceOrder = fixtures.map(({ id }) => id);
  const result = filterAndSortRegistryFollowUps(fixtures, DEFAULT_REGISTRY_FOLLOW_UP_FILTERS, now);
  assert.deepEqual(result.map(({ id }) => id), ['late', 'today', 'soon', 'later', 'done']);
  assert.deepEqual(fixtures.map(({ id }) => id), sourceOrder);
});
