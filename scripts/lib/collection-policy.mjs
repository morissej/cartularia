export const registryCollectionVersion = (value) => {
  if (typeof value?.versionToken === 'string' && value.versionToken) return value.versionToken;
  const timestamp = value?.updatedAt;
  return Number.isInteger(timestamp?.seconds) && Number.isInteger(timestamp?.nanoseconds)
    ? `legacy:${timestamp.seconds}:${timestamp.nanoseconds}` : 'legacy:unversioned';
};

export const normalizeCollectionWebsiteSlug = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'collection';
