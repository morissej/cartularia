import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptPersonalPayload, vaultAccountDocumentId } from '../../src/personalVault/crypto';
import { emptyPersonalVaultPayload } from '../../src/personalVault/types';
import { loadPersonalVault, lockPersonalVault, savePersonalVault } from '../../src/personalVault/repository';

const state = vi.hoisted(() => ({ document: null as null | Record<string, unknown>, writes: 0, beforeConfirmation: null as (() => void) | null }));
vi.mock('../../src/personalVault/firebase', () => ({ personalAuth: {}, personalDb: {}, personalPersistenceReady: Promise.resolve() }));
vi.mock('../../src/personalVault/codeBridgeRepository', () => ({ authenticateCodeBridge: vi.fn(), lockCodeBridge: async () => undefined }));
vi.mock('firebase/auth', () => ({ signOut: async () => undefined, createUserWithEmailAndPassword: vi.fn(), signInWithEmailAndPassword: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: (...parts: unknown[]) => parts,
  getDocFromServer: async () => { if (state.writes > 0) state.beforeConfirmation?.(); return { exists: () => state.document !== null, data: () => state.document }; },
  serverTimestamp: () => ({ seconds: 1_700_000_000, nanoseconds: state.writes + 1 }),
  runTransaction: async (_db: unknown, task: (transaction: unknown) => Promise<void>) => task({
    get: async () => ({ exists: () => state.document !== null, data: () => state.document }),
    set: (_reference: unknown, value: Record<string, unknown>) => { state.writes++; state.document = value; },
  }),
}));
const user = { uid: 'vault-owner' } as never;
const password = 'secret-password-test';
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); state.document = null; state.writes = 0; state.beforeConfirmation = null; });
afterEach(async () => { await lockPersonalVault(); vi.unstubAllGlobals(); });

describe('Coffre : les sessions anciennes ne réécrivent pas une nouvelle enveloppe', () => {
  it('enregistre un nouveau Coffre puis un nouveau snapshot confirmé', async () => {
    const payload = emptyPersonalVaultPayload('Atlas');
    expect(await loadPersonalVault({ user, userAlias: 'Atlas', password })).toBeNull();
    const saved = await savePersonalVault({ user, payload, password });
    expect(saved.codeRevision).toEqual({ seconds: 1_700_000_000, nanoseconds: 1 });
    await savePersonalVault({ user, payload: { ...payload, managers: [] }, password });
    expect(state.writes).toBe(2);
    expect(JSON.stringify(state.document)).not.toContain('Atlas');
  });
  it('refuse une sauvegarde si un autre appareil a enregistré ou changé la clé', async () => {
    const payload = emptyPersonalVaultPayload('Atlas');
    const initial = await encryptPersonalPayload({ payload, password, userAlias: 'Atlas' });
    state.document = { ...initial, ownerUid: 'vault-owner', accountId: await vaultAccountDocumentId('Atlas') };
    await loadPersonalVault({ user, userAlias: 'Atlas', password });
    const rotated = await encryptPersonalPayload({ payload, password: 'another-password-test', userAlias: 'Atlas' });
    state.document = { ...state.document, ...rotated };
    await expect(savePersonalVault({ user, payload, password })).rejects.toMatchObject({ code: 'vault-conflict' });
    expect(state.writes).toBe(0);
    expect(state.document.ciphertext).toBe(rotated.ciphertext);
  });
  it('AC04 : ne donne jamais au pont le timestamp d’une version remplacée avant la confirmation', async () => {
    const payload = emptyPersonalVaultPayload('Atlas');
    await loadPersonalVault({ user, userAlias: 'Atlas', password });
    const newer = await encryptPersonalPayload({ payload: { ...payload, storage: [] }, password, userAlias: 'Atlas' });
    state.beforeConfirmation = () => { state.document = { ...state.document, ...newer, updatedAt: { seconds: 1_700_000_001, nanoseconds: 0 } }; };
    await expect(savePersonalVault({ user, payload, password })).rejects.toMatchObject({ code: 'vault-conflict' });
    expect(state.document?.ciphertext).toBe(newer.ciphertext);
  });
});
