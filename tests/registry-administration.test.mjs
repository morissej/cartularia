import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRegistryAdministrationSummary,
  displayMemberReference,
  filterMemberships,
} from '../src/features/registry/registryAdministration.ts';

const membership = (overrides) => ({
  uid: 'member-default',
  organizationId: 'org_demo',
  roles: ['manager'],
  status: 'active',
  scopes: { registryIds: ['reg_collection_privee'] },
  permissions: ['organization.read', 'registry.read'],
  createdAt: { seconds: 1, nanoseconds: 0 },
  revokedAt: null,
  ...overrides,
});

const fixtures = [
  membership({ uid: 'owner-primary', roles: ['account_holder', 'legal_owner'], permissions: ['organization.read', 'membership.read', 'registry.read', 'cartulary.read'] }),
  membership({ uid: 'payer-safe', roles: ['payer'], permissions: ['billing.read'] }),
  membership({ uid: 'payer-overlap', roles: ['payer'], permissions: ['billing.read', 'cartulary.read'] }),
  membership({ uid: 'support-temp', roles: ['support_delegate'], permissions: ['organization.read'], scopes: { registryIds: [] } }),
  membership({ uid: 'manager-invited', roles: ['manager'], status: 'invited', permissions: [], scopes: { registryIds: [] } }),
  membership({ uid: 'guest-revoked', roles: ['guest'], status: 'revoked', permissions: [], scopes: { registryIds: [] } }),
];

test('la synthèse sépare les statuts et les qualités actives', () => {
  const summary = buildRegistryAdministrationSummary(fixtures);
  assert.equal(summary.total, 6);
  assert.equal(summary.active, 4);
  assert.equal(summary.invited, 1);
  assert.equal(summary.revoked, 1);
  assert.equal(summary.roleCount, 4);
  assert.equal(summary.payerCount, 2);
});

test('les contrôles détectent les cumuls sensibles sans inventer une autorisation', () => {
  const summary = buildRegistryAdministrationSummary(fixtures);
  assert.equal(summary.payerWithPatrimonialAccessCount, 1);
  assert.equal(summary.supportDelegateCount, 1);
  assert.equal(summary.activeWithoutScopeCount, 1);
});

test('les filtres statut, qualité et recherche se combinent', () => {
  const result = filterMemberships(fixtures, {
    query: 'facturation',
    status: 'active',
    role: 'payer',
  });
  assert.deepEqual(result.map(({ uid }) => uid), ['payer-safe', 'payer-overlap']);
});

test('la référence affichée masque les identifiants des autres membres', () => {
  assert.equal(displayMemberReference('owner-primary', 'owner-primary'), 'Votre compte');
  assert.equal(displayMemberReference('member-123456', 'owner-primary'), 'Membre mem…456');
  assert.equal(displayMemberReference('short', 'owner-primary'), 'Membre privé');
});

test('les calculs et filtres ne modifient pas les memberships sources', () => {
  const before = structuredClone(fixtures);
  buildRegistryAdministrationSummary(fixtures);
  filterMemberships(fixtures, { query: '', status: 'all', role: 'all' });
  assert.deepEqual(fixtures, before);
});
