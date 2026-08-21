const ENCRYPTION_VERSION = 2 as const;
const PBKDF2_ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface EncryptedPersonalEnvelope {
  version: typeof ENCRYPTION_VERSION;
  algorithm: 'AES-GCM';
  keyDerivation: 'PBKDF2-SHA-256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};

const base64ToBytes = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const deriveKey = async (secret: string, salt: Uint8Array, iterations: number) => {
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: salt as BufferSource,
    iterations,
  }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
};

const encryptionContext = (userAlias: string) => (
  `cartularia-personal-account-v2\u0000${userAlias.trim().toLocaleLowerCase('fr')}`
);

export const encryptPersonalPayload = async <T,>({
  payload,
  password,
  userAlias,
}: {
  payload: T;
  password: string;
  userAlias: string;
}): Promise<EncryptedPersonalEnvelope> => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const context = encryptionContext(userAlias);
  const key = await deriveKey(`${password}\u0000${context}`, salt, PBKDF2_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: encoder.encode(context),
  }, key, encoder.encode(JSON.stringify(payload)));
  return {
    version: ENCRYPTION_VERSION,
    algorithm: 'AES-GCM',
    keyDerivation: 'PBKDF2-SHA-256',
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
};

export const decryptPersonalPayload = async <T,>({
  envelope,
  password,
  userAlias,
}: {
  envelope: EncryptedPersonalEnvelope;
  password: string;
  userAlias: string;
}): Promise<T> => {
  if (
    envelope.version !== ENCRYPTION_VERSION
    || envelope.algorithm !== 'AES-GCM'
    || envelope.keyDerivation !== 'PBKDF2-SHA-256'
    || !Number.isInteger(envelope.iterations)
    || envelope.iterations < PBKDF2_ITERATIONS
  ) throw new Error('Format chiffré non pris en charge.');
  const context = encryptionContext(userAlias);
  const salt = base64ToBytes(envelope.salt);
  const key = await deriveKey(`${password}\u0000${context}`, salt, envelope.iterations);
  const plaintext = await crypto.subtle.decrypt({
    name: 'AES-GCM',
    iv: base64ToBytes(envelope.iv),
    additionalData: encoder.encode(context),
  }, key, base64ToBytes(envelope.ciphertext));
  return JSON.parse(decoder.decode(plaintext)) as T;
};

export const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const vaultAccountDocumentId = (userAlias: string) => (
  sha256Hex(`account\u0000${userAlias.trim().toLocaleLowerCase('fr')}`)
);

export const vaultAuthenticationEmail = async (userAlias: string) => (
  `${await sha256Hex(`alias\u0000${userAlias.trim().toLocaleLowerCase('fr')}`)}@access.cartularia.invalid`
);
