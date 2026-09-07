import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCodeCorrespondences } from '../../src/personalVault/codeBridgeRepository';
import { saveVaultAndCodes } from '../../src/personalVault/vaultSaveWorkflow';
import { emptyPersonalVaultPayload, type PersonalVaultPayload } from '../../src/personalVault/types';
import type { PersonalVaultSaveReceipt } from '../../src/personalVault/codeSyncRevision';

const state = vi.hoisted(() => ({ records: new Map<string, Record<string, unknown>>(), pause: null as (() => Promise<void>) | null, fail: false, writes: 0 }));
vi.mock('../../src/personalVault/codeBridgeFirebase', () => ({ codeBridgeAuth: {}, codeBridgeDb: {}, codeBridgeIsConfigured: true }));
vi.mock('firebase/firestore', async (importOriginal) => {
  const original = await importOriginal<typeof import('firebase/firestore')>();
  const reference = (...parts: unknown[]) => ({ path: parts.map(part => typeof part === 'object' && part !== null && 'path' in part ? part.path : typeof part === 'string' ? part : '').filter(Boolean).join('/') });
  const snapshot = (ref: { path: string }, records = state.records) => ({ ref, id: ref.path.split('/').at(-1)!, exists: () => records.has(ref.path), data: () => records.get(ref.path) });
  const getDocs = async (ref: { path: string }) => {
    if (state.pause) { const pause = state.pause; state.pause = null; await pause(); }
    return { docs: [...state.records.keys()].filter(path => path.startsWith(ref.path + '/') && !path.slice(ref.path.length + 1).includes('/')).map(path => snapshot({ path })) };
  };
  let queue = Promise.resolve();
  return { ...original, collection: reference, doc: reference, getDocs, getDocsFromServer: getDocs,
    getDocFromServer: async (ref: { path: string }) => snapshot(ref, new Map(state.records)),
    serverTimestamp: () => new original.Timestamp(1_700_000_000, state.writes),
    runTransaction: async (_db: unknown, task: (transaction: unknown) => Promise<void>) => {
      const work = queue.then(async () => {
        const draft = new Map(state.records); let count = 0;
        await task({ get: async (ref: { path: string }) => snapshot(ref, draft), set: (ref: { path: string }, value: Record<string, unknown>) => { draft.set(ref.path, value); count++; }, delete: (ref: { path: string }) => { draft.delete(ref.path); count++; } });
        if (state.fail) throw new Error('transaction unavailable');
        state.records = draft; state.writes += count;
      });
      queue = work.catch(() => undefined); return work;
    },
  };
});
const user = { uid: 'bridge-owner' } as never;
const receipt = (revision: number): PersonalVaultSaveReceipt => ({ codeRevision: { seconds: 1_700_000_000, nanoseconds: revision } });
const locations = () => [...state.records.keys()].filter(path => path.includes('/locations/')).map(path => path.split('/').at(-1));
const fixture = () => { const payload = emptyPersonalVaultPayload('atlas'); payload.storage = [{ locationCode: 'LIE-AAAA0001', codeName: 'secret home' }] as never; return payload; };
beforeEach(() => { state.records = new Map(); state.pause = null; state.fail = false; state.writes = 0; });

describe('AC04 : le vrai dépôt pont publie des générations atomiques ordonnées', () => {
  it('deux sessions : A tardif ne remplace pas les codes de B et ne réécrit pas son marqueur confirmé', async () => {
    const payloadA = fixture(); let remote = { version: 0, payload: payloadA };
    const sessionA = { expected: 0 };
    const persist = (session: { expected: number }) => async (payload: PersonalVaultPayload) => {
      if (session.expected !== remote.version) throw Object.assign(new Error('CAS conflict'), { code: 'vault-conflict' });
      remote = { version: remote.version + 1, payload: structuredClone(payload) }; session.expected = remote.version;
      return receipt(remote.version);
    };
    let release!: () => void; let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; }); const waiting = new Promise<void>(resolve => { entered = resolve; });
    state.pause = async () => { entered(); await blocked; };
    const old = saveVaultAndCodes(payloadA, persist(sessionA), (value, saved) => saveCodeCorrespondences(user, value, saved));
    await waiting;
    const sessionB = { expected: remote.version }; const payloadB = structuredClone(remote.payload);
    payloadB.storage.push({ locationCode: 'LIE-BBBB0002' } as never);
    const newest = await saveVaultAndCodes(payloadB, persist(sessionB), (value, saved) => saveCodeCorrespondences(user, value, saved));
    expect(newest.codeSyncPending).toBe(false);
    release(); expect((await old).codeSyncPending).toBe(true);
    expect(locations()).toEqual(['LIE-AAAA0001', 'LIE-BBBB0002']);
    expect(remote.payload.codeSyncPending).toBe(false); expect(remote.version).toBe(3);
    expect(remote.payload.storage).toHaveLength(2);
  });
  it('une transaction interrompue n’expose aucun code partiel ; la reprise finit et préserve les codes objets serveur', async () => {
    const payload = fixture(); const client = payload.owners[0].clientNumber;
    state.records.set(`codeAccounts/bridge-owner/clients/${client}`, { objectCodes: ['ROL-1234ABCD'] });
    state.fail = true;
    await expect(saveCodeCorrespondences(user, payload, receipt(1))).rejects.toThrow('unavailable');
    expect(state.writes).toBe(0); expect(locations()).toEqual([]);
    state.fail = false;
    await saveCodeCorrespondences(user, payload, receipt(2));
    expect(locations()).toEqual(['LIE-AAAA0001']);
    expect(state.records.get(`codeAccounts/bridge-owner/clients/${client}`)?.objectCodes).toEqual(['ROL-1234ABCD']);
    const projected = JSON.stringify([...state.records.values()]);
    expect(projected).not.toContain('secret home'); expect(projected).not.toContain('atlas');
  });
  it('refuse les générations répétées/anciennes et retire les codes absents uniquement dans la suivante', async () => {
    const payload = fixture(); await saveCodeCorrespondences(user, payload, receipt(2));
    const count = state.writes;
    for (const old of [1, 2]) await expect(saveCodeCorrespondences(user, { ...payload, storage: [] }, receipt(old))).rejects.toMatchObject({ code: 'code-sync-stale' });
    expect(state.writes).toBe(count); expect(locations()).toHaveLength(1);
    await saveCodeCorrespondences(user, { ...payload, storage: [] }, receipt(3)); expect(locations()).toEqual([]);
  });
  it('refuse une publication trop grande sans en écrire un fragment', async () => {
    const payload = fixture(); payload.storage = Array.from({ length: 450 }, (_, index) => ({ locationCode: `LIE-${index.toString(16).padStart(8, '0').toUpperCase()}` })) as never;
    await expect(saveCodeCorrespondences(user, payload, receipt(1))).rejects.toThrow('450');
    expect(state.writes).toBe(0); expect(state.records.size).toBe(0);
  });
  it('conserve des libellés Lieu et Personne stables et uniques après réordre, suppression et ajout', async () => {
    const payload = fixture(); payload.storage.push({ locationCode: 'LIE-BBBB0002' } as never);
    payload.transmissionPlans = [{ transmissionCode: 'TRN-AAAA0001', recipients: [{ recipientCode: 'PER-AAAA0001' }, { recipientCode: 'PER-BBBB0002' }] }] as never;
    await saveCodeCorrespondences(user, payload, receipt(1));
    const label = (kind: string, code: string) => state.records.get(`codeAccounts/bridge-owner/${kind}/${code}`)?.genericLabel;
    const before = { a: label('locations', 'LIE-AAAA0001'), b: label('locations', 'LIE-BBBB0002'), personB: label('people', 'PER-BBBB0002') };
    payload.storage.reverse(); payload.transmissionPlans[0].recipients.reverse();
    await saveCodeCorrespondences(user, payload, receipt(2));
    expect(label('locations', 'LIE-AAAA0001')).toBe(before.a); expect(label('locations', 'LIE-BBBB0002')).toBe(before.b);
    expect(label('people', 'PER-BBBB0002')).toBe(before.personB);
    payload.storage = [{ locationCode: 'LIE-BBBB0002' }, { locationCode: 'LIE-CCCC0003' }] as never;
    payload.transmissionPlans[0].recipients = [{ recipientCode: 'PER-BBBB0002' }, { recipientCode: 'PER-CCCC0003' }] as never;
    await saveCodeCorrespondences(user, payload, receipt(3));
    expect(label('locations', 'LIE-BBBB0002')).toBe(before.b); expect(label('people', 'PER-BBBB0002')).toBe(before.personB);
    expect(label('locations', 'LIE-CCCC0003')).not.toBe(before.b); expect(label('people', 'PER-CCCC0003')).not.toBe(before.personB);
    for (const kind of ['locations', 'people']) {
      const names = [...state.records].filter(([path]) => path.includes('/' + kind + '/')).map(([, data]) => data.genericLabel);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
