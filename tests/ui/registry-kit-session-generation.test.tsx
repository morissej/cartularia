import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RegistryRecoveryPage } from '../../src/features/public/RegistryRecoveryPage';
import { createRegistryRecoveryCommands } from '../../scripts/lib/registry-recovery-command.mjs';
const state = vi.hoisted(() => ({
  auth: { app: { options: { projectId: 'registry-test' } }, currentUser: { uid: 'user-a' } as any },
  observer: null as any, context: null as any, commands: null as any,
  finishGeneration: null as any, downloaded: null as any,
}));
vi.mock('../../src/firebase', () => ({ auth: state.auth, functions: {} }));
vi.mock('../../src/services/foundations', () => ({ observeCartulariaSession: (callback: any) => { state.observer = callback; callback(state.auth.currentUser); return () => undefined; } }));
vi.mock('../../src/services/registryRecovery', async (importOriginal) => {
  const original = await importOriginal<any>();
  return { ...original, createRegistryRecoveryKit: () => new Promise(resolve => { state.finishGeneration = resolve; }), downloadRegistryRecoveryKit: (kit: any) => { state.downloaded = kit; } };
});
vi.mock('firebase/auth', () => ({ updatePassword: vi.fn(), signInWithCustomToken: vi.fn() }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string) => async (data: any) => {
    const actions: any = { getRegistryRecoveryStatus: () => state.commands.status(state.context), enrollRegistryRecovery: () => state.commands.enroll(state.context, data) };
    return { data: await actions[name]() };
  },
}));
describe('AC03 : une génération tardive ne peut pas remplacer le kit d’un autre compte', () => {
  it('écarte le kit A après connexion B, puis permet de préparer et activer le kit B', async () => {
    vi.stubGlobal('crypto', webcrypto);
    window.history.replaceState({}, '', '/account/security');
    const records = new Map<string, any>([['users/user-a', { status: 'active' }], ['users/user-b', { status: 'active' }]]);
    const snapshot = (path: string) => ({ exists: records.has(path), data: () => records.get(path) });
    const db = { doc: (path: string) => ({ path, get: async () => snapshot(path), set: async (value: any) => records.set(path, value) }), runTransaction: async (task: any) => task({ get: async ({ path }: any) => snapshot(path), set: ({ path }: any, value: any) => records.set(path, value), update: ({ path }: any, value: any) => records.set(path, { ...records.get(path), ...value }) }) };
    state.commands = createRegistryRecoveryCommands({ db, projectId: 'registry-test', auth: { getUser: async (uid: string) => ({ uid, disabled: false }), createCustomToken: vi.fn() } });
    state.context = { uid: 'user-a', token: { auth_time: Date.now() / 1000 } };
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const kitA = { format: 'cartularia-registry-recovery@1.0.0', projectId: 'registry-test', ownerUid: 'user-a', credentialId: crypto.randomUUID(), createdAt: new Date().toISOString(), signingPrivateKeyJwk: await crypto.subtle.exportKey('jwk', keys.privateKey), signingPublicKeyJwk: await crypto.subtle.exportKey('jwk', keys.publicKey) };
    render(<RegistryRecoveryPage />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Préparer le kit' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Préparer le kit' }));
    await act(async () => { state.auth.currentUser = { uid: 'user-b' }; state.context = { uid: 'user-b', token: { auth_time: Date.now() / 1000 } }; state.observer(state.auth.currentUser); });
    await act(async () => state.finishGeneration(kitA));
    expect(screen.queryByRole('button', { name: 'Télécharger le kit secret' })).toBeNull();
    expect(records.has('registryRecovery/user-b')).toBe(false);
    expect(records.has('registryRecovery/user-a')).toBe(false);
    expect(screen.getByRole('alert').textContent).toContain('session a changé');
    fireEvent.click(screen.getByRole('button', { name: 'Préparer le kit' }));
    const kitB = { ...kitA, ownerUid: 'user-b', credentialId: crypto.randomUUID() };
    await act(async () => state.finishGeneration(kitB));
    fireEvent.click(screen.getByRole('button', { name: 'Télécharger le kit secret' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '2. Activer ce kit' }));
    await screen.findByText('Kit activé et vérifié. Tout kit précédent a été remplacé.');
    expect(state.downloaded.ownerUid).toBe('user-b');
    expect(records.get('registryRecovery/user-b').credentialId).toBe(kitB.credentialId);
    await expect(state.commands.begin({ ownerUid: kitA.ownerUid, credentialId: kitA.credentialId })).rejects.toMatchObject({ code: 'permission-denied' });
    vi.unstubAllGlobals();
  });
});
