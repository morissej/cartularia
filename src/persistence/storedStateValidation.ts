export interface StoredStateReader {
  getItem(key: string): string | null;
}

export type StoredStateRepairReason = 'invalid-json' | 'invalid-shape';

export interface StoredStateRepair {
  key: string;
  reason: StoredStateRepairReason;
}

type UnknownRecord = Record<string, unknown>;
type Normalizer = (value: unknown, fallback: unknown) => unknown;

const asRecord = (value: unknown): UnknownRecord | null => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null
);

const stringValue: Normalizer = (value, fallback) => (
  typeof value === 'string' ? value : typeof fallback === 'string' ? fallback : ''
);

const optionalString: Normalizer = (value, fallback) => (
  value === undefined || value === null
    ? (typeof fallback === 'string' || fallback === null ? fallback : undefined)
    : typeof value === 'string' ? value : fallback === null ? null : undefined
);

const booleanValue: Normalizer = (value, fallback) => (
  typeof value === 'boolean' ? value : typeof fallback === 'boolean' ? fallback : false
);

const nonNegativeNumber: Normalizer = (value, fallback) => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : typeof fallback === 'number' && Number.isFinite(fallback) && fallback >= 0 ? fallback : 0
);

const nullableFiniteNumber: Normalizer = (value, fallback) => {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback === null || (typeof fallback === 'number' && Number.isFinite(fallback)) ? fallback : null;
};

const enumValue = (values: readonly string[]): Normalizer => (value, fallback) => (
  typeof value === 'string' && values.includes(value)
    ? value
    : typeof fallback === 'string' && values.includes(fallback) ? fallback : values[0]
);

const optionalEnumValue = (values: readonly string[]): Normalizer => (value, fallback) => (
  value === undefined || value === null
    ? (typeof fallback === 'string' && values.includes(fallback) ? fallback : undefined)
    : typeof value === 'string' && values.includes(value) ? value : undefined
);

const arrayValue = (itemNormalizer: Normalizer): Normalizer => (value, fallback) => {
  if (!Array.isArray(value)) return Array.isArray(fallback) ? fallback : [];
  const normalized = value.flatMap((item, index) => {
    const itemRecord = asRecord(item);
    const fallbackItem = Array.isArray(fallback) && itemRecord && typeof itemRecord.id === 'string'
      ? fallback.find((candidate) => asRecord(candidate)?.id === itemRecord.id)
      : Array.isArray(fallback) ? fallback[index] : undefined;
    const result = itemNormalizer(item, fallbackItem);
    return result === null || result === undefined ? [] : [result];
  });
  return normalized;
};

const stringArray = arrayValue((value) => typeof value === 'string' ? value : null);
const nonNegativeNumberList = arrayValue((value) => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
));
const recordArray = arrayValue((value) => asRecord(value));

const objectValue = (fields: Record<string, Normalizer>): Normalizer => (value, fallback) => {
  const source = asRecord(value);
  if (!source) return fallback;
  const fallbackRecord = asRecord(fallback) ?? {};
  const normalized: UnknownRecord = { ...source };
  Object.entries(fields).forEach(([field, normalize]) => {
    const normalizedField = normalize(source[field], fallbackRecord[field]);
    if (normalizedField === undefined) delete normalized[field];
    else normalized[field] = normalizedField;
  });
  return normalized;
};

const partialObjectValue = (fields: Record<string, Normalizer>): Normalizer => (value, fallback) => {
  const source = asRecord(value);
  if (!source) return fallback;
  const fallbackRecord = asRecord(fallback) ?? {};
  const normalized: UnknownRecord = { ...source };
  Object.entries(fields).forEach(([field, normalize]) => {
    if (Object.hasOwn(source, field) || Object.hasOwn(fallbackRecord, field)) {
      const normalizedField = normalize(source[field], fallbackRecord[field]);
      if (normalizedField === undefined) delete normalized[field];
      else normalized[field] = normalizedField;
    }
  });
  return normalized;
};

const identifiedObject = (fields: Record<string, Normalizer>, idField = 'id'): Normalizer => {
  const normalizeObject = objectValue(fields);
  return (value, fallback) => {
    const source = asRecord(value);
    if (!source || typeof source[idField] !== 'string' || source[idField].trim().length === 0) return null;
    return normalizeObject(value, fallback);
  };
};

const stringRecord: Normalizer = (value, fallback) => {
  const source = asRecord(value);
  if (!source) return fallback;
  return Object.fromEntries(Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
};

const optionalBinaryFields = {
  id: optionalString,
  name: stringValue,
  size: nonNegativeNumber,
  type: optionalString,
  url: optionalString,
  binaryId: optionalString,
  sha256: optionalString,
};

const conditionAttachment = objectValue(optionalBinaryFields);
const conditionEntry = identifiedObject({
  id: stringValue,
  date: stringValue,
  title: stringValue,
  note: stringValue,
  attachments: arrayValue(conditionAttachment),
});

const normalizedMediaObject = identifiedObject({
  id: stringValue,
  name: stringValue,
  url: stringValue,
  thumbnailUrl: optionalString,
  type: enumValue(['image', 'video', 'document']),
  ratio: optionalEnumValue(['3:4', '4:5', '16:9']),
  hash: stringValue,
  status: enumValue(['Archived', 'Initiated', 'Uploading', 'Quarantine', 'Processing', 'Failed', 'Deleted']),
  visibility: enumValue(['Secret', 'Communauté', 'Tous']),
  tags: stringArray,
  category: optionalString,
  posterUrl: optionalString,
  description: optionalString,
  capturedAt: optionalString,
  duration: optionalString,
  fileSize: optionalString,
  mimeType: optionalString,
  originalFileName: optionalString,
  metadataTimestamp: optionalString,
  timestampSource: optionalString,
  binaryId: optionalString,
  localAvailability: optionalString,
  cloudStoragePath: optionalString,
  derivativeStatus: optionalString,
});

const mediaAsset: Normalizer = (value, fallback) => {
  const source = asRecord(value);
  if (!source || !['image', 'video', 'document'].includes(String(source.type))) return null;
  return normalizedMediaObject(value, fallback);
};

const normalizedValuation = identifiedObject({
  id: stringValue,
  date: stringValue,
  lowValue: nonNegativeNumber,
  midValue: nonNegativeNumber,
  highValue: nonNegativeNumber,
  currency: stringValue,
  confidence: enumValue(['Faible', 'Moyenne', 'Forte']),
  source: stringValue,
  visibility: enumValue(['Secret', 'Communauté', 'Tous']),
});

const valuation: Normalizer = (value, fallback) => {
  const source = asRecord(value);
  if (
    !source
    || !['lowValue', 'midValue', 'highValue'].every((field) => (
      typeof source[field] === 'number' && Number.isFinite(source[field]) && Number(source[field]) >= 0
    ))
  ) return null;
  return normalizedValuation(value, fallback);
};

const normalizedComparable = identifiedObject({
  id: stringValue,
  date: stringValue,
  channel: stringValue,
  description: stringValue,
  amount: nonNegativeNumber,
  currency: stringValue,
  condition: stringValue,
  sourceType: enumValue(['Estimation', 'Transaction', 'Annonce']),
  source: stringValue,
  saleChannel: enumValue(['Annonce', 'Enchère', 'Vente privée', 'Marchand']),
});

const comparable: Normalizer = (value, fallback) => {
  const source = asRecord(value);
  if (!source || typeof source.amount !== 'number' || !Number.isFinite(source.amount) || source.amount < 0) return null;
  return normalizedComparable(value, fallback);
};

const normalizedPublicationDecision = identifiedObject({
  requestId: stringValue,
  destination: enumValue(['website', 'report', 'community']),
  blockId: stringValue,
  blockLabel: stringValue,
  action: enumValue(['activate', 'validate', 'revoke']),
  status: enumValue(['confirmed']),
  decisionSource: enumValue(['human_confirmed']),
  decidedAt: stringValue,
  sourceRevision: nonNegativeNumber,
  sourceDigest: stringValue,
  policyVersion: stringValue,
  prerequisites: recordArray,
}, 'requestId');

const publicationDecision: Normalizer = (value, fallback) => {
  const source = asRecord(value);
  if (
    !source
    || !['website', 'report', 'community'].includes(String(source.destination))
    || !['activate', 'validate', 'revoke'].includes(String(source.action))
    || source.status !== 'confirmed'
    || source.decisionSource !== 'human_confirmed'
    || !Array.isArray(source.prerequisites)
  ) return null;
  return normalizedPublicationDecision(value, fallback);
};

const editableCopy = partialObjectValue({
  heroSummary: stringValue,
  originParagraphs: stringArray,
  originKnowledge: stringValue,
  watchDescription: stringArray,
  conditionSummary: stringArray,
  conditionFacts: partialObjectValue({
    lastCondition: stringValue,
    conclusion: stringValue,
    openPoint: stringValue,
  }),
});

const KEY_NORMALIZERS: Record<string, Normalizer> = {
  'cartularia-interface-language': enumValue(['FR', 'EN']),
  'cartularia-audience': enumValue(['Secret', 'Communauté', 'Tous']),
  'cartularia-public-code': optionalString,
  'cartularia-identification-checks': arrayValue(identifiedObject({
    id: stringValue,
    title: stringValue,
    note: stringValue,
    checked: booleanValue,
  })),
  'cartularia-condition-entries': arrayValue(conditionEntry),
  'cartularia-documentation-items': arrayValue(identifiedObject({
    id: stringValue,
    category: stringValue,
    description: stringValue,
    state: enumValue(['À vérifier', 'Présent', 'Complet', 'Incomplet', 'Manquant']),
  })),
  'cartularia-owner-fields': arrayValue(identifiedObject({ id: stringValue, label: stringValue, value: stringValue })),
  'cartularia-owner-type': enumValue(['Personne physique', 'Entreprise']),
  'cartularia-owner-documents': arrayValue(identifiedObject({
    id: stringValue,
    category: stringValue,
    fileName: stringValue,
    size: nonNegativeNumber,
    type: stringValue,
    url: optionalString,
    binaryId: optionalString,
    sha256: optionalString,
  })),
  'cartularia-ownership-history': recordArray,
  'cartularia-asset-kind': enumValue(['Montre', 'Voiture', 'Vin', 'Sculpture', 'Peinture', 'Photographie', 'Meuble', 'Autre art', 'Bien immobilier', 'Autre']),
  'cartularia-watch-status': enumValue(['Patrimonial', 'À vendre', 'Ouvert à proposition']),
  'cartularia-transmission-recipients': arrayValue(identifiedObject({
    id: stringValue,
    firstName: stringValue,
    lastName: stringValue,
    address: stringValue,
    email: stringValue,
    phone: stringValue,
    percentage: (value, fallback) => value === '' ? '' : nonNegativeNumber(value, fallback),
  })),
  'cartularia-storage-locations': arrayValue(identifiedObject({
    id: stringValue,
    name: stringValue,
    contents: stringValue,
    description: stringValue,
  })),
  'cartularia-storage-description': stringValue,
  'cartularia-market-depth': partialObjectValue({
    analysisDate: stringValue,
    activeListings: nonNegativeNumber,
    transactions12m: nonNegativeNumber,
    medianDaysOnMarket: nonNegativeNumber,
    lowValue: nonNegativeNumber,
    midValue: nonNegativeNumber,
    highValue: nonNegativeNumber,
  }),
  'cartularia-market-history': arrayValue(valuation),
  'cartularia-comparables': arrayValue(comparable),
  'cartularia-comparable-analysis': arrayValue(identifiedObject({
    id: stringValue,
    angle: stringValue,
    finding: stringValue,
    reading: stringValue,
  })),
  'cartularia-sensitivity-prices': nonNegativeNumberList,
  'cartularia-sensitivity-costs': nonNegativeNumberList,
  'cartularia-retained-valuation': objectValue({ amount: nonNegativeNumber, explanation: stringValue }),
  'cartularia-popularity-resources': arrayValue(identifiedObject({
    id: stringValue,
    name: stringValue,
    type: enumValue(['Forum officiel', 'Discussion dédiée', 'Communauté', 'Base de données', 'Revue']),
    url: stringValue,
  })),
  'cartularia-published-blocks': stringArray,
  'cartularia-report-blocks': stringArray,
  'cartularia-community-blocks': stringArray,
  'cartularia-publication-decisions-v1': arrayValue(publicationDecision),
  'cartularia-publication-source-v1': objectValue({
    revision: nonNegativeNumber,
    digest: stringValue,
    updatedAt: stringValue,
  }),
  'cartularia-specification-groups': arrayValue(identifiedObject({
    id: stringValue,
    title: stringValue,
    items: arrayValue(identifiedObject({ id: stringValue, label: stringValue, value: stringValue })),
  })),
  'cartularia-basic-watch-data': stringRecord,
  'cartularia-editable-copy': editableCopy,
  'cartularia-purchase': objectValue({ date: stringValue, purchasePrice: nonNegativeNumber }),
  'cartularia-purchase-expenses': arrayValue(identifiedObject({
    id: stringValue,
    kind: enumValue(['Révision', 'Assurance', 'Coûts de conservation', 'Autre']),
    date: stringValue,
    label: stringValue,
    amount: nonNegativeNumber,
  })),
  'cartularia-exit-assumptions': objectValue({
    saleDate: stringValue,
    salePrice: nonNegativeNumber,
    disposalCostPct: nonNegativeNumber,
  }),
  'cartularia-media-assets-v3': arrayValue(mediaAsset),
  'cartularia-media-tags-v2': arrayValue(identifiedObject({ id: stringValue, tags: stringArray })),
};

const stableJson = (value: unknown) => JSON.stringify(value);

export const normalizeCartularyStoredValue = <T,>(key: string, value: unknown, fallback: T) => {
  const normalizer = KEY_NORMALIZERS[key];
  const normalized = normalizer
    ? normalizer(value, fallback)
    : typeof value === typeof fallback ? value : fallback;
  return {
    value: normalized as T,
    repaired: stableJson(normalized) !== stableJson(value),
  };
};

export const readValidatedStoredJson = <T,>({
  storage,
  key,
  fallback,
  onRepair,
}: {
  storage: StoredStateReader | null | undefined;
  key: string;
  fallback: T;
  onRepair?: (repair: StoredStateRepair) => void;
}): T => {
  const raw = storage?.getItem(key);
  if (raw === null || raw === undefined) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    onRepair?.({ key, reason: 'invalid-json' });
    return fallback;
  }
  const normalized = normalizeCartularyStoredValue(key, parsed, fallback);
  if (normalized.repaired) onRepair?.({ key, reason: 'invalid-shape' });
  return normalized.value;
};

export const normalizeWatchCreationProfile = (value: unknown) => {
  const source = asRecord(value);
  if (!source) return null;
  const requiredStrings = ['collectionId', 'brand', 'model', 'reference', 'serialNumber', 'caliber', 'description', 'conditionSummary', 'purchaseDate', 'currency', 'seller', 'valuationDate', 'sourceLabel', 'assertedAt'];
  if (requiredStrings.some((field) => typeof source[field] !== 'string')) return null;
  if (source.profileVersion !== '1.0.0' || source.assetType !== 'watch' || source.schemaId !== 'watch' || source.schemaVersion !== '1.5.0') return null;
  return {
    ...source,
    manufactureYear: nullableFiniteNumber(source.manufactureYear, null),
    purchasePrice: nullableFiniteNumber(source.purchasePrice, null),
    valuationLow: nullableFiniteNumber(source.valuationLow, null),
    valuationMid: nullableFiniteNumber(source.valuationMid, null),
    valuationHigh: nullableFiniteNumber(source.valuationHigh, null),
  };
};
