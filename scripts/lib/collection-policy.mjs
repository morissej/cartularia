export const registryCollectionVersion = (value) => {
  if (typeof value?.versionToken === 'string' && value.versionToken) return value.versionToken;
  const timestamp = value?.updatedAt;
  return Number.isInteger(timestamp?.seconds) && Number.isInteger(timestamp?.nanoseconds)
    ? `legacy:${timestamp.seconds}:${timestamp.nanoseconds}` : 'legacy:unversioned';
};

export const COLLECTION_SLUG_MAX_LENGTH = 64;

// Même règle que `normalizeCollectionSlug` dans src/domain/collections.ts : troncature sur une
// frontière de mot, jamais de `-` final (défaut D5 de l'audit du 2026-09-08).
export const normalizeCollectionWebsiteSlug = (value) => {
  const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (normalized.length <= COLLECTION_SLUG_MAX_LENGTH) return normalized || 'collection';
  const cut = normalized.slice(0, COLLECTION_SLUG_MAX_LENGTH);
  if (normalized[COLLECTION_SLUG_MAX_LENGTH] === '-') return cut;
  const boundary = cut.lastIndexOf('-');
  return (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/-+$/g, '') || 'collection';
};
