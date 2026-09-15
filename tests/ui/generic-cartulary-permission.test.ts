import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * V5 relecture (C5) : table de vérité de `canEditGenericCartulary` / `canPublishGenericCartulary`, unique source
 * de `canEdit` pour tout le lecteur depuis le point 1 (`canEdit = authoritative.canManage`). Le serveur reste la
 * frontière (règles `cartularySyncRequests`, `assertOwnerEditor`) ; ce test fige le miroir client : titulaire du
 * compte, adhésion active de ce même uid, rôle `legal_owner`, permission demandée, registre dans le périmètre.
 */
const api = vi.hoisted(() => ({
  currentUser: null as { uid: string } | null,
  membership: null as Record<string, unknown> | null,
  getDocPaths: [] as string[],
}));
vi.mock('../../src/firebase.ts', () => ({
  auth: { authStateReady: async () => undefined, get currentUser() { return api.currentUser; } },
  db: {},
  storage: {},
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  getDoc: async (path: string) => { api.getDocPaths.push(path); return { data: () => api.membership ?? undefined, exists: () => api.membership !== null }; },
  getDocs: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
}));
vi.mock('../../src/persistence/cloudDraft.ts', () => ({ requestAuthoritativeCartularySync: vi.fn(), waitForAuthoritativeSyncCycle: vi.fn() }));
vi.mock('../../src/services/cartularyCreation', () => ({ uploadVerifiedCartularyMedia: vi.fn() }));

import { canEditGenericCartulary, canPublishGenericCartulary } from '../../src/services/genericCartulary.ts';

const envelope = { id: 'cart_perm', accountHolderId: 'holder_perm', organizationId: 'org_perm', registryId: 'reg_perm' } as never;
const activeMembership = (overrides: Record<string, unknown> = {}) => ({
  status: 'active', uid: 'holder_perm', roles: ['legal_owner'], permissions: ['cartulary.edit', 'publication.manage'], scopes: { registryIds: ['reg_perm'] }, ...overrides,
});

beforeEach(() => { api.currentUser = null; api.membership = null; api.getDocPaths.length = 0; });

describe('canEditGenericCartulary : titulaire du compte, adhésion active, rôle, permission, périmètre', () => {
  it('hors session : faux sans lire aucune adhésion', async () => {
    expect(await canEditGenericCartulary(envelope)).toBe(false);
    expect(api.getDocPaths).toEqual([]);
  });

  it('membre de l’organisation mais non titulaire du compte : faux sans lire aucune adhésion (aucune copie fantôme pour un co-membre)', async () => {
    api.currentUser = { uid: 'member_perm' };
    api.membership = activeMembership({ uid: 'member_perm' });
    expect(await canEditGenericCartulary(envelope)).toBe(false);
    expect(await canPublishGenericCartulary(envelope)).toBe(false);
    expect(api.getDocPaths).toEqual([]);
  });

  it('titulaire sans adhésion : faux (lecture de organizations/{org}/memberships/{uid})', async () => {
    api.currentUser = { uid: 'holder_perm' };
    expect(await canEditGenericCartulary(envelope)).toBe(false);
    expect(api.getDocPaths).toEqual(['organizations/org_perm/memberships/holder_perm']);
  });

  it('titulaire avec adhésion complète : vrai pour l’édition et la publication', async () => {
    api.currentUser = { uid: 'holder_perm' };
    api.membership = activeMembership();
    expect(await canEditGenericCartulary(envelope)).toBe(true);
    expect(await canPublishGenericCartulary(envelope)).toBe(true);
  });

  it.each([
    ['adhésion suspendue', { status: 'suspended' }],
    ['uid d’adhésion divergent', { uid: 'autre' }],
    ['sans rôle legal_owner', { roles: ['reader'] }],
    ['sans permission cartulary.edit', { permissions: ['cartulary.read'] }],
    ['registre hors périmètre', { scopes: { registryIds: ['reg_autre'] } }],
    ['sans périmètre', { scopes: {} }],
  ])('titulaire, %s : faux', async (_label, overrides) => {
    api.currentUser = { uid: 'holder_perm' };
    api.membership = activeMembership(overrides);
    expect(await canEditGenericCartulary(envelope)).toBe(false);
  });

  it('titulaire avec cartulary.edit mais sans publication.manage : édition vraie, publication fausse', async () => {
    api.currentUser = { uid: 'holder_perm' };
    api.membership = activeMembership({ permissions: ['cartulary.edit'] });
    expect(await canEditGenericCartulary(envelope)).toBe(true);
    expect(await canPublishGenericCartulary(envelope)).toBe(false);
  });
});
