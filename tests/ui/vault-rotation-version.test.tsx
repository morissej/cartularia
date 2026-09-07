import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rotatePersonalPasswordWithKit } from '../../src/personalVault/recoveryRepository';
import { decryptPersonalPayload, encryptPersonalPayload } from '../../src/personalVault/crypto';
import { createPersonalRecoveryKit, wrapRecoveryPassword, type PersonalRecoveryKit } from '../../src/personalVault/recoveryCrypto';
import { createPersonalRecoveryCommands } from '../../scripts/lib/personal-recovery-command.mjs';
import { emptyPersonalVaultPayload, type PersonalVaultPayload } from '../../src/personalVault/types';

const state = vi.hoisted(() => ({
  profile: {} as Record<string, unknown>, recovery: {} as Record<string, unknown>, opened: '' as string | undefined,
  command: null as ReturnType<typeof createPersonalRecoveryCommands> | null,
  passwordWrites: [] as string[], readCount: 0, beforeRead: null as ((count: number) => void) | null,
  beforeCommit: null as (() => void) | null, failAuthAt: 0,
  personalAuth: { currentUser: { uid: 'owner' } }, bridgeAuth: { currentUser: { uid: 'bridge' } },
}));
vi.mock('../../src/personalVault/firebase', () => ({ personalAuth: state.personalAuth, personalDb: {}, personalPersistenceReady: Promise.resolve(), personalVaultProjectId: 'vault-test' }));
vi.mock('../../src/personalVault/codeBridgeFirebase', () => ({ codeBridgeAuth: state.bridgeAuth, bridgePersistenceReady: Promise.resolve() }));
vi.mock('../../src/personalVault/repository', () => ({ loadPersonalVault: vi.fn(), getOpenedPersonalVaultCiphertext: () => state.opened, rememberPersonalVaultCiphertext: (_uid: string, value: string) => { state.opened = value; } }));
vi.mock('../../src/personalVault/recoveryTransport', () => ({ callPersonalRecovery: async (name: string, data: unknown) => { if (name === 'getPersonalVaultRecoveryStatus') return state.command!.status(data); expect(name).toBe('commitPersonalVaultPasswordRotation'); state.beforeCommit?.(); return state.command!.commitPasswordRotation(data); } }));
vi.mock('firebase/auth', () => ({ signInWithCustomToken: vi.fn(), updatePassword: async (_user: unknown, password: string) => { state.passwordWrites.push(password); if (state.passwordWrites.length === state.failAuthAt) throw new Error('Auth interruption'); } }));
vi.mock('firebase/firestore', () => ({ doc: (...parts: unknown[]) => parts, getDocFromServer: async () => { state.beforeRead?.(++state.readCount); return { exists: () => true, data: () => state.profile }; } }));

let kit: PersonalRecoveryKit;
let payload: PersonalVaultPayload;
const user = { uid: 'owner', getIdToken: async () => 'mock-personal-token' } as never;
const bridgeUser = { uid: 'bridge', getIdToken: async () => 'mock-bridge-token' } as never;
const rotate = () => rotatePersonalPasswordWithKit({ user, bridgeUser, kit, password: 'new-test-password', payload, operationId: crypto.randomUUID() });
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  state.passwordWrites = []; state.readCount = 0; state.beforeRead = null; state.beforeCommit = null; state.failAuthAt = 0;
  state.personalAuth.currentUser = { uid: 'owner' }; state.bridgeAuth.currentUser = { uid: 'bridge' };
  kit = await createPersonalRecoveryKit({ personalUid: 'owner', personalProjectId: 'vault-test', userAlias: 'atlas' });
  payload = emptyPersonalVaultPayload('atlas'); payload.owners[0].label = 'État A affiché';
  state.profile = { ...await encryptPersonalPayload({ payload, password: 'original-test-password', userAlias: 'atlas' }), ownerUid: 'owner', accountId: kit.accountId };
  state.opened = String(state.profile.ciphertext);
  state.recovery = { credentialId: kit.credentialId, bridgeUid: 'bridge', wrappedPassword: await wrapRecoveryPassword('original-test-password', kit.wrappingPublicKeyJwk, kit.credentialId) };
  const db = { doc: (path: string) => ({ path, get: async () => ({ exists: true, data: () => path.startsWith('vaultRecovery/') ? state.recovery : state.profile }) }), runTransaction: async (task: (transaction: unknown) => Promise<unknown>) => {
    const nextProfile = { ...state.profile }; const nextRecovery = { ...state.recovery };
    const result = await task({
      get: async ({ path }: { path: string }) => ({ exists: true, data: () => path.startsWith('vaultRecovery/') ? nextRecovery : nextProfile }),
      update: ({ path }: { path: string }, value: Record<string, unknown>) => { Object.assign(path.startsWith('vaultRecovery/') ? nextRecovery : nextProfile, value); },
    });
    state.profile = nextProfile; state.recovery = nextRecovery; return result;
  } };
  const auth = (uid: string) => ({ verifyIdToken: async () => ({ uid, auth_time: Date.now() / 1000 }), getUser: async () => ({ uid, disabled: false }) });
  state.command = createPersonalRecoveryCommands({ personalDb: db, personalAuth: auth('owner'), bridgeAuth: auth('bridge') });
});
afterEach(() => vi.unstubAllGlobals());
const newer = async () => {
  const next = structuredClone(payload); next.owners[0].label = 'État B enregistré ailleurs';
  return { ...state.profile, ...await encryptPersonalPayload({ payload: next, password: 'original-test-password', userAlias: 'atlas' }) };
};
describe('AC02 : rotation liée à la version effectivement ouverte', () => {
  it.each(['remplacé', 'révoqué'])('refuse avant Auth un kit %s pendant une autre session', async (change) => {
    if (change === 'remplacé') state.recovery.credentialId = crypto.randomUUID();
    else state.recovery.revokedAt = new Date().toISOString();
    const ciphertext = state.profile.ciphertext;
    await expect(rotate()).rejects.toMatchObject({ code: 'vault-kit-stale' });
    expect(state.passwordWrites).toEqual([]); expect(state.profile.ciphertext).toBe(ciphertext);
  });
  it('signale honnêtement la fenêtre résiduelle de révocation entre contrôle et commit, sans réécrire le Coffre', async () => {
    const ciphertext = state.profile.ciphertext;
    state.beforeCommit = () => { state.recovery.revokedAt = new Date().toISOString(); };
    await expect(rotate()).rejects.toMatchObject({ code: 'vault-rotation-uncertain', message: expect.stringContaining('remplacé ou révoqué ne permet plus') });
    expect(state.passwordWrites).toHaveLength(2); expect(state.profile.ciphertext).toBe(ciphertext);
    expect(state.recovery.lastRotationId).toBeUndefined();
  });
  it.each(['avant rotation', 'pendant cryptographie'])('refuse une version périmée %s avant toute mutation Auth', async (when) => {
    const fresh = await newer();
    if (when === 'avant rotation') state.profile = fresh;
    else state.beforeRead = (count) => { if (count === 2) state.profile = fresh; };
    await expect(rotate()).rejects.toMatchObject({ code: 'vault-conflict' });
    expect(state.passwordWrites).toEqual([]);
    expect(state.profile.ciphertext).toBe(fresh.ciphertext);
    const decrypted = await decryptPersonalPayload<PersonalVaultPayload>({ envelope: state.profile as never, password: 'original-test-password', userAlias: 'atlas' });
    expect(decrypted.owners[0].label).toBe('État B enregistré ailleurs');
  });
  it('refuse un changement de session avant Auth et ne publie rien', async () => {
    state.bridgeAuth.currentUser = { uid: 'another-bridge' };
    await expect(rotate()).rejects.toMatchObject({ code: 'vault-session-changed' });
    expect(state.passwordWrites).toEqual([]);
  });
  it('le CAS serveur protège aussi une écriture arrivant après les changements Auth', async () => {
    const fresh = await newer(); state.beforeCommit = () => { state.profile = fresh; };
    await expect(rotate()).rejects.toMatchObject({ code: 'vault-rotation-uncertain' });
    expect(state.passwordWrites).toHaveLength(2); expect(state.profile.ciphertext).toBe(fresh.ciphertext);
    expect(state.recovery.lastRotationId).toBeUndefined();
  });
  it.each([1, 2])('une interruption au changement Auth %s conserve le ciphertext et le kit précédent', async (step) => {
    const initialCiphertext = state.profile.ciphertext; const initialWrap = state.recovery.wrappedPassword;
    state.failAuthAt = step;
    await expect(rotate()).rejects.toMatchObject({ code: 'vault-rotation-uncertain' });
    expect(state.profile.ciphertext).toBe(initialCiphertext); expect(state.recovery.wrappedPassword).toBe(initialWrap);
    state.failAuthAt = 0;
    await rotate(); // the same kit can finish after an interrupted Auth update
    expect(state.recovery.lastRotationId).toBeDefined();
  });
  it('une rotation sans conflit conserve le contenu et confirme la nouvelle version', async () => {
    await rotate();
    const decrypted = await decryptPersonalPayload<PersonalVaultPayload>({ envelope: state.profile as never, password: 'new-test-password', userAlias: 'atlas' });
    expect(decrypted.owners[0].label).toBe('État A affiché');
    expect(state.opened).toBe(state.profile.ciphertext); expect(state.passwordWrites).toHaveLength(2);
  });
});
