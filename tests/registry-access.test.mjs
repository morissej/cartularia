import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRegistryAccessSummary,
  DEFAULT_REGISTRY_ACCESS_FILTERS,
  deriveRegistryAccessStatus,
  filterAndSortRegistryAccesses,
  maskRecipientReference,
} from '../src/features/registry/registryAccess.ts';

const access = (overrides) => ({
  id: 'access-default',
  organizationId: 'org_demo',
  registryId: 'reg_collection_privee',
  cartularyId: 'cartulary-default',
  displayTitle: 'Montre exemple',
  recipientLabel: 'Expert mandaté',
  recipientKind: 'person',
  accessKind: 'invitation',
  sourceStatus: 'active',
  issuedAt: '2026-08-01T00:00:00.000Z',
  expiresAt: '2026-09-01T00:00:00.000Z',
  revokedAt: null,
  lastConsultedAt: null,
  consultationCount: 0,
  sourceRevision: 1,
  projectionStatus: 'active',
  contentHash: 'sha256:test',
  ...overrides,
});

const now = new Date('2026-08-15T12:00:00.000Z');
const fixtures = [
  access({ id: 'active', displayTitle: 'IWC Portugieser', recipientLabel: 'expert@atelier.test', consultationCount: 3, lastConsultedAt: '2026-08-14T10:00:00.000Z' }),
  access({ id: 'pending', displayTitle: 'Bentley Continental GT', accessKind: 'mandate', sourceStatus: 'pending', expiresAt: '2026-08-25T00:00:00.000Z' }),
  access({ id: 'expired-date', displayTitle: 'Tableau ancien', accessKind: 'shared_link', sourceStatus: 'active', expiresAt: '2026-08-10T00:00:00.000Z', consultationCount: 1 }),
  access({ id: 'revoked', displayTitle: 'Cave privée', sourceStatus: 'revoked', revokedAt: '2026-08-12T00:00:00.000Z', consultationCount: 2 }),
  access({ id: 'withdrawn', displayTitle: 'Projection retirée', projectionStatus: 'withdrawn' }),
];

test('le statut effectif respecte la révocation et l’expiration temporelle', () => {
  assert.equal(deriveRegistryAccessStatus(fixtures[0], now), 'active');
  assert.equal(deriveRegistryAccessStatus(fixtures[1], now), 'pending');
  assert.equal(deriveRegistryAccessStatus(fixtures[2], now), 'expired');
  assert.equal(deriveRegistryAccessStatus(fixtures[3], now), 'revoked');
});

test('la synthèse exclut les projections retirées et additionne les consultations', () => {
  assert.deepEqual(buildRegistryAccessSummary(fixtures, now), {
    total: 4,
    active: 1,
    pending: 1,
    expired: 1,
    revoked: 1,
    consultations: 6,
    consultedAccesses: 3,
  });
});

test('les filtres statut, nature, consultation et recherche se combinent', () => {
  const result = filterAndSortRegistryAccesses(fixtures, {
    query: 'tableau ancien',
    status: 'expired',
    accessKind: 'shared_link',
    consultation: 'consulted',
  }, now);
  assert.deepEqual(result.map(({ id }) => id), ['expired-date']);
});

test('le tri place les accès actionnables avant les historiques sans modifier la source', () => {
  const before = structuredClone(fixtures);
  const result = filterAndSortRegistryAccesses(fixtures, DEFAULT_REGISTRY_ACCESS_FILTERS, now);
  assert.deepEqual(result.map(({ id }) => id), ['active', 'pending', 'expired-date', 'revoked']);
  assert.deepEqual(fixtures, before);
});

test('les références techniques et adresses sont masquées à l’affichage', () => {
  assert.equal(maskRecipientReference('expert@atelier.test'), 'e***@atelier.test');
  assert.equal(maskRecipientReference('recipientOpaque123'), 'rec…123');
  assert.equal(maskRecipientReference('Expert mandaté'), 'Expert mandaté');
  assert.equal(maskRecipientReference(''), 'Destinataire privé');
});
