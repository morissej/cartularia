import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getDoc: vi.fn(), getDocs: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), runTransaction: vi.fn(),
  getMetadata: vi.fn(), uploadBytes: vi.fn(), deleteObject: vi.fn(), verify: vi.fn(),
  batchSet: vi.fn(), batchDelete: vi.fn(), batchCommit: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  collection: (root: { path: string }, sub: string) => ({ path: `${root.path}/${sub}` }),
  getDoc: api.getDoc, getDocs: api.getDocs, setDoc: api.setDoc, updateDoc: api.updateDoc,
  runTransaction: api.runTransaction, serverTimestamp: () => 'server-now', onSnapshot: vi.fn(),
  deleteDoc: vi.fn(), writeBatch: () => ({ set: api.batchSet, delete: api.batchDelete, commit: api.batchCommit }),
}));
vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => ({ path }), getMetadata: api.getMetadata,
  uploadBytes: api.uploadBytes, deleteObject: api.deleteObject, getDownloadURL: vi.fn(),
}));
vi.mock('../../src/firebase.ts', () => ({ db: {}, storage: {} }));
vi.mock('../../src/security/fileValidation.ts', () => ({ validateFileForUpload: vi.fn(async () => ({ canonicalMimeType: 'image/png' })) }));
vi.mock('../../src/services/privateUploadVerification.ts', () => ({ waitForPrivateUploadVerification: api.verify }));
import { createVerifiedLocalVaultSession, MemoryVaultBackend } from '../../src/persistence/localVault.ts';
import { deletePrivateCloudDraft, primePrivateDraftState, resolvePrivateDraftConflict, synchronizePrivateDraft } from '../../src/persistence/cloudDraft.ts';

const UID = 'owner-recovery';
const CART = 'cart-recovery';
const BINARY = 'binary-recovery';
const KEY = 'cartularia-specification-groups';
const ROOT = `privateDrafts/${UID}/cartularies/${CART}`;
const STATE = `${ROOT}/state/${KEY}`;
const MANIFEST = `${ROOT}/binaries/${BINARY}`;
const SHA = `sha256:${'a'.repeat(64)}`;
const ORIGINAL = `private-drafts/${UID}/${CART}/${BINARY}/${'a'.repeat(64)}/original`;
const docs = new Map<string, Record<string, unknown>>();
const objects = new Map<string, Record<string, unknown>>();
const snapshot = (path: string) => ({ exists: () => docs.has(path), data: () => structuredClone(docs.get(path) ?? {}) });
const storage = () => {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, key: (n: number) => [...values.keys()][n] ?? null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
};
const setup = (backend = new MemoryVaultBackend(), local = storage()) => createVerifiedLocalVaultSession({
  uid: UID, cartularyId: CART, backend, storage: local,
});
const sync = (session: ReturnType<typeof setup>) => synchronizePrivateDraft({ uid: UID, cartularyId: CART, vault: session.vault });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; };
const putBinary = (session: ReturnType<typeof setup>) => session.vault.putBinary({
  binaryId: BINARY, kind: 'media', fileName: 'proof.png', mimeType: 'image/png', sha256: SHA, blob: new Blob(['proof']),
});
const state = (value: string, revision = 1) => ({ key: KEY, value, deleted: false, revision, clientUpdatedAt: 20 });
const pending = (overrides: Record<string, unknown> = {}) => ({ ownerUid: UID, cartularyId: CART, binaryId: BINARY,
  deleted: false, revision: 1, fileName: 'proof.png', mimeType: 'image/png', size: 5, sha256: SHA, kind: 'media',
  storagePath: ORIGINAL, clientUpdatedAt: 20, uploadStatus: 'pending_upload', ...overrides });
const object = () => ({ bucket: 'recovery.test', generation: '11', size: 5, contentType: 'image/png',
  customMetadata: { ownerUid: UID, cartularyId: CART, binaryId: BINARY, sha256: SHA, kind: 'media' } });
const accept = () => {
  const manifest = docs.get(MANIFEST)!;
  docs.set(MANIFEST, { ...manifest, uploadStatus: 'ready', verificationStatus: 'accepted', verificationIdentity: {
    schemaVersion: 'private-binary-identity@1.0.0', ownerUid: UID, cartularyId: CART, binaryId: BINARY,
    storagePath: ORIGINAL, sha256: SHA, size: 5, bucket: 'recovery.test', generation: '11',
  } });
};

beforeEach(() => {
  vi.resetAllMocks(); docs.clear(); objects.clear(); localStorage.clear();
  docs.set(ROOT, { ownerUid: UID, cartularyId: CART, status: 'active' });
  api.getDoc.mockImplementation(async ({ path }) => snapshot(path));
  api.getDocs.mockImplementation(async ({ path }) => ({ docs: [...docs.entries()]
    .filter(([key]) => key.startsWith(`${path}/`)).map(([key, value]) => ({ id: key.split('/').at(-1), ref: { path: key }, data: () => structuredClone(value) })) }));
  api.setDoc.mockImplementation(async ({ path }, value) => { docs.set(path, { ...docs.get(path), ...value }); });
  api.updateDoc.mockImplementation(async ({ path }, value) => { docs.set(path, { ...docs.get(path), ...value }); });
  api.runTransaction.mockImplementation(async (_db, callback) => callback({
    get: async ({ path }: { path: string }) => snapshot(path),
    set: ({ path }: { path: string }, value: Record<string, unknown>, options?: { merge: boolean }) => {
      docs.set(path, options?.merge ? { ...docs.get(path), ...value } : value);
    },
  }));
  api.getMetadata.mockImplementation(async ({ path }) => {
    if (!objects.has(path)) throw Object.assign(new Error('missing'), { code: 'storage/object-not-found' });
    return structuredClone(objects.get(path));
  });
  api.uploadBytes.mockImplementation(async ({ path }) => { objects.set(path, object()); });
  api.verify.mockImplementation(async () => { accept(); });
  api.batchSet.mockImplementation(({ path }, value) => { docs.set(path, { ...docs.get(path), ...value }); });
  api.batchDelete.mockImplementation(({ path }) => { docs.delete(path); });
  api.batchCommit.mockResolvedValue(undefined);
  api.deleteObject.mockImplementation(async ({ path }) => { objects.delete(path); });
});

describe('versions locales et acquittements différés', () => {
  it('rebase A acquittée et garde B dirty, puis pousse B sans conflit', async () => {
    const session = setup(); await session.vault.writeRaw(KEY, 'A');
    const pause = deferred<void>(); const transaction = api.runTransaction.getMockImplementation()!;
    api.runTransaction.mockImplementationOnce(async (...args) => { const result = await transaction(...args); await pause.promise; return result; });
    const running = sync(session);
    await vi.waitFor(() => expect(docs.get(STATE)?.value).toBe('A'));
    await session.vault.writeRaw(KEY, 'B'); pause.resolve();
    expect((await running).status).toBe('pending');
    expect((await session.vault.listStateRecords())[0]).toMatchObject({ value: 'B', dirty: true, cloudRevision: 1 });
    expect(docs.has(`cartularySyncRequests/${CART}`)).toBe(false);
    expect((await sync(session)).status).toBe('synced');
    expect(docs.get(STATE)?.value).toBe('B');
  });

  it('une saisie pendant un pull ne disparaît pas et aucun faux événement pull n’est annoncé', async () => {
    const session = setup(); await session.vault.writeRaw(KEY, 'base'); await sync(session);
    docs.set(STATE, state('remote', 2));
    const pause = deferred<void>(); const transaction = api.runTransaction.getMockImplementation()!;
    api.runTransaction.mockImplementationOnce(async (...args) => { const result = await transaction(...args); await pause.promise; return result; });
    const running = sync(session); await vi.waitFor(() => expect(api.runTransaction).toHaveBeenCalledTimes(3));
    await session.vault.writeRaw(KEY, 'new edit'); pause.resolve();
    const report = await running;
    expect(report.status).toBe('pending'); expect(report.pulledStateKeys).toEqual([]);
    expect(session.storage.getItem(KEY)).toBe('new edit');
    expect((await session.vault.listStateRecords())[0].dirty).toBe(true);
  });

  it('une clé créée pendant la lecture distante gagne sur le pull sans local initial', async () => {
    const session = setup(); docs.set(STATE, state('remote'));
    const pause = deferred<void>(); const read = api.getDocs.getMockImplementation()!;
    api.getDocs.mockImplementationOnce(async (...args) => { const result = await read(...args); await pause.promise; return result; });
    const running = sync(session); await vi.waitFor(() => expect(api.getDocs).toHaveBeenCalled());
    await session.vault.writeRaw(KEY, 'new'); pause.resolve();
    const report = await running; expect(report.status).toBe('pending'); expect(report.pulledStateKeys).toEqual([]);
    expect(session.storage.getItem(KEY)).toBe('new');
  });

  it('le prime cloud conditionne aussi sa réhydratation à la version capturée', async () => {
    const session = setup(); docs.set(STATE, state('remote'));
    const pause = deferred<void>(); const read = api.getDocs.getMockImplementation()!;
    api.getDocs.mockImplementationOnce(async (...args) => { const result = await read(...args); await pause.promise; return result; });
    const running = primePrivateDraftState({ uid: UID, cartularyId: CART, vault: session.vault });
    await vi.waitFor(() => expect(api.getDocs).toHaveBeenCalled());
    await session.vault.writeRaw(KEY, 'new'); pause.resolve(); expect(await running).toBe(0);
    expect(session.storage.getItem(KEY)).toBe('new');
  });

  it('une résolution take-cloud retardée ne remplace pas une nouvelle saisie', async () => {
    const session = setup(); await session.vault.writeRaw(KEY, 'local'); docs.set(STATE, state('remote', 2));
    const pause = deferred<void>(); const read = api.getDoc.getMockImplementation()!;
    api.getDoc.mockImplementationOnce(async (...args) => { await pause.promise; return read(...args); });
    const running = resolvePrivateDraftConflict({ uid: UID, cartularyId: CART, vault: session.vault,
      conflict: { kind: 'state', id: KEY, localRevision: 0, cloudRevision: 2 }, strategy: 'take-cloud' });
    const rejected = expect(running).rejects.toThrow('saisie a changé');
    await vi.waitFor(() => expect(api.getDoc).toHaveBeenCalled());
    await session.vault.writeRaw(KEY, 'new'); pause.resolve(); await rejected;
    expect(session.storage.getItem(KEY)).toBe('new');
  });

  it('un autre onglet et une réouverture conservent B après l’acquittement de A', async () => {
    const backend = new MemoryVaultBackend(); const local = storage(); const first = setup(backend, local); const second = setup(backend, local);
    await first.vault.writeRaw(KEY, 'A');
    const pause = deferred<void>(); const transaction = api.runTransaction.getMockImplementation()!;
    api.runTransaction.mockImplementationOnce(async (...args) => { const result = await transaction(...args); await pause.promise; return result; });
    const running = sync(first); await vi.waitFor(() => expect(docs.get(STATE)?.value).toBe('A'));
    await second.vault.writeRaw(KEY, 'B'); pause.resolve(); await running;
    const reopened = setup(backend, local); expect((await reopened.vault.listStateRecords())[0]).toMatchObject({ value: 'B', dirty: true });
    await sync(reopened); expect(docs.get(STATE)?.value).toBe('B');
  });
});

describe('reprises idempotentes du binaire privé', () => {
  it('reprend après création du manifeste sans original et acquitte seulement après validation', async () => {
    const session = setup(); await putBinary(session); docs.set(MANIFEST, pending());
    const pause = deferred<void>(); api.verify.mockImplementationOnce(async () => { await pause.promise; accept(); });
    const running = sync(session); await vi.waitFor(() => expect(api.verify).toHaveBeenCalled());
    expect((await session.vault.getBinary(BINARY))?.dirty).toBe(true);
    expect(api.uploadBytes).toHaveBeenCalledOnce(); pause.resolve(); expect((await running).status).toBe('synced');
    expect((await session.vault.getBinary(BINARY))?.dirty).toBe(false);
  });

  it('après coupure réseau post-transfert, reconnaît l’objet existant sans écrasement', async () => {
    const session = setup(); await putBinary(session);
    api.uploadBytes.mockImplementationOnce(async ({ path }) => { objects.set(path, object()); throw new Error('response lost'); });
    expect((await sync(session)).status).toBe('synced');
    expect(api.uploadBytes).toHaveBeenCalledOnce(); expect(api.deleteObject).not.toHaveBeenCalled();
  });

  it('réouverture après transfert : attend une validation en cours sans renvoyer l’original', async () => {
    const backend = new MemoryVaultBackend(); const local = storage(); const first = setup(backend, local); await putBinary(first);
    docs.set(MANIFEST, pending({ uploadStatus: 'verifying', verificationStatus: 'processing' })); objects.set(ORIGINAL, object());
    const reopened = setup(backend, local); expect((await sync(reopened)).status).toBe('synced');
    expect(api.uploadBytes).not.toHaveBeenCalled(); expect(api.verify).toHaveBeenCalledOnce();
  });

  it('reprend un transfert échoué avant création de l’objet', async () => {
    const session = setup(); await putBinary(session);
    api.uploadBytes.mockRejectedValueOnce(new Error('offline'));
    await expect(sync(session)).rejects.toThrow('offline');
    expect((await session.vault.getBinary(BINARY))?.dirty).toBe(true);
    expect((await sync(session)).status).toBe('synced'); expect(api.uploadBytes).toHaveBeenCalledTimes(2);
  });

  it('reprend après timeout de validation en conservant l’original', async () => {
    const session = setup(); await putBinary(session);
    api.verify.mockRejectedValueOnce(new Error('verification timeout'));
    await expect(sync(session)).rejects.toThrow('verification timeout');
    expect((await session.vault.getBinary(BINARY))?.dirty).toBe(true);
    expect((await sync(session)).status).toBe('synced'); expect(api.uploadBytes).toHaveBeenCalledOnce();
  });

  it('reprend après acceptation avant acquittement local', async () => {
    const session = setup(); await putBinary(session); docs.set(MANIFEST, pending()); objects.set(ORIGINAL, object()); accept();
    expect((await sync(session)).status).toBe('synced');
    expect(api.verify).not.toHaveBeenCalled(); expect(api.uploadBytes).not.toHaveBeenCalled();
    expect((await session.vault.getBinary(BINARY))?.dirty).toBe(false);
  });

  it.each(['failed', 'verifying', 'pending_upload'])('un manifeste %s sans blob ni original ne vaut pas succès', async (uploadStatus) => {
    const session = setup(); const record = await putBinary(session);
    await session.vault.applyCloudBinary({ ...record, blob: null, dirty: false }, record, { allowDirty: true });
    docs.set(MANIFEST, pending({ uploadStatus }));
    await expect(sync(session)).rejects.toThrow();
    expect(docs.has(`cartularySyncRequests/${CART}`)).toBe(false);
  });

  it('ne reconnaît pas une acceptation sans attestation, ni un autre original substitué', async () => {
    const session = setup(); await putBinary(session); docs.set(MANIFEST, pending({ uploadStatus: 'ready', verificationStatus: 'accepted' })); objects.set(ORIGINAL, object());
    api.verify.mockResolvedValueOnce(undefined);
    await expect(sync(session)).rejects.toThrow('reste à confirmer');
    accept(); objects.set(ORIGINAL, { ...object(), generation: '12' });
    await expect(sync(session)).rejects.toThrow('reste à confirmer');
    expect((await session.vault.getBinary(BINARY))?.dirty).toBe(true);
  });

  it('un refus serveur reste refusé à la reprise et ne supprime pas l’original', async () => {
    const session = setup(); await putBinary(session); docs.set(MANIFEST, pending({ uploadStatus: 'failed', verificationStatus: 'rejected' })); objects.set(ORIGINAL, object());
    await expect(sync(session)).rejects.toThrow('refusé'); expect(api.verify).not.toHaveBeenCalled();
    expect(api.uploadBytes).not.toHaveBeenCalled(); expect(api.deleteObject).not.toHaveBeenCalled();
    expect((await session.vault.getBinary(BINARY))?.dirty).toBe(true);
  });

  it('une suppression pendant la validation reste dirty puis se synchronise au passage suivant', async () => {
    const session = setup(); await putBinary(session);
    const pause = deferred<void>(); api.verify.mockImplementationOnce(async () => { await pause.promise; accept(); });
    const running = sync(session); await vi.waitFor(() => expect(api.verify).toHaveBeenCalled());
    await session.vault.deleteBinary(BINARY); pause.resolve();
    expect((await running).status).toBe('pending');
    expect((await session.vault.getBinary(BINARY))).toMatchObject({ deleted: true, dirty: true, cloudRevision: 1 });
    expect((await sync(session)).status).toBe('synced'); expect(docs.get(MANIFEST)?.deleted).toBe(true);
  });

  it('deux transferts concurrents réutilisent un original déjà créé', async () => {
    const session = setup(); await putBinary(session);
    api.uploadBytes.mockImplementationOnce(async ({ path }) => { objects.set(path, object()); throw Object.assign(new Error('immutable'), { code: 'storage/unauthorized' }); });
    expect((await sync(session)).status).toBe('synced'); expect(api.deleteObject).not.toHaveBeenCalled();
  });
});


describe('intégration des reprises et métadonnées', () => {
  it('un renommage local pendant une reprise ne devient propre qu’après son écriture distante', async () => {
    const session = setup(); await putBinary(session); docs.set(MANIFEST, pending()); objects.set(ORIGINAL, object());
    await session.vault.putBinary({ binaryId: BINARY, kind: 'media', fileName: 'renamed.png', mimeType: 'image/png', sha256: SHA, blob: new Blob(['proof']) });
    expect((await sync(session)).status).toBe('pending');
    expect((await session.vault.getBinary(BINARY))).toMatchObject({ fileName: 'renamed.png', dirty: true, cloudRevision: 1 });
    expect(docs.get(MANIFEST)?.fileName).toBe('proof.png');
    expect((await sync(session)).status).toBe('synced');
    expect(docs.get(MANIFEST)?.fileName).toBe('renamed.png');
    expect(api.uploadBytes).not.toHaveBeenCalled();
  });

  it('le prime autoritaire ne remplace pas une saisie dirty déjà présente', async () => {
    const session = setup(); await session.vault.writeRaw(KEY, 'my edit'); docs.set(STATE, state('remote', 3));
    expect(await primePrivateDraftState({ uid: UID, cartularyId: CART, vault: session.vault,
      authoritativeHydration: { id: 'migration', stateKeys: [KEY] } })).toBe(0);
    expect(session.storage.getItem(KEY)).toBe('my edit');
  });

  it('recontrôle dirty après la requête autoritaire lente', async () => {
    const session = setup(); await session.vault.writeRaw(KEY, 'A');
    const pause = deferred<void>(); const transaction = api.runTransaction.getMockImplementation()!;
    api.runTransaction.mockImplementationOnce(transaction).mockImplementationOnce(async (...args) => { const result = await transaction(...args); await pause.promise; return result; });
    const running = sync(session); await vi.waitFor(() => expect(docs.has(`cartularySyncRequests/${CART}`)).toBe(true));
    await session.vault.writeRaw(KEY, 'B'); pause.resolve();
    const report = await running; expect(report.status).toBe('pending'); expect(report.pendingCount).toBe(1);
  });

  it('supprime logiquement les manifestes acceptés avant les originaux, et reprend après interruption', async () => {
    docs.set(MANIFEST, pending()); objects.set(ORIGINAL, object()); accept();
    api.deleteObject.mockImplementationOnce(async () => {
      expect(docs.get(MANIFEST)).toMatchObject({ deleted: true, storagePath: null, uploadStatus: 'deleted' });
      throw new Error('offline');
    });
    await expect(deletePrivateCloudDraft(UID, CART)).rejects.toThrow('offline');
    expect(docs.get(ROOT)?.status).toBe('active'); expect(objects.has(ORIGINAL)).toBe(true);
    await deletePrivateCloudDraft(UID, CART);
    expect(objects.has(ORIGINAL)).toBe(false); expect(docs.get(ROOT)?.status).toBe('deleted');
    expect(api.batchDelete).not.toHaveBeenCalled(); expect(docs.get(MANIFEST)?.verificationStatus).toBe('accepted');
  });
});

it('reprend une suppression individuelle après tombstone même sans chemin cloud local acquitté', async () => {
  const session = setup(); await putBinary(session); docs.set(MANIFEST, pending()); objects.set(ORIGINAL, object()); accept();
  await session.vault.rebaseBinaryCloudRevision(BINARY, 1, (await session.vault.getBinary(BINARY))!);
  await session.vault.deleteBinary(BINARY);
  api.deleteObject.mockRejectedValueOnce(new Error('delete response lost'));
  await expect(sync(session)).rejects.toThrow('delete response lost');
  expect(docs.get(MANIFEST)?.storagePath).toBeNull();
  expect((await session.vault.getBinary(BINARY))?.cloudStoragePath).toBeNull();
  expect((await sync(session)).status).toBe('synced');
  expect(objects.has(ORIGINAL)).toBe(false); expect(api.deleteObject).toHaveBeenCalledTimes(2);
});

it('le bilan final rejoue une saisie durable d’un autre onglet fermé avant son commit IndexedDB', async () => {
  const backend = new MemoryVaultBackend(); const local = storage(); const first = setup(backend, local);
  await first.vault.writeRaw(KEY, 'A');
  const pause = deferred<void>(); const transaction = api.runTransaction.getMockImplementation()!;
  api.runTransaction.mockImplementationOnce(transaction).mockImplementationOnce(async (...args) => { const result = await transaction(...args); await pause.promise; return result; });
  const running = sync(first); await vi.waitFor(() => expect(docs.has(`cartularySyncRequests/${CART}`)).toBe(true));
  const stalled = Object.create(backend) as MemoryVaultBackend;
  stalled.mutateState = async () => new Promise(() => undefined);
  const second = setup(stalled, local); void second.vault.writeRaw(KEY, 'B durable'); second.lock();
  pause.resolve(); const report = await running;
  expect(report.status).toBe('pending'); expect(report.pendingCount).toBe(1);
  expect((await first.vault.listStateRecords())[0]).toMatchObject({ value: 'B durable', dirty: true });
});
