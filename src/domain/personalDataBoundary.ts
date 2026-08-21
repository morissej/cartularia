export const PERSONAL_DATA_BOUNDARY_VERSION = 'personal-data-boundary-v1' as const;

/**
 * Historical Cartulaire keys that contain direct personal data. They belong in
 * the dedicated encrypted Personal Vault and must never be synchronized to the
 * Registry Firebase project again.
 */
export const REGISTRY_FORBIDDEN_STATE_KEYS = new Set([
  'cartularia-owner-fields',
  'cartularia-owner-type',
  'cartularia-owner-documents',
  'cartularia-transmission-recipients',
  'cartularia-storage-locations',
  'cartularia-storage-description',
]);

export const isRegistrySafeStateKey = (key: string) => !REGISTRY_FORBIDDEN_STATE_KEYS.has(key);

export const isRegistrySafeBinaryKind = (kind: string) => kind !== 'owner_document';

export interface RegistryPrivacyLink {
  userAlias: string;
  objectCode: string;
}

export interface StorageCodeReference {
  id: string;
  correspondenceCode: string;
  codeName: string;
  note: string;
}

export interface TransmissionCodeReference {
  id: string;
  correspondenceCode: string;
  codeName: string;
  note: string;
}

const collapseWhitespace = (value: string) => value.trim().replace(/\s+/g, ' ');

export const normalizeUserAlias = (value: string) => collapseWhitespace(value).slice(0, 64);

export const normalizeObjectCode = (value: string) => (
  value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 64)
);

export const normalizeStorageCodeName = (value: string) => collapseWhitespace(value).slice(0, 80);

const normalizePseudonymousReferences = (value: unknown) => (Array.isArray(value) ? value : [])
  .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
  .map((item, index) => ({
    id: typeof item.id === 'string' && item.id ? item.id : `reference-${index + 1}`,
    correspondenceCode: typeof item.correspondenceCode === 'string' ? item.correspondenceCode : '',
    codeName: typeof item.codeName === 'string' ? normalizeStorageCodeName(item.codeName) : '',
    note: typeof item.note === 'string' ? item.note.slice(0, 500) : '',
  }));

export const normalizeStorageCodeReferences = (value: unknown): StorageCodeReference[] => normalizePseudonymousReferences(value);
export const normalizeTransmissionCodeReferences = (value: unknown): TransmissionCodeReference[] => normalizePseudonymousReferences(value);

export const registryPrivacyLinkIsComplete = (link: RegistryPrivacyLink) => (
  normalizeUserAlias(link.userAlias).length >= 3
  && normalizeObjectCode(link.objectCode).length >= 6
);
