import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createRegistryRecoveryCommands } from '../../scripts/lib/registry-recovery-command.mjs';
import { activateRegistryRecoveryKit, changeRecoveredRegistryPassword, createRegistryRecoveryKit, parseRegistryRecoveryKit, recoverRegistrySession } from '../../src/services/registryRecovery';

const state = vi.hoisted(() => ({
  auth: { app: { options: { projectId: 'registry-test' } }, currentUser: null as null | { uid: string } },
  commands: null as null | ReturnType<typeof createRegistryRecoveryCommands>,
  context: null as null | { uid: string; token: { auth_time: number } },
  calls: [] as Array<{ name: string; data: Record<string, unknown> }>,
  passwords: [] as string[],
}));
vi.mock('../../src/firebase', () => ({ auth: state.auth, functions: {} }));
vi.mock('firebase/auth', () => ({
  signInWithCustomToken: async (_auth: unknown, token: string) => {
    if (token !== 'test-custom-token-registry-owner') throw new Error('wrong project token');
    const user = { uid: 'registry-owner' }; state.auth.currentUser = user; return { user };
  },
  updatePassword: async (_user: unknown, password: string) => { state.passwords.push(password); },
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string) => async (data: Record<string, unknown>) => {
    state.calls.push({ name, data });
    const handlers: Record<string, () => Promise<unknown>> = {
      enrollRegistryRecovery: () => state.commands!.enroll(state.context, data),
      beginRegistryRecovery: () => state.commands!.begin(data),
      completeRegistryRecovery: () => state.commands!.complete(data),
    };
    return { data: await handlers[name]() };
  },
}));

const makeDb = () => {
  let records = new Map<string, Record<string, unknown>>([['users/registry-owner', { status: 'active' }]]);
  const snapshot = (path: string, source = records) => ({ exists: source.has(path), data: () => structuredClone(source.get(path)) });
  let queue = Promise.resolve();
  return {
    doc: (path: string) => ({ path, get: async () => snapshot(path), set: async (data: Record<string, unknown>, options?: { merge: boolean }) => { records.set(path, { ...(options?.merge ? records.get(path) : {}), ...data }); } }),
    async runTransaction<T>(task: (transaction: { get: (ref: { path: string }) => Promise<ReturnType<typeof snapshot>>; set: (ref: { path: string }, value: Record<string, unknown>) => void; update: (ref: { path: string }, value: Record<string, unknown>) => void }) => Promise<T>) {
      const work = queue.then(async () => {
        const draft = structuredClone(records);
        const result = await task({ get: async ({ path }) => snapshot(path, draft), set: ({ path }, value) => { draft.set(path, value); }, update: ({ path }, value) => { draft.set(path, { ...draft.get(path), ...value }); } });
        records = draft; return result;
      });
      queue = work.then(() => undefined, () => undefined); return work;
    },
  };
};
const user = { uid: 'registry-owner' };
let suspended = false;
let tokensValidAfterTime: string | undefined;
let database: ReturnType<typeof makeDb>;
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  state.auth.currentUser = user; state.context = { uid: user.uid, token: { auth_time: Date.now() / 1000 } };
  state.calls = []; state.passwords = []; suspended = false; tokensValidAfterTime = undefined;
  database = makeDb();
  state.commands = createRegistryRecoveryCommands({ db: database, projectId: 'registry-test', auth: {
    getUser: async () => ({ ...user, disabled: suspended, tokensValidAfterTime }),
    createCustomToken: async (uid: string) => `test-custom-token-${uid}`,
  } });
});
afterEach(() => vi.unstubAllGlobals());

describe('récupération Registre : véritable échange crypto client / commandes serveur', () => {
  it('AC03 : la génération cryptographique réelle refuse une session remplacée pendant son attente', async () => {
    const pending = createRegistryRecoveryKit(user as never);
    state.auth.currentUser = { uid: 'other-user' };
    await expect(pending).rejects.toMatchObject({ code: 'recovery-session-changed' });
    expect(state.calls).toEqual([]);
    state.auth.currentUser = user;
    await expect(createRegistryRecoveryKit(user as never)).resolves.toMatchObject({ ownerUid: user.uid, projectId: 'registry-test' });
  });
  it('AC03 : refuse côté client et serveur tout kit d’un autre UID ou projet, sans remplacer le kit actif', async () => {
    const kit = await createRegistryRecoveryKit(user as never);
    await activateRegistryRecoveryKit(kit);
    const active = await state.commands!.status(state.context);
    for (const changed of [{ ...kit, ownerUid: 'other-user' }, { ...kit, projectId: 'other-project' }]) {
      const calls = state.calls.length;
      await expect(activateRegistryRecoveryKit(changed)).rejects.toMatchObject({ code: 'recovery-session-changed' });
      expect(state.calls).toHaveLength(calls);
      await expect(state.commands!.enroll(state.context, changed)).rejects.toMatchObject({ code: 'permission-denied' });
      expect(await state.commands!.status(state.context)).toEqual(active);
    }
    await expect(state.commands!.enroll(state.context, { credentialId: kit.credentialId, signingPublicKeyJwk: kit.signingPublicKeyJwk })).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('interdit de prendre le contrôle du compte public de démonstration avec un kit de secours', async () => {
    await database.doc('users/registry-owner').set({ status: 'active', accountPurpose: 'public_read_only_demo' });
    const kit = await createRegistryRecoveryKit(user as never);
    await expect(activateRegistryRecoveryKit(kit)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(state.commands!.status(state.context)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(state.commands!.revoke(state.context)).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('retrouve une session depuis le kit et change le mot de passe sans transmettre la clé privée aux callables', async () => {
    const kit = await createRegistryRecoveryKit(user as never);
    await activateRegistryRecoveryKit(kit);
    const restored = parseRegistryRecoveryKit(JSON.stringify(kit));
    state.auth.currentUser = null; state.context = null;
    expect((await recoverRegistrySession(restored)).uid).toBe(user.uid);
    await changeRecoveredRegistryPassword('nouveau-mot-de-passe-test');
    expect(state.passwords).toEqual(['nouveau-mot-de-passe-test']);
    const transmitted = JSON.stringify(state.calls);
    expect(transmitted.includes(kit.signingPrivateKeyJwk.d!)).toBe(false);
    expect(transmitted.includes('nouveau-mot-de-passe-test')).toBe(false);
  });
  it('refuse le kit remplacé, le compte suspendu et le fichier d’un autre projet', async () => {
    const old = await createRegistryRecoveryKit(user as never);
    await activateRegistryRecoveryKit(old);
    const next = await createRegistryRecoveryKit(user as never);
    await activateRegistryRecoveryKit(next);
    state.auth.currentUser = null; state.context = null;
    await expect(recoverRegistrySession(old)).rejects.toMatchObject({ code: 'permission-denied' });
    suspended = true;
    await expect(recoverRegistrySession(next)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(() => parseRegistryRecoveryKit(JSON.stringify({ ...next, projectId: 'other-project' }))).toThrow();
  });
  it('refuse les identifiants détournés et les requêtes de preuve surdimensionnées', async () => {
    const kit = await createRegistryRecoveryKit(user as never);
    await activateRegistryRecoveryKit(kit);
    await expect(state.commands!.begin({ ownerUid: '../other', credentialId: kit.credentialId })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(state.commands!.begin({ ownerUid: user.uid, credentialId: kit.credentialId, padding: 'x'.repeat(9000) })).rejects.toMatchObject({ code: 'invalid-argument' });
  });
  it('refuse de gérer un kit depuis une session récemment révoquée', async () => {
    const kit = await createRegistryRecoveryKit(user as never);
    await activateRegistryRecoveryKit(kit);
    state.context!.token.auth_time = Math.floor(Date.now() / 1000) - 60;
    tokensValidAfterTime = new Date(Date.now() - 30_000).toUTCString();
    await expect(activateRegistryRecoveryKit(kit)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(state.commands!.revoke(state.context)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(state.commands!.status(state.context)).rejects.toMatchObject({ code: 'unauthenticated' });
    state.context!.token.auth_time = Number.NaN;
    await expect(activateRegistryRecoveryKit(kit)).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});
