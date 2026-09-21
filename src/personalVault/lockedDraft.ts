import { decryptPersonalPayload, encryptPersonalPayload, type EncryptedPersonalEnvelope } from './crypto';
import type { PersonalVaultPayload } from './types';

const prefix = 'cartularia:personal-vault:locked-draft:v1:';
const envelopes = new Map<string, EncryptedPersonalEnvelope>();
const pending = new Map<string, Promise<boolean>>();

/** The UID is storage metadata; the draft and its identity binding are authenticated ciphertext. */
export function preserveLockedVaultDraft(uid: string, password: string, payload: PersonalVaultPayload) {
  const protectPendingEncryption = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
  window.addEventListener('beforeunload', protectPendingEncryption);
  const previous = pending.get(uid);
  const operation = (async () => {
    // Serialize locks for an identity so a slow older encryption cannot replace its newer draft.
    await previous?.catch(() => undefined);
    const envelope = await encryptPersonalPayload({ payload: { uid, payload }, password, userAlias: payload.userName });
    envelopes.set(uid, envelope);
    try { localStorage.setItem(prefix + uid, JSON.stringify(envelope)); return true; }
    catch { return false; } // Retain only ciphertext in memory when storage is unavailable/full.
  })();
  pending.set(uid, operation);
  void operation.finally(() => { window.removeEventListener('beforeunload', protectPendingEncryption); if (pending.get(uid) === operation) pending.delete(uid); }).catch(() => undefined);
  return operation;
}

export async function readLockedVaultDraft(uid: string, password: string, userAlias: string) {
  await pending.get(uid);
  const stored = envelopes.get(uid) || (() => {
    const value = localStorage.getItem(prefix + uid);
    return value ? JSON.parse(value) as EncryptedPersonalEnvelope : null;
  })();
  if (!stored) return null;
  const result = await decryptPersonalPayload<{ uid: string; payload: PersonalVaultPayload }>({ envelope: stored, password, userAlias });
  if (result.uid !== uid || result.payload.userName.trim().toLocaleLowerCase('fr') !== userAlias.trim().toLocaleLowerCase('fr')) {
    throw new Error('Brouillon du Coffre associé à une autre identité.');
  }
  return result.payload;
}

export function forgetLockedVaultDraft(uid: string) {
  envelopes.delete(uid);
  localStorage.removeItem(prefix + uid);
}
