import { signInWithCustomToken, updatePassword, type User } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../firebase';

export interface RegistryRecoveryKit {
  format: 'cartularia-registry-recovery@1.0.0';
  projectId: string;
  ownerUid: string;
  credentialId: string;
  createdAt: string;
  signingPrivateKeyJwk: JsonWebKey;
  signingPublicKeyJwk: JsonWebKey;
}
export type RecoveryStatus = { active: boolean; credentialId?: string; createdAt?: string };

const call = async <T>(name: string, data: unknown = {}) => (await httpsCallable<unknown, T>(functions, name)(data)).data;
export const loadRegistryRecoveryStatus = () => call<RecoveryStatus>('getRegistryRecoveryStatus');
export const revokeRegistryRecoveryKit = () => call<{ revoked: boolean }>('revokeRegistryRecovery');

export const createRegistryRecoveryKit = async (user: User): Promise<RegistryRecoveryKit> => {
  const projectId = auth.app.options.projectId;
  const assertSession = () => {
    if (!projectId || auth.currentUser?.uid !== user.uid || auth.app.options.projectId !== projectId) throw Object.assign(new Error('La session a changé. Préparez un nouveau kit pour le compte affiché.'), { code: 'recovery-session-changed' });
  };
  assertSession();
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const kit: RegistryRecoveryKit = {
    format: 'cartularia-registry-recovery@1.0.0', projectId: projectId!, ownerUid: user.uid,
    credentialId: crypto.randomUUID(), createdAt: new Date().toISOString(),
    signingPrivateKeyJwk: await crypto.subtle.exportKey('jwk', keys.privateKey),
    signingPublicKeyJwk: await crypto.subtle.exportKey('jwk', keys.publicKey),
  };
  assertSession();
  return kit;
};
export const activateRegistryRecoveryKit = async (kit: RegistryRecoveryKit) => {
  if (kit.ownerUid !== auth.currentUser?.uid || !kit.projectId || kit.projectId !== auth.app.options.projectId) {
    throw Object.assign(new Error('Ce kit appartient à un autre compte ou projet. Préparez un nouveau kit pour le compte affiché.'), { code: 'recovery-session-changed' });
  }
  return call<RecoveryStatus>('enrollRegistryRecovery', {
    ownerUid: kit.ownerUid, projectId: kit.projectId,
    credentialId: kit.credentialId, signingPublicKeyJwk: kit.signingPublicKeyJwk,
  });
};
export const downloadRegistryRecoveryKit = (kit: RegistryRecoveryKit) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(kit, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `cartularia-secours-registre-${kit.credentialId}.json`;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export const parseRegistryRecoveryKit = (value: string): RegistryRecoveryKit => {
  if (value.length > 32_768) throw new Error('Fichier de secours invalide.');
  const kit = JSON.parse(value) as RegistryRecoveryKit;
  if (kit.format !== 'cartularia-registry-recovery@1.0.0'
    || kit.projectId !== auth.app.options.projectId
    || !/^[A-Za-z0-9_-]{1,128}$/.test(kit.ownerUid || '')
    || !/^[a-f0-9-]{36}$/.test(kit.credentialId || '')
    || kit.signingPrivateKeyJwk?.kty !== 'EC' || kit.signingPrivateKeyJwk?.crv !== 'P-256'
    || !/^[A-Za-z0-9_-]{43}$/.test(kit.signingPrivateKeyJwk?.d || '')) throw new Error('Ce fichier n’est pas un kit de secours de ce Registre.');
  return kit;
};
export const recoverRegistrySession = async (kit: RegistryRecoveryKit) => {
  const input = { ownerUid: kit.ownerUid, credentialId: kit.credentialId };
  const challenge = await call<{ challengeId: string; message: string; expiresAt: string }>('beginRegistryRecovery', input);
  const expiresAt = new Date(challenge.expiresAt).getTime();
  const expectedPrefix = ['cartularia-recovery-v1', 'registry', kit.ownerUid, kit.credentialId, challenge.challengeId, String(expiresAt), ''].join('\n');
  if (!/^[a-f0-9-]{36}$/.test(challenge.challengeId || '') || typeof challenge.message !== 'string'
    || challenge.message.length > 2048 || !challenge.message.startsWith(expectedPrefix)
    || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 10 * 60_000) throw new Error('La demande de secours est invalide ou expirée.');
  const key = await crypto.subtle.importKey('jwk', kit.signingPrivateKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(challenge.message));
  const signature = btoa(String.fromCharCode(...new Uint8Array(signed)));
  const result = await call<{ registryToken: string }>('completeRegistryRecovery', { ...input, challengeId: challenge.challengeId, signature });
  const credential = await signInWithCustomToken(auth, result.registryToken);
  if (credential.user.uid !== kit.ownerUid) throw new Error('La session ne correspond pas au kit.');
  return credential.user;
};
export const changeRecoveredRegistryPassword = async (password: string) => {
  if (!auth.currentUser || password.length < 12) throw new Error('Choisissez un mot de passe d’au moins 12 caractères.');
  await updatePassword(auth.currentUser, password);
};
