import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Attente de la prise en charge serveur (V5, P-B1) : `cartularyCreateRequests/{id}` est écouté, plus sondé ;
 * chaque statut remonte à la page (`pending`, `processing`) ; le rejeu sur `failed` réessayable garde ses
 * délais (1 s, 2,5 s), sa transaction (document entier réécrit à `pending`) et ses erreurs ; délai global de 120 s.
 * Identifiants simulés distincts des fixtures du dépôt.
 */
const api = vi.hoisted(() => ({ onSnapshot: vi.fn(), unsubscribe: vi.fn(), runTransaction: vi.fn(), transactionSet: vi.fn(), transactionGet: vi.fn() }));
vi.mock('../../src/firebase.ts', () => ({ db: {}, storage: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  onSnapshot: api.onSnapshot,
  runTransaction: api.runTransaction,
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  setDoc: vi.fn(),
}));
vi.mock('firebase/storage', () => ({ ref: (_storage: unknown, path: string) => path, uploadBytesResumable: vi.fn() }));
vi.mock('../../src/services/privateUploadVerification.ts', () => ({ waitForPrivateUploadVerification: vi.fn() }));
vi.mock('../../src/security/fileValidation.ts', () => ({ validateFileForUpload: vi.fn() }));
vi.mock('../../src/services/schemaCatalog.ts', () => ({ loadCreationSchemaVersion: vi.fn() }));
vi.mock('../../src/persistence/localVault.ts', () => ({ scopedStorageForCartulary: vi.fn() }));

import {
  CartularyCreationFailedError,
  CartularyCreationTimeoutError,
  waitForCartularyCreation,
} from '../../src/services/cartularyCreation.ts';

const CARTULARY = 'cart_attente_v5_objet';
const request = (status: string, overrides: Record<string, unknown> = {}) => ({
  requestDocumentId: CARTULARY, requestId: 'create_attente_v5', ownerUid: 'owner_attente_v5', cartularyId: CARTULARY,
  organizationId: 'org_attente_v5', registryId: 'reg_attente_v5', publicCode: 'OBJ-ATTENTE-V5', status, ...overrides,
});

type Listener = (snapshot: { exists: () => boolean; data: () => Record<string, unknown> }) => void;
type ErrorListener = (error: Error) => void;
let listeners: { next: Listener; error: ErrorListener }[] = [];
const emit = (data: Record<string, unknown> | null) => { for (const { next } of listeners) next({ exists: () => data !== null, data: () => data ?? {} }); };
const emitError = (error: Error) => { for (const listener of listeners) listener.error(error); };
let stored: Record<string, unknown> | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  listeners = [];
  stored = null;
  api.unsubscribe.mockReset();
  api.onSnapshot.mockReset().mockImplementation((_reference: string, next: Listener, error: ErrorListener) => { listeners.push({ next, error }); return api.unsubscribe; });
  api.transactionSet.mockReset().mockImplementation((_reference: string, data: Record<string, unknown>) => { stored = data; });
  api.transactionGet.mockReset().mockImplementation(async () => ({ exists: () => stored !== null, data: () => stored ?? {} }));
  api.runTransaction.mockReset().mockImplementation(async (_db: unknown, body: (transaction: { get: typeof api.transactionGet; set: typeof api.transactionSet }) => Promise<void>) => body({ get: api.transactionGet, set: api.transactionSet }));
});
afterEach(() => { vi.useRealTimers(); });

describe('attente de la création par écoute', () => {
  it('écoute cartularyCreateRequests/{id}, remonte pending puis processing, résout sur processed et se désabonne une fois', async () => {
    const statuses: string[] = [];
    const pending = waitForCartularyCreation(CARTULARY, { onStatus: (status) => statuses.push(status) });
    expect(api.onSnapshot).toHaveBeenCalledTimes(1);
    expect(api.onSnapshot).toHaveBeenCalledWith(`cartularyCreateRequests/${CARTULARY}`, expect.any(Function), expect.any(Function));
    emit(request('pending'));
    emit(request('processing'));
    emit(request('processed'));
    await expect(pending).resolves.toBeUndefined();
    expect(statuses).toEqual(['pending', 'processing']);
    expect(api.unsubscribe).toHaveBeenCalledTimes(1);
    expect(api.runTransaction).not.toHaveBeenCalled();
    // Aucun sondage : le mock ne définit pas getDoc, toute utilisation lèverait.
    const firestore = await import('firebase/firestore');
    expect('getDoc' in firestore).toBe(false);
  });

  it('un échec réessayable est rejoué une fois après 1 s par une transaction qui réécrit le document entier à pending', async () => {
    const statuses: string[] = [];
    const pending = waitForCartularyCreation(CARTULARY, { onStatus: (status) => statuses.push(status) });
    stored = request('failed', { errorCode: 'unavailable', errorMessage: 'Serveur indisponible.' });
    emit(stored);
    expect(api.runTransaction).not.toHaveBeenCalled();
    // Un second instantané failed reçu pendant le délai est ignoré : une seule transaction.
    emit(stored);
    await vi.advanceTimersByTimeAsync(999);
    expect(api.runTransaction).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.runTransaction).toHaveBeenCalledTimes(1);
    expect(api.transactionSet).toHaveBeenCalledTimes(1);
    const [reference, data] = api.transactionSet.mock.calls[0] as [string, Record<string, unknown>];
    expect(reference).toBe(`cartularyCreateRequests/${CARTULARY}`);
    expect(Object.keys(data).sort()).toEqual(['cartularyId', 'organizationId', 'ownerUid', 'publicCode', 'registryId', 'requestDocumentId', 'requestId', 'requestedAt', 'status', 'updatedAt']);
    expect(data).toMatchObject({ status: 'pending', requestId: 'create_attente_v5', requestedAt: 'SERVER_TIMESTAMP', updatedAt: 'SERVER_TIMESTAMP' });
    expect(statuses).toEqual(['pending']);
    emit(request('pending'));
    emit(request('processed'));
    await expect(pending).resolves.toBeUndefined();
    expect(statuses).toEqual(['pending', 'pending']);
    expect(api.runTransaction).toHaveBeenCalledTimes(1);
    expect(api.unsubscribe).toHaveBeenCalledTimes(1);
    // V5 relecture (R-04) : le délai global est annulé à la résolution (aucune minuterie orpheline) et le second
    // instantané failed n'a programmé aucun rejeu à 2,5 s — la garde `retrying` est ainsi prouvée, pas seulement commentée.
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(api.runTransaction).toHaveBeenCalledTimes(1);
  });

  it('trois échecs réessayables : deux rejeux (1 s puis 2,5 s) puis CartularyCreationFailedError', async () => {
    const pending = waitForCartularyCreation(CARTULARY);
    const rejection = expect(pending).rejects.toBeInstanceOf(CartularyCreationFailedError);
    stored = request('failed', { errorCode: 'unavailable', errorMessage: 'Serveur indisponible.' });
    emit(stored);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.runTransaction).toHaveBeenCalledTimes(1);
    stored = request('failed', { errorCode: 'internal', errorMessage: 'Erreur interne.' });
    emit(stored);
    await vi.advanceTimersByTimeAsync(2_499);
    expect(api.runTransaction).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.runTransaction).toHaveBeenCalledTimes(2);
    emit(request('failed', { errorCode: 'aborted', errorMessage: 'Troisième échec.' }));
    await rejection;
    await expect(pending).rejects.toThrow('Troisième échec.');
    expect(api.runTransaction).toHaveBeenCalledTimes(2);
    expect(api.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('un refus non réessayable (draft_not_ready) rejette immédiatement avec le message serveur, sans transaction', async () => {
    const pending = waitForCartularyCreation(CARTULARY);
    emit(request('failed', { errorCode: 'draft_not_ready', errorMessage: 'Un fichier n’est pas encore vérifié.' }));
    await expect(pending).rejects.toBeInstanceOf(CartularyCreationFailedError);
    await expect(pending).rejects.toThrow('Un fichier n’est pas encore vérifié.');
    expect(api.runTransaction).not.toHaveBeenCalled();
    expect(api.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('une demande pending indéfiniment échoue en CartularyCreationTimeoutError après timeoutMs, désabonnée une fois', async () => {
    const pending = waitForCartularyCreation(CARTULARY, { timeoutMs: 5_000 });
    const rejection = expect(pending).rejects.toBeInstanceOf(CartularyCreationTimeoutError);
    emit(request('pending'));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(api.unsubscribe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    await expect(pending).rejects.toThrow(/peut encore aboutir/);
    expect(api.unsubscribe).toHaveBeenCalledTimes(1);
    // Un instantané tardif ne relance rien.
    emit(request('processed'));
    expect(api.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('une erreur d’écoute rejette immédiatement avec cette erreur ; sans options, le chemin nominal résout', async () => {
    const failing = waitForCartularyCreation(CARTULARY);
    emitError(new Error('permission-denied'));
    await expect(failing).rejects.toThrow('permission-denied');
    expect(api.unsubscribe).toHaveBeenCalledTimes(1);

    listeners = [];
    const nominal = waitForCartularyCreation(CARTULARY);
    emit(request('pending'));
    emit(request('processed'));
    await expect(nominal).resolves.toBeUndefined();
    expect(api.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('une demande disparue rejette', async () => {
    const pending = waitForCartularyCreation(CARTULARY);
    emit(null);
    await expect(pending).rejects.toThrow('La demande de création a disparu.');
    expect(api.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
