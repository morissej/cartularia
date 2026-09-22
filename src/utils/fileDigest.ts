/**
 * Empreinte SHA-256 d'un fichier, en hexadécimal minuscule (64 caractères, sans préfixe `sha256:`).
 * Déplacée depuis `App.tsx` (V5 P-D3) ; `globalThis.crypto` remplace `window.crypto` (identique en navigateur,
 * disponible sous vitest/jsdom comme dans `auditChain.ts`).
 */
export const digestFile = async (file: File) => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
