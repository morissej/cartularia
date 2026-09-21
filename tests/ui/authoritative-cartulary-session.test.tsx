import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useAuthoritativeCartulary } from '../../src/features/cartulary/state/useAuthoritativeCartulary';
import { PRIVATE_SESSION_LOCK_EVENT } from '../../src/security/privateSessionEvents';

const api = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'owner_a' } as { uid: string } | null },
  observers: new Set<(user: { uid: string } | null) => void>(),
  load: vi.fn(), schema: vi.fn(), assets: vi.fn(), canEdit: vi.fn(), canPublish: vi.fn(),
  save: vi.fn(), upload: vi.fn(), collections: vi.fn(),
}));
vi.mock('../../src/firebase', () => ({ auth: api.auth }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, observer: (user: { uid: string } | null) => void) => { api.observers.add(observer); observer(api.auth.currentUser); return () => api.observers.delete(observer); } }));
vi.mock('../../src/services/cartularies.ts', () => ({ loadPrivateCartulary: api.load }));
vi.mock('../../src/services/schemaCatalog.ts', () => ({ loadVerticalSchema: api.schema }));
vi.mock('../../src/services/genericCartulary', () => ({ canEditGenericCartulary: api.canEdit, canPublishGenericCartulary: api.canPublish, loadGenericCartularyAssets: api.assets, saveGenericCartularyFields: api.save, saveGenericCartularyMedia: api.save, confirmCartularyReview: api.save, uploadGenericCartularyMedia: api.upload }));
vi.mock('../../src/services/collections', () => ({ loadRegistryCollections: api.collections }));

const snapshot = (label: string) => ({ envelope: { id: 'cart_test', schemaId: 'watch', schemaVersion: '1', registryId: 'reg_test', collectionId: 'col_test', displayTitle: label }, sections: [] });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const switchUser = (user: { uid: string } | null) => act(() => { api.auth.currentUser = user; api.observers.forEach((observer) => observer(user)); });
beforeEach(() => {
  api.observers.clear(); api.auth.currentUser = { uid: 'owner_a' };
  api.load.mockReset().mockResolvedValue(snapshot('current'));
  api.schema.mockReset().mockResolvedValue({ fields: [], sections: [] });
  api.assets.mockReset().mockResolvedValue([]);
  api.collections.mockReset().mockResolvedValue([]);
  api.canEdit.mockReset().mockResolvedValue(true); api.canPublish.mockReset().mockResolvedValue(true);
  api.save.mockReset().mockResolvedValue(undefined); api.upload.mockReset();
});

it('retire toutes les données et droits au signout et ignore le média encore en vol', async () => {
  const media = deferred<unknown[]>(); api.assets.mockReturnValueOnce(media.promise);
  const { result } = renderHook(() => useAuthoritativeCartulary('cart_test'));
  await waitFor(() => expect(result.current.canManage).toBe(true));
  switchUser(null);
  expect(result.current.status).toBe('signed-out');
  expect(result.current.snapshot).toBeNull(); expect(result.current.schema).toBeNull();
  expect(result.current.canManage).toBe(false); expect(result.current.canPublish).toBe(false);
  await act(async () => media.resolve([{ id: 'private_late' }]));
  expect(result.current.assets).toEqual([]);
});

it('une ancienne réponse A est écartée après A → B → A', async () => {
  const old = deferred<ReturnType<typeof snapshot>>(); api.load.mockReturnValueOnce(old.promise);
  const { result } = renderHook(() => useAuthoritativeCartulary('cart_test'));
  switchUser({ uid: 'owner_b' }); switchUser({ uid: 'owner_a' });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  await act(async () => old.resolve(snapshot('private_old')));
  expect(result.current.snapshot?.envelope.displayTitle).toBe('current');
});

it('un refus de permission lors de l’actualisation ferme le dossier déjà affiché', async () => {
  const { result } = renderHook(() => useAuthoritativeCartulary('cart_test'));
  await waitFor(() => expect(result.current.canManage).toBe(true));
  api.load.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
  const locked = vi.fn(); window.addEventListener(PRIVATE_SESSION_LOCK_EVENT, locked);
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.status).toBe('denied'));
  expect(locked).toHaveBeenCalledOnce(); window.removeEventListener(PRIVATE_SESSION_LOCK_EVENT, locked);
  expect(result.current.snapshot).toBeNull(); expect(result.current.assets).toEqual([]);
  expect(result.current.canManage).toBe(false); expect(result.current.canPublish).toBe(false);
});

it('une sauvegarde terminée après démontage ne lance aucune relecture privée', async () => {
  const save = deferred<void>(); api.save.mockReturnValueOnce(save.promise);
  const { result, unmount } = renderHook(() => useAuthoritativeCartulary('cart_test'));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  const operation = result.current.saveFields([]);
  const failed = expect(operation).rejects.toThrow('La session a changé');
  unmount(); await act(async () => save.resolve()); await failed;
  expect(api.load).toHaveBeenCalledTimes(1);
});

it('le verrou applicatif ferme le lecteur avant même la déconnexion Firebase', async () => {
  const { result } = renderHook(() => useAuthoritativeCartulary('cart_test'));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  act(() => window.dispatchEvent(new Event(PRIVATE_SESSION_LOCK_EVENT)));
  expect(result.current.snapshot).toBeNull(); expect(result.current.status).toBe('signed-out');
  switchUser(api.auth.currentUser);
  expect(result.current.snapshot).toBeNull(); expect(api.load).toHaveBeenCalledTimes(1);
});

it('un upload ancien ne publie plus sa progression ni son résultat après déconnexion', async () => {
  const upload = deferred<unknown>(); api.upload.mockReturnValueOnce(upload.promise);
  const progress = vi.fn();
  const { result } = renderHook(() => useAuthoritativeCartulary('cart_test'));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  const operation = result.current.uploadMedia(new File(['test'], 'test.jpg'), progress);
  const failed = expect(operation).rejects.toThrow('La session a changé');
  switchUser(null);
  api.upload.mock.calls[0][2]('Téléversement terminé');
  await act(async () => upload.resolve({ id: 'late_private' })); await failed;
  expect(progress).not.toHaveBeenCalled(); expect(result.current.assets).toEqual([]);
});


it('un invité limité au dossier reste admis si la liste des Collections lui est refusée', async () => {
  api.collections.mockRejectedValueOnce(Object.assign(new Error('scope limited'), { code: 'permission-denied' }));
  const locked = vi.fn(); window.addEventListener(PRIVATE_SESSION_LOCK_EVENT, locked);
  const { result } = renderHook(() => useAuthoritativeCartulary('cart_test'));
  await waitFor(() => expect(result.current.canManage).toBe(true));
  expect(result.current.snapshot).not.toBeNull();
  expect(result.current.collectionName).toBe('Collection privée');
  expect(locked).not.toHaveBeenCalled(); window.removeEventListener(PRIVATE_SESSION_LOCK_EVENT, locked);
});
