import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDoc: vi.fn(), getDocs: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(),
  transactionGet: vi.fn(), transactionSet: vi.fn(), runTransaction: vi.fn(),
  deleteObject: vi.fn(), uploadBytes: vi.fn(), batchDelete: vi.fn(), batchCommit: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  collection: (root: { path: string }, sub: string) => ({ path: `${root.path}/${sub}` }),
  getDoc: mocks.getDoc, getDocs: mocks.getDocs, setDoc: mocks.setDoc, updateDoc: mocks.updateDoc,
  runTransaction: mocks.runTransaction, serverTimestamp: () => 'now', deleteDoc: vi.fn(),
  writeBatch: () => ({ delete: mocks.batchDelete, commit: mocks.batchCommit }),
  onSnapshot: vi.fn(),
}));
vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => ({ path }),
  deleteObject: mocks.deleteObject, uploadBytes: mocks.uploadBytes, getDownloadURL: vi.fn(),
}));
vi.mock('../../src/firebase.ts', () => ({ db: {}, storage: {} }));
vi.mock('../../src/security/fileValidation.ts', () => ({
  validateFileForUpload: vi.fn(async () => ({ canonicalMimeType: 'image/png' })),
}));
vi.mock('../../src/services/privateUploadVerification.ts', () => ({ waitForPrivateUploadVerification: vi.fn() }));

import { createVerifiedLocalVaultSession, LocalVaultAccessError, MemoryVaultBackend } from '../../src/persistence/localVault.ts';
import { deletePrivateCloudDraft, primePrivateDraftState, synchronizePrivateDraft } from '../../src/persistence/cloudDraft.ts';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
};
const absent = () => ({ exists: () => false, data: () => ({}) });
const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); },
  };
};
const fixture = () => createVerifiedLocalVaultSession({ uid: 'account-a', cartularyId: 'cart-private', backend: new MemoryVaultBackend(), storage: memoryStorage() });
const untilCalled = async (mock: ReturnType<typeof vi.fn>) => {
  await vi.waitFor(() => expect(mock).toHaveBeenCalled(), { interval: 1 });
};

describe('invalidation de session dans les opérations cloud', () => {
  beforeEach(() => {
    mocks.getDoc.mockReset().mockResolvedValue(absent());
    mocks.getDocs.mockReset().mockResolvedValue({ docs: [] });
    mocks.setDoc.mockReset().mockResolvedValue(undefined);
    mocks.updateDoc.mockReset().mockResolvedValue(undefined);
    mocks.transactionGet.mockReset().mockResolvedValue(absent());
    mocks.transactionSet.mockReset();
    mocks.runTransaction.mockReset().mockImplementation(async (_db, callback) => callback({ get: mocks.transactionGet, set: mocks.transactionSet }));
    mocks.deleteObject.mockReset().mockResolvedValue(undefined);
    mocks.uploadBytes.mockReset().mockResolvedValue(undefined);
    mocks.batchDelete.mockReset();
    mocks.batchCommit.mockReset().mockResolvedValue(undefined);
    localStorage.clear();
  });

  it('rejette un UID différent avant toute lecture ou écriture distante', async () => {
    const session = fixture();
    await expect(synchronizePrivateDraft({ uid: 'account-b', cartularyId: 'cart-private', vault: session.vault })).rejects.toBeInstanceOf(LocalVaultAccessError);
    expect(mocks.getDoc).not.toHaveBeenCalled();
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });

  it('ne crée pas la racine cloud après une révocation pendant la lecture initiale', async () => {
    const session = fixture();
    const read = deferred<ReturnType<typeof absent>>();
    mocks.getDoc.mockReturnValueOnce(read.promise);
    const sync = synchronizePrivateDraft({ uid: session.uid, cartularyId: session.cartularyId, vault: session.vault });
    await untilCalled(mocks.getDoc);
    session.lock();
    read.resolve(absent());
    await expect(sync).rejects.toBeInstanceOf(LocalVaultAccessError);
    expect(mocks.setDoc).not.toHaveBeenCalled();
    expect(mocks.uploadBytes).not.toHaveBeenCalled();
  });

  it('ne pose pas de transaction state après révocation pendant transaction.get', async () => {
    const session = fixture();
    await session.vault.writeRaw('cartularia-specification-groups', '[]');
    const read = deferred<ReturnType<typeof absent>>();
    mocks.transactionGet.mockReturnValueOnce(read.promise);
    const sync = synchronizePrivateDraft({ uid: session.uid, cartularyId: session.cartularyId, vault: session.vault });
    await untilCalled(mocks.transactionGet);
    session.lock();
    read.resolve(absent());
    await expect(sync).rejects.toBeInstanceOf(LocalVaultAccessError);
    expect(mocks.transactionSet).not.toHaveBeenCalled();
  });

  it('ne lance pas l’upload après révocation pendant la transaction binaire', async () => {
    const session = fixture();
    await session.vault.putBinary({ binaryId: 'binary-proof', kind: 'media', fileName: 'proof.png', mimeType: 'image/png', sha256: 'a'.repeat(64), blob: new Blob(['proof']) });
    const read = deferred<ReturnType<typeof absent>>();
    mocks.transactionGet.mockReturnValueOnce(read.promise);
    const sync = synchronizePrivateDraft({ uid: session.uid, cartularyId: session.cartularyId, vault: session.vault });
    await untilCalled(mocks.transactionGet);
    session.lock();
    read.resolve(absent());
    await expect(sync).rejects.toBeInstanceOf(LocalVaultAccessError);
    expect(mocks.transactionSet).not.toHaveBeenCalled();
    expect(mocks.uploadBytes).not.toHaveBeenCalled();
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it('ne réhydrate pas un ancien résultat cloud après fermeture de la session', async () => {
    const session = fixture();
    const read = deferred<{ docs: { id: string; data: () => Record<string, unknown> }[] }>();
    mocks.getDocs.mockReturnValueOnce(read.promise);
    const prime = primePrivateDraftState({ uid: session.uid, cartularyId: session.cartularyId, vault: session.vault, authoritativeHydration: { id: 'migration', stateKeys: ['cartularia-specification-groups'] } });
    await untilCalled(mocks.getDocs);
    session.lock();
    read.resolve({ docs: [{ id: 'cartularia-specification-groups', data: () => ({ value: 'secret distant', revision: 2, clientUpdatedAt: 100 }) }] });
    await expect(prime).rejects.toBeInstanceOf(LocalVaultAccessError);
    expect(session.storage.getItem('cartularia-specification-groups')).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('ne poursuit pas une suppression après démontage pendant la liste des fichiers', async () => {
    let active = true;
    const read = deferred<{ docs: { id: string; data: () => Record<string, unknown> }[] }>();
    mocks.getDocs.mockReturnValueOnce(Promise.resolve({ docs: [] })).mockReturnValueOnce(read.promise);
    const deleting = deletePrivateCloudDraft('account-a', 'cart-private', () => { if (!active) throw new LocalVaultAccessError(); });
    await untilCalled(mocks.getDocs);
    active = false;
    read.resolve({ docs: [{ id: 'binary-proof', data: () => ({ storagePath: 'private-drafts/account-a/cart-private/binary-proof/hash/original' }) }] });
    await expect(deleting).rejects.toBeInstanceOf(LocalVaultAccessError);
    expect(mocks.deleteObject).not.toHaveBeenCalled();
    expect(mocks.batchCommit).not.toHaveBeenCalled();
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });
});
