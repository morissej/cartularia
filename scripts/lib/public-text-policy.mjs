// Shared by the public-draft preview and the authoritative server validator.
// This conservative content filter complements the publication field allowlist;
// it is not a substitute for explicit, object-by-object publication consent.
const PRIVATE_TOKENS = Object.freeze([
  'owner', 'propriétaire', 'proprietaire', 'transmission', 'beneficiary',
  'bénéficiaire', 'beneficiaire', 'storage', 'stockage', 'serial', 'série',
  'address', 'adresse', 'email', 'phone', 'téléphone', 'telephone',
  'acquisition', 'purchaseprice', 'costbasis', '/private/', 'media-vault',
  'documenturl', 'downloadurl',
]);
const compact = (value) => value.toLocaleLowerCase('fr-FR').replaceAll(/[\s_-]/g, '');

export function findPrivatePublicTextToken(value) {
  if (typeof value !== 'string') return null;
  const text = compact(value);
  const token = PRIVATE_TOKENS.find((candidate) => text.includes(compact(candidate)));
  if (token) return token;
  // “Cadran original” describes the object. Technical references to source
  // files remain private, whether they are keys, paths or embedded URLs.
  if (/original(?:url|path|file|binary|download|storage|object|asset|hash|mime)/i.test(text)
    || /(?:url|path|file|binary|download|storage|object|asset|hash|mime)original/i.test(text)
    || /(?:https?:\/\/|gs:\/\/|blob:|(?:^|\s)[./])\S*original/i.test(value)
    || /originals?[/\\]/i.test(value)) return 'original';
  return null;
}

export function findPrivatePublicKeyToken(value) {
  const text = compact(value).replaceAll(/[^a-z0-9à-ÿ/]/g, '');
  return text.includes('original') ? 'original' : findPrivatePublicTextToken(text);
}
