import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { createHash, webcrypto } from 'node:crypto';
import type { PrivatePresentation } from '../../src/domain/presentationVariants.ts';

/**
 * Service client des variantes privées (contrat V3, K4) : getBlob sous règles, jamais getDownloadURL, jamais l'original,
 * jamais presentation-v2, empreinte vérifiée, « Aperçu en préparation » sans variante, relecture du manifeste une fois (G12),
 * cache d'Object URL partagé (MAXIMUM_IDLE_OBJECT_URLS conservé).
 */
const api = vi.hoisted(() => ({ auth: { currentUser: { uid: 'owner_v3_client' } as { uid: string } | null, authStateReady: async () => undefined }, authObservers: new Set<(user: { uid: string } | null) => void>(), vault: null as any, blob: vi.fn(), downloadUrl: vi.fn(), getDoc: vi.fn(), createUrl: vi.fn(), revokeUrl: vi.fn(), fetch: vi.fn() }));
vi.mock('../../src/firebase.ts', () => ({ db: {}, storage: {}, auth: api.auth }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, observer: (user: { uid: string } | null) => void) => { api.authObservers.add(observer); return () => api.authObservers.delete(observer); } }));
vi.mock('../../src/persistence/localVault.ts', () => ({ get cartulariaLocalVault() { return api.vault; } }));
vi.mock('firebase/storage', () => ({ getBlob: api.blob, getDownloadURL: api.downloadUrl, ref: (_storage: unknown, path: string) => path }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, ...path: string[]) => path.join('/'), getDoc: api.getDoc }));

const UID = 'owner_v3_client';
const CARTULARY = 'cart_v3_client_object';
const BINARY = 'bin_v3_client';
const bytesOf = (text: string) => Buffer.from(text);
const digestOf = (text: string) => `sha256:${createHash('sha256').update(bytesOf(text)).digest('hex')}`;
const blobOf = (text: string) => new NodeBlob([bytesOf(text)], { type: 'image/webp' });
const variantPath = (width: number, binaryId = BINARY, uid = UID) => `private-derivatives/${uid}/${CARTULARY}/${binaryId}/presentation-v3-${width}.webp`;
const variant = (width: number, text: string, overrides: Partial<PrivatePresentation['variants'][number]> = {}) => ({ width, height: Math.round(width * 2 / 3), storagePath: variantPath(width), sha256: digestOf(text), size: text.length, mimeType: 'image/webp' as const, ...overrides });
const presentation = (): PrivatePresentation => ({
  binaryId: BINARY, version: 'presentation-v3',
  variants: [variant(240, 'v240'), variant(480, 'v480'), variant(768, 'v768'), variant(1200, 'v1200')],
  thumbnail: { dataUrl: 'data:image/webp;base64,UklGRg==', width: 240, height: 160, sha256: digestOf('v240') },
});
const manifestDocument = (data: Record<string, unknown> | null) => ({ exists: () => data !== null, data: () => data });
const hidePage = () => { const event = new Event('pagehide'); Object.defineProperty(event, 'persisted', { value: false }); window.dispatchEvent(event); };

beforeEach(() => {
  vi.resetModules();
  api.auth.currentUser = { uid: UID }; api.authObservers.clear(); api.vault = null;
  api.blob.mockReset(); api.downloadUrl.mockReset(); api.getDoc.mockReset(); api.createUrl.mockReset(); api.revokeUrl.mockReset(); api.fetch.mockReset();
  api.blob.mockImplementation(async (path: string) => {
    const match = /presentation-v3-(\d+)\.webp$/.exec(path);
    if (!match) throw Object.assign(new Error('not found'), { code: 'storage/object-not-found' });
    return blobOf(`v${match[1]}`);
  });
  api.createUrl.mockImplementation(() => `blob:variant-${api.createUrl.mock.calls.length}`);
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', api.fetch);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: api.createUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: api.revokeUrl });
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
});
afterEach(() => { hidePage(); vi.unstubAllGlobals(); });

it('vignette et scène choisissent la variante ≥ cible depuis le miroir asset, sans manifeste, sans getDownloadURL, sans original', async () => {
  const { acquirePrivatePresentationObjectUrl } = await import('../../src/services/privateMedia.ts');
  const thumbnail = await acquirePrivatePresentationObjectUrl({ binaryId: BINARY, cartularyId: CARTULARY, asset: { privatePresentation: presentation() }, role: 'thumbnail' });
  const stage = await acquirePrivatePresentationObjectUrl({ binaryId: BINARY, cartularyId: CARTULARY, asset: { privatePresentation: presentation() }, role: 'stage' });
  expect(api.blob.mock.calls.map(([path, limit]) => [path, limit])).toEqual([[variantPath(240), 8 * 1024 * 1024], [variantPath(768), 8 * 1024 * 1024]]);
  expect(api.getDoc).not.toHaveBeenCalled();
  expect(api.downloadUrl).not.toHaveBeenCalled();
  expect(api.fetch).not.toHaveBeenCalled();
  expect(thumbnail.url).not.toBe(stage.url);
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
  await acquirePrivatePresentationObjectUrl({ binaryId: BINARY, cartularyId: CARTULARY, asset: { privatePresentation: presentation() }, role: 'thumbnail' });
  await acquirePrivatePresentationObjectUrl({ binaryId: BINARY, cartularyId: CARTULARY, asset: { privatePresentation: presentation() }, role: 'stage' });
  expect(api.blob.mock.calls.slice(2).map(([path]) => path)).toEqual([variantPath(480), variantPath(1200)]);
  const again = await acquirePrivatePresentationObjectUrl({ binaryId: BINARY, cartularyId: CARTULARY, asset: { privatePresentation: presentation() }, role: 'stage' });
  expect(api.blob).toHaveBeenCalledTimes(4);
  expect(again.url).toBeDefined();
  [thumbnail, stage, again].forEach((lease) => lease.release());
});

it('sans miroir : lit le manifeste binaire (propriétaire), et sans variante annonce « Aperçu en préparation » sans jamais toucher l’original', async () => {
  const { acquirePrivatePresentationObjectUrl } = await import('../../src/services/privateMedia.ts');
  const { mediaFailureMessage } = await import('../../src/utils/mediaFailure.ts');
  api.getDoc.mockResolvedValueOnce(manifestDocument({ deleted: false, storagePath: `private-drafts/${UID}/${CARTULARY}/${BINARY}/${'a'.repeat(64)}/original`, presentationDerivative: { storagePath: `private-derivatives/${UID}/${CARTULARY}/${BINARY}/presentation-v2.webp`, variantsVersion: 'presentation-v3', variants: presentation().variants.slice(0, 2), thumbnail: null } }));
  const lease = await acquirePrivatePresentationObjectUrl({ binaryId: BINARY, cartularyId: CARTULARY, role: 'stage' });
  expect(api.getDoc).toHaveBeenCalledWith(`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/${BINARY}`);
  expect(api.blob).toHaveBeenCalledWith(variantPath(480), 8 * 1024 * 1024);
  lease.release();
  api.getDoc.mockResolvedValueOnce(manifestDocument({ deleted: false, verificationStatus: 'accepted', storagePath: `private-drafts/${UID}/${CARTULARY}/bin_pending/${'a'.repeat(64)}/original`, presentationDerivative: { storagePath: `private-derivatives/${UID}/${CARTULARY}/bin_pending/presentation-v2.webp` } }));
  await expect(acquirePrivatePresentationObjectUrl({ binaryId: 'bin_pending', cartularyId: CARTULARY, role: 'thumbnail' })).rejects.toMatchObject({ kind: 'derivative-pending' });
  expect(mediaFailureMessage('derivative-pending')).toBe('Aperçu en préparation');
  expect(api.blob).toHaveBeenCalledTimes(1);
  expect(api.blob.mock.calls.every(([path]) => !path.endsWith('/original') && !path.includes('presentation-v2'))).toBe(true);
  expect(api.downloadUrl).not.toHaveBeenCalled();
});

it('échec définitif consigné dans le manifeste (variantsFailure, original rejeté) : « Copie de présentation non produite », jamais un « en préparation » perpétuel (tour 2, point 1)', async () => {
  const { acquirePrivatePresentationObjectUrl } = await import('../../src/services/privateMedia.ts');
  const { mediaFailureMessage } = await import('../../src/utils/mediaFailure.ts');
  const { presentationDerivativeStateFromBinaryRecord } = await import('../../src/domain/presentationVariants.ts');
  const original = `private-drafts/${UID}/${CARTULARY}/${BINARY}/${'a'.repeat(64)}/original`;
  const v2 = `private-derivatives/${UID}/${CARTULARY}/${BINARY}/presentation-v2.webp`;
  // Régénération sharp échouée : le serveur écrit variantsFailure et le backlog nocturne ne reprend jamais ce binaire.
  const sharpFailed = { deleted: false, uploadStatus: 'ready', verificationStatus: 'accepted', storagePath: original, presentationDerivative: { storagePath: v2, variantsVersion: null, variants: [], thumbnail: null, variantsFailure: 'variants_processing_failed', variantsGeneratedAt: '2026-09-14T10:00:00.000Z' } };
  // Original rejeté par la première passe du backlog (G5) : aucune copie de présentation ne viendra.
  const rejected = { deleted: false, uploadStatus: 'failed', verificationStatus: 'rejected', verificationReason: 'inspection_failed', storagePath: original };
  // Vérification en cours ou binaire d'époque : la copie peut encore venir → « Aperçu en préparation ».
  const processing = { deleted: false, uploadStatus: 'verifying', verificationStatus: 'processing', storagePath: original };
  const legacy = { deleted: false, uploadStatus: 'ready', verificationVersion: null, clientUpdatedAt: 1_700_000_000_000, storagePath: original };
  expect(presentationDerivativeStateFromBinaryRecord(sharpFailed, BINARY)).toBe('failed');
  expect(presentationDerivativeStateFromBinaryRecord(rejected, BINARY)).toBe('failed');
  expect(presentationDerivativeStateFromBinaryRecord(processing, BINARY)).toBe('pending');
  expect(presentationDerivativeStateFromBinaryRecord(legacy, BINARY)).toBe('pending');
  expect(presentationDerivativeStateFromBinaryRecord({ ...sharpFailed, presentationDerivative: { variantsVersion: 'presentation-v3', variants: presentation().variants, thumbnail: null, variantsFailure: null } }, BINARY)).toBe('ready');

  api.getDoc.mockResolvedValueOnce(manifestDocument(sharpFailed));
  await expect(acquirePrivatePresentationObjectUrl({ binaryId: BINARY, cartularyId: CARTULARY, role: 'stage' })).rejects.toMatchObject({ kind: 'derivative-failed' });
  api.getDoc.mockResolvedValueOnce(manifestDocument(rejected));
  await expect(acquirePrivatePresentationObjectUrl({ binaryId: BINARY, cartularyId: CARTULARY, role: 'thumbnail' })).rejects.toMatchObject({ kind: 'derivative-failed' });
  api.getDoc.mockResolvedValueOnce(manifestDocument(processing));
  await expect(acquirePrivatePresentationObjectUrl({ binaryId: BINARY, cartularyId: CARTULARY, role: 'thumbnail' })).rejects.toMatchObject({ kind: 'derivative-pending' });
  expect(mediaFailureMessage('derivative-failed')).toBe('Copie de présentation non produite');
  expect(mediaFailureMessage('derivative-failed', 'EN')).toBe('Presentation copy not produced');
  expect(api.getDoc).toHaveBeenCalledTimes(3);
  expect(api.blob).not.toHaveBeenCalled();
  expect(api.downloadUrl).not.toHaveBeenCalled();
  expect(api.fetch).not.toHaveBeenCalled();
});

it('refuse une variante d’un autre propriétaire ou d’un autre binaire et contrôle l’empreinte', async () => {
  const { acquirePrivatePresentationObjectUrl } = await import('../../src/services/privateMedia.ts');
  const foreign = { ...presentation(), variants: [variant(240, 'v240', { storagePath: variantPath(240, BINARY, 'someone_else') })] };
  api.getDoc.mockResolvedValue(manifestDocument({ deleted: false, presentationDerivative: {} }));
  await expect(acquirePrivatePresentationObjectUrl({ binaryId: BINARY, cartularyId: CARTULARY, asset: { privatePresentation: foreign }, role: 'thumbnail' })).rejects.toMatchObject({ kind: 'derivative-pending' });
  expect(api.blob).not.toHaveBeenCalled();
  const tampered = { ...presentation(), variants: [variant(240, 'other-bytes')] };
  await expect(acquirePrivatePresentationObjectUrl({ binaryId: BINARY, cartularyId: CARTULARY, asset: { privatePresentation: tampered }, role: 'thumbnail' })).rejects.toMatchObject({ kind: 'integrity' });
  expect(api.createUrl).not.toHaveBeenCalled();
});

it('variante référencée mais absente de Storage : relit le manifeste une fois (G12), puis « absent » si toujours introuvable', async () => {
  const { acquirePrivatePresentationObjectUrl } = await import('../../src/services/privateMedia.ts');
  const stale = { ...presentation(), variants: [variant(240, 'v240', { storagePath: `private-derivatives/${UID}/${CARTULARY}/${BINARY}/presentation-v3-480.webp`, width: 240 })] };
  api.blob.mockImplementation(async (path: string) => {
    if (path.endsWith('presentation-v3-480.webp')) throw Object.assign(new Error('gone'), { code: 'storage/object-not-found' });
    return blobOf('v240');
  });
  api.getDoc.mockResolvedValueOnce(manifestDocument({ deleted: false, presentationDerivative: { variantsVersion: 'presentation-v3', variants: [variant(240, 'v240')] } }));
  const lease = await acquirePrivatePresentationObjectUrl({ binaryId: BINARY, cartularyId: CARTULARY, asset: { privatePresentation: stale }, role: 'thumbnail' });
  expect(api.getDoc).toHaveBeenCalledTimes(1);
  expect(api.blob.mock.calls.map(([path]) => path)).toEqual([variantPath(480), variantPath(240)]);
  expect(lease.url).toBeDefined();
  lease.release();
  api.getDoc.mockResolvedValueOnce(manifestDocument({ deleted: false, presentationDerivative: { variantsVersion: 'presentation-v3', variants: [variant(480, 'v480')] } }));
  await expect(acquirePrivatePresentationObjectUrl({ binaryId: BINARY, cartularyId: CARTULARY, asset: { privatePresentation: stale }, role: 'thumbnail' })).rejects.toMatchObject({ kind: 'missing' });
  expect(api.getDoc).toHaveBeenCalledTimes(2);
});

it('membre non propriétaire : refus Storage traduit en copie partagée indisponible, jamais un faux état', async () => {
  const { acquirePrivatePresentationObjectUrl } = await import('../../src/services/privateMedia.ts');
  api.blob.mockRejectedValue(Object.assign(new Error('denied'), { code: 'storage/unauthorized' }));
  api.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ accountHolderId: 'owner_actual' }) });
  await expect(acquirePrivatePresentationObjectUrl({ binaryId: BINARY, cartularyId: CARTULARY, asset: { privatePresentation: { ...presentation(), variants: [variant(240, 'v240', { storagePath: variantPath(240, BINARY, UID) })] } }, role: 'thumbnail' })).rejects.toMatchObject({ kind: 'shared-unavailable' });
  expect(api.getDoc).toHaveBeenCalledWith(`cartularies/${CARTULARY}`);
});


const switchUser = (user: { uid: string } | null) => {
  api.auth.currentUser = user;
  api.authObservers.forEach((observer) => observer(user));
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

it('révoque une copie déjà affichée dès la déconnexion et ne réutilise pas son URL après reconnexion', async () => {
  const service = await import('../../src/services/privateMedia.ts');
  const request = { binaryId: BINARY, cartularyId: CARTULARY, asset: { privatePresentation: presentation() }, role: 'thumbnail' as const };
  const lease = await service.acquirePrivatePresentationObjectUrl(request);
  switchUser(null);
  expect(api.revokeUrl).toHaveBeenCalledWith(lease.url);
  await expect(service.acquirePrivatePresentationObjectUrl(request)).rejects.toMatchObject({ kind: 'session' });
  switchUser({ uid: UID });
  const reopened = await service.acquirePrivatePresentationObjectUrl(request);
  expect(reopened.url).not.toBe(lease.url);
  expect(api.blob).toHaveBeenCalledTimes(2);
});

it('ignore un téléchargement tardif après A → déconnexion → A sans recréer de blob URL', async () => {
  const transfer = deferred<Blob>();
  api.blob.mockReturnValueOnce(transfer.promise);
  const { acquirePrivatePresentationObjectUrl } = await import('../../src/services/privateMedia.ts');
  const operation = acquirePrivatePresentationObjectUrl({ binaryId: BINARY, cartularyId: CARTULARY, asset: { privatePresentation: presentation() }, role: 'thumbnail' });
  const result = expect(operation).rejects.toMatchObject({ kind: 'session' });
  await vi.waitFor(() => expect(api.blob).toHaveBeenCalledOnce());
  switchUser(null); switchUser({ uid: UID });
  transfer.resolve(blobOf('v240') as unknown as Blob);
  await result;
  expect(api.createUrl).not.toHaveBeenCalled();
});

it('un original tardif ne repeuple ni le coffre précédent ni celui du nouveau compte', async () => {
  const transfer = deferred<Blob>();
  const original = `private-drafts/${UID}/${CARTULARY}/${BINARY}/${'a'.repeat(64)}/original`;
  const firstVault = { cartularyId: CARTULARY, getBinary: vi.fn(async () => ({ binaryId: BINARY, cloudStoragePath: original, sha256: digestOf('original'), blob: null })), applyCloudBinary: vi.fn() };
  const secondVault = { ...firstVault, applyCloudBinary: vi.fn() };
  api.vault = firstVault;
  api.downloadUrl.mockResolvedValue('https://example.invalid/private-original');
  api.fetch.mockResolvedValue({ ok: true, blob: () => transfer.promise });
  const { acquirePrivateMediaObjectUrl } = await import('../../src/services/privateMedia.ts');
  const operation = acquirePrivateMediaObjectUrl(BINARY, CARTULARY);
  const result = expect(operation).rejects.toMatchObject({ kind: 'session' });
  await vi.waitFor(() => expect(api.fetch).toHaveBeenCalledOnce());
  switchUser({ uid: 'owner_other' }); api.vault = secondVault;
  transfer.resolve(blobOf('original') as unknown as Blob);
  await result;
  expect(firstVault.applyCloudBinary).not.toHaveBeenCalled();
  expect(secondVault.applyCloudBinary).not.toHaveBeenCalled();
  expect(api.createUrl).not.toHaveBeenCalled();
});

it('le verrou applicatif invalide aussi les médias quand Firebase conserve encore le même UID', async () => {
  const { PRIVATE_SESSION_LOCK_EVENT } = await import('../../src/security/privateSessionEvents');
  const service = await import('../../src/services/privateMedia.ts');
  const lease = await service.acquirePrivatePresentationObjectUrl({ binaryId: BINARY, cartularyId: CARTULARY, asset: { privatePresentation: presentation() }, role: 'thumbnail' });
  window.dispatchEvent(new Event(PRIVATE_SESSION_LOCK_EVENT));
  expect(api.revokeUrl).toHaveBeenCalledWith(lease.url);
});
