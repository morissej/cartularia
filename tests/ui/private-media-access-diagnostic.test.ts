import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ getDoc: vi.fn(), downloadUrl: vi.fn(), auth: { authStateReady: async () => {}, currentUser: { uid: 'guest' } as { uid: string } | null } }));
vi.mock('../../src/firebase.ts', () => ({ db: {}, storage: {}, auth: api.auth }));
vi.mock('../../src/persistence/localVault.ts', () => ({ cartulariaLocalVault: null }));
vi.mock('firebase/firestore', () => ({ getDoc: api.getDoc, doc: (_db: unknown, ...path: string[]) => path.join('/') }));
vi.mock('firebase/storage', () => ({ getDownloadURL: api.downloadUrl, ref: vi.fn() }));
beforeEach(() => { api.getDoc.mockReset(); api.downloadUrl.mockReset(); api.auth.currentUser = { uid: 'guest' }; });

it('un invité obtient le diagnostic explicite sans lire l’original de son propriétaire', async () => {
  api.getDoc.mockImplementation(async (path: string) => path.startsWith('cartularies/') ? { exists: () => true, data: () => ({ accountHolderId: 'owner' }) } : { exists: () => false });
  const { acquirePrivateMediaObjectUrl } = await import('../../src/services/privateMedia');
  await expect(acquirePrivateMediaObjectUrl('binary_1', 'cart_shared')).rejects.toMatchObject({ kind: 'shared-unavailable' });
  expect(api.getDoc.mock.calls.map(([path]) => path)).toEqual(['privateDrafts/guest/cartularies/cart_shared/binaries/binary_1', 'cartularies/cart_shared']);
  expect(api.downloadUrl).not.toHaveBeenCalled();
});

it('un lecteur déconnecté reçoit une demande de connexion avant toute lecture', async () => {
  api.auth.currentUser = null;
  const { acquirePrivateMediaObjectUrl } = await import('../../src/services/privateMedia');
  await expect(acquirePrivateMediaObjectUrl('binary_1', 'cart_shared')).rejects.toMatchObject({ kind: 'session' });
  expect(api.getDoc).not.toHaveBeenCalled(); expect(api.downloadUrl).not.toHaveBeenCalled();
});
