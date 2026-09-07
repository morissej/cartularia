import { vaultAccountDocumentId } from './crypto.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export interface PersonalRecoveryKit {
  schemaVersion: 'personal-vault-recovery-kit@1.0.0';
  credentialId: string;
  personalUid: string;
  personalProjectId: string;
  userAlias: string;
  accountId: string;
  createdAt: string;
  signingPrivateKey: string;
  wrappingPrivateKey: string;
  signingPublicKeyJwk: JsonWebKey;
  wrappingPublicKeyJwk: JsonWebKey;
}

const encode = (bytes: Uint8Array) => {
  let result = '';
  bytes.forEach((byte) => { result += String.fromCharCode(byte); });
  return btoa(result);
};
const decode = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

export const createPersonalRecoveryKit = async ({ personalUid, personalProjectId, userAlias }: {
  personalUid: string; personalProjectId: string; userAlias: string;
}): Promise<PersonalRecoveryKit> => {
  const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const wrapping = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  return {
    schemaVersion: 'personal-vault-recovery-kit@1.0.0', credentialId: crypto.randomUUID(),
    personalUid, personalProjectId, userAlias, accountId: await vaultAccountDocumentId(userAlias),
    createdAt: new Date().toISOString(),
    signingPrivateKey: encode(new Uint8Array(await crypto.subtle.exportKey('pkcs8', signing.privateKey))),
    wrappingPrivateKey: encode(new Uint8Array(await crypto.subtle.exportKey('pkcs8', wrapping.privateKey))),
    signingPublicKeyJwk: await crypto.subtle.exportKey('jwk', signing.publicKey),
    wrappingPublicKeyJwk: await crypto.subtle.exportKey('jwk', wrapping.publicKey),
  };
};

/** Hybrid encryption avoids a password-length restriction from RSA-OAEP's input limit. */
export const wrapRecoveryPassword = async (password: string, wrappingPublicKeyJwk: JsonWebKey, credentialId: string) => {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const rsa = await crypto.subtle.importKey('jwk', wrappingPublicKeyJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(credentialId) }, key, encoder.encode(password));
  const wrappedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP', label: encoder.encode(credentialId) }, rsa, await crypto.subtle.exportKey('raw', key));
  return encode(encoder.encode(JSON.stringify({
    version: 1, iv: encode(iv), wrappedKey: encode(new Uint8Array(wrappedKey)), ciphertext: encode(new Uint8Array(ciphertext)),
  })));
};

export const unwrapRecoveryPassword = async (wrappedPassword: string, kit: PersonalRecoveryKit) => {
  if (wrappedPassword.length > 16_384) throw new Error('Enveloppe de secours invalide.');
  const envelope = JSON.parse(decoder.decode(decode(wrappedPassword))) as { version: number; iv: string; wrappedKey: string; ciphertext: string };
  if (envelope.version !== 1 || typeof envelope.iv !== 'string' || typeof envelope.wrappedKey !== 'string' || typeof envelope.ciphertext !== 'string') throw new Error('Enveloppe de secours invalide.');
  const rsa = await crypto.subtle.importKey('pkcs8', decode(kit.wrappingPrivateKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
  const rawKey = await crypto.subtle.decrypt({ name: 'RSA-OAEP', label: encoder.encode(kit.credentialId) }, rsa, decode(envelope.wrappedKey));
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.iv), additionalData: encoder.encode(kit.credentialId) }, key, decode(envelope.ciphertext));
  return decoder.decode(plaintext);
};

export const signRecoveryChallenge = async (kit: PersonalRecoveryKit, message: string) => {
  if (message.length > 2048) throw new Error('Demande de secours invalide.');
  const key = await crypto.subtle.importKey('pkcs8', decode(kit.signingPrivateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(message));
  return encode(new Uint8Array(signature));
};

export const parsePersonalRecoveryKit = async (text: string, expectedProjectId: string): Promise<PersonalRecoveryKit> => {
  if (text.length > 32_768) throw new Error('Fichier de secours trop volumineux.');
  const kit = JSON.parse(text) as PersonalRecoveryKit;
  if (kit.schemaVersion !== 'personal-vault-recovery-kit@1.0.0'
    || kit.personalProjectId !== expectedProjectId
    || !/^[a-f0-9-]{36}$/.test(kit.credentialId || '')
    || !/^[A-Za-z0-9_-]{1,128}$/.test(kit.personalUid || '')
    || typeof kit.userAlias !== 'string' || kit.userAlias.length < 3 || kit.userAlias.length > 64
    || typeof kit.signingPrivateKey !== 'string' || typeof kit.wrappingPrivateKey !== 'string'
    || kit.accountId !== await vaultAccountDocumentId(kit.userAlias)) throw new Error('Ce fichier n’est pas un kit valide pour ce Coffre.');
  // Validate both key pairs before making any network request or replacing a working kit.
  const probe = `cartularia-kit-validation:${crypto.randomUUID()}`;
  const signature = await signRecoveryChallenge(kit, probe);
  const publicKey = await crypto.subtle.importKey('jwk', kit.signingPublicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, decode(signature), encoder.encode(probe))) throw new Error('Clés de secours incohérentes.');
  if (await unwrapRecoveryPassword(await wrapRecoveryPassword(probe, kit.wrappingPublicKeyJwk, kit.credentialId), kit) !== probe) throw new Error('Clés de secours incohérentes.');
  return kit;
};
