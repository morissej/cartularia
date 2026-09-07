import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
const api = vi.hoisted(() => ({ blob: vi.fn(), metadata: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(), createUrl: vi.fn(), revokeUrl: vi.fn() }));
vi.mock('../../src/firebase', () => ({ db: {}, storage: {} }));
vi.mock('firebase/storage', () => ({ getBlob: api.blob, getMetadata: api.metadata, ref: (_storage: unknown, path: string) => path }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  collection: (parent: unknown, ...path: string[]) => [typeof parent === 'string' ? parent : '', ...path].filter(Boolean).join('/'),
  getDoc: api.getDoc, getDocs: api.getDocs, onSnapshot: vi.fn(), orderBy: vi.fn(), query: vi.fn(), where: vi.fn(),
}));
const bytes = () => new NodeBlob(['presentation'], { type: 'image/webp' });
const hidePage = (persisted: boolean) => {
  const event = new Event('pagehide'); Object.defineProperty(event, 'persisted', { value: persisted }); window.dispatchEvent(event);
};
beforeEach(() => {
  vi.resetModules(); api.blob.mockReset(); api.getDoc.mockReset(); api.getDocs.mockReset(); api.createUrl.mockReset(); api.revokeUrl.mockReset();
  api.metadata.mockReset().mockResolvedValue({ size: 12 });
  api.createUrl.mockImplementation(() => `blob:media-${api.createUrl.mock.calls.length}`);
  vi.stubGlobal('crypto', webcrypto);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: api.createUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: api.revokeUrl });
});
afterEach(() => { hidePage(false); vi.unstubAllGlobals(); });

it('retourne textes et références sans aucun téléchargement, même si Storage ne répond pas', async () => {
  api.blob.mockImplementation(() => new Promise(() => {}));
  api.getDoc.mockImplementation(async (path: string) => path.startsWith('publications/') ? { exists: () => true, data: () => ({ status: 'published', blockIds: ['media-library'] }) } : { exists: () => false });
  api.getDocs.mockResolvedValue({ docs: [{ data: () => ({ blockId: 'media-library', payload: { paragraphs: ['Texte immédiat'] }, assets: [{ storagePath: 'public/OBJ-001/photo/web_1', downloadUrl: 'https://untrusted.example/original' }] }) }] });
  const { loadPublicProjection } = await import('../../src/services/projections');
  const result = await loadPublicProjection('OBJ-001');
  expect(result?.blocks[0].payload.paragraphs).toEqual(['Texte immédiat']);
  expect(result?.blocks[0].assets[0].downloadUrl).toBeNull();
  expect(api.blob).not.toHaveBeenCalled();
});

it('ne lit jamais un chemin privé ou une URL arbitraire comme copie publique', async () => {
  const { acquirePublicMediaObjectUrl } = await import('../../src/services/publicMedia');
  for (const path of ['private-drafts/owner/cart/file/hash/original', 'https://example.com/file', 'public/OBJ-001/../original', 'public/OBJ-001/photo/web_1?token=x']) {
    await expect(acquirePublicMediaObjectUrl(path)).rejects.toMatchObject({ kind: 'missing' });
  }
  expect(api.blob).not.toHaveBeenCalled();
});

it('mutualise un même fichier et limite deux téléchargements simultanés', async () => {
  let active = 0; let maximum = 0;
  const complete: Array<() => void> = [];
  api.blob.mockImplementation(() => new Promise((resolve) => { active += 1; maximum = Math.max(maximum, active); complete.push(() => { active -= 1; resolve(bytes()); }); }));
  const { acquirePublicMediaObjectUrl } = await import('../../src/services/publicMedia');
  const requests = [1, 1, 2, 3, 4].map((id) => acquirePublicMediaObjectUrl(`public/OBJ-001/photo${id}/web_1`));
  await vi.waitFor(() => expect(api.blob).toHaveBeenCalledTimes(2));
  complete.splice(0).forEach((done) => done());
  await vi.waitFor(() => expect(api.blob).toHaveBeenCalledTimes(4));
  complete.splice(0).forEach((done) => done());
  const leases = await Promise.all(requests);
  expect(maximum).toBe(2); expect(leases[0].url).toBe(leases[1].url);
  leases.forEach((lease) => lease.release());
});

it('un échec ne pollue pas le cache et une nouvelle demande réussit', async () => {
  api.blob.mockRejectedValueOnce({ code: 'storage/retry-limit-exceeded' }).mockResolvedValue(bytes());
  const { acquirePublicMediaObjectUrl } = await import('../../src/services/publicMedia');
  await expect(acquirePublicMediaObjectUrl('public/OBJ-001/photo/web_1')).rejects.toMatchObject({ code: 'storage/retry-limit-exceeded' });
  const lease = await acquirePublicMediaObjectUrl('public/OBJ-001/photo/web_1');
  expect(lease.url).toMatch(/^blob:/); expect(api.blob).toHaveBeenCalledTimes(2); lease.release();
});

it('refuse une copie dont les octets diffèrent de son empreinte', async () => {
  api.blob.mockResolvedValue(bytes());
  const { acquirePublicMediaObjectUrl } = await import('../../src/services/publicMedia');
  await expect(acquirePublicMediaObjectUrl('public/OBJ-001/photo/web_1', `sha256:${'0'.repeat(64)}`)).rejects.toMatchObject({ kind: 'integrity' });
  expect(api.createUrl).not.toHaveBeenCalled();
});

it('garde les URL actives pendant un aller-retour bfcache et les libère au vrai départ', async () => {
  api.blob.mockResolvedValue(bytes());
  const { acquirePublicMediaObjectUrl } = await import('../../src/services/publicMedia');
  const first = await acquirePublicMediaObjectUrl('public/OBJ-001/photo/web_1');
  hidePage(true);
  expect(api.revokeUrl).not.toHaveBeenCalled();
  const returned = await acquirePublicMediaObjectUrl('public/OBJ-001/photo/web_1');
  expect(returned.url).toBe(first.url); expect(api.blob).toHaveBeenCalledOnce();
  first.release(); returned.release(); hidePage(false);
  expect(api.revokeUrl).toHaveBeenCalledExactlyOnceWith(first.url);
});

it('annonce les étapes et la taille réelle sans prétendre connaître des octets progressifs', async () => {
  api.metadata.mockResolvedValue({ size: 24 * 1024 * 1024 }); api.blob.mockResolvedValue(bytes());
  const onProgress = vi.fn();
  const { acquirePublicMediaObjectUrl } = await import('../../src/services/publicMedia');
  const lease = await acquirePublicMediaObjectUrl('public/OBJ-001/photo/progress', undefined, { onProgress });
  expect(onProgress.mock.calls.map(([value]) => value.stage)).toEqual(['queued', 'metadata', 'downloading', 'verifying', 'ready']);
  expect(onProgress.mock.calls[2][0]).toEqual({ stage: 'downloading', byteSize: 24 * 1024 * 1024 });
  expect(api.metadata).toHaveBeenCalledWith('public/OBJ-001/photo/progress');
  expect(api.blob).toHaveBeenCalledWith('public/OBJ-001/photo/progress', 100 * 1024 * 1024);
  lease.release();
});

it('annule uniquement son observateur sans interrompre un autre lecteur de la même copie', async () => {
  let complete!: (blob: NodeBlob) => void;
  api.blob.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  const cancelled = new AbortController(), firstProgress = vi.fn(), secondProgress = vi.fn();
  const { acquirePublicMediaObjectUrl } = await import('../../src/services/publicMedia');
  const first = acquirePublicMediaObjectUrl('public/OBJ-001/photo/shared', undefined, { signal: cancelled.signal, onProgress: firstProgress });
  const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  const second = acquirePublicMediaObjectUrl('public/OBJ-001/photo/shared', undefined, { onProgress: secondProgress });
  await vi.waitFor(() => expect(api.blob).toHaveBeenCalledOnce());
  cancelled.abort(); await rejected;
  const progressCount = firstProgress.mock.calls.length;
  complete(bytes()); const lease = await second;
  expect(firstProgress).toHaveBeenCalledTimes(progressCount);
  expect(secondProgress.mock.calls.at(-1)?.[0].stage).toBe('ready');
  expect(lease.url).toMatch(/^blob:/); expect(api.blob).toHaveBeenCalledOnce();
  lease.release();
});

it('ne démarre aucun traitement pour une attente déjà annulée et respecte le refus de métadonnées', async () => {
  const controller = new AbortController(); controller.abort();
  const { acquirePublicMediaObjectUrl } = await import('../../src/services/publicMedia');
  await expect(acquirePublicMediaObjectUrl('public/OBJ-001/photo/aborted', undefined, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(api.metadata).not.toHaveBeenCalled(); expect(api.blob).not.toHaveBeenCalled();
  api.metadata.mockRejectedValue({ code: 'storage/unauthorized' });
  await expect(acquirePublicMediaObjectUrl('public/OBJ-001/photo/denied')).rejects.toMatchObject({ code: 'storage/unauthorized' });
  expect(api.blob).not.toHaveBeenCalled();
});

it('annonce un fichier trop volumineux avant de lancer son transfert', async () => {
  api.metadata.mockResolvedValue({ size: 100 * 1024 * 1024 + 1 });
  const { acquirePublicMediaObjectUrl } = await import('../../src/services/publicMedia');
  await expect(acquirePublicMediaObjectUrl('public/OBJ-001/photo/large')).rejects.toMatchObject({ kind: 'too-large' });
  expect(api.blob).not.toHaveBeenCalled();
});
