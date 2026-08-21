export type CorrespondenceCodeKind = 'client' | 'object' | 'transmission' | 'location' | 'manager' | 'person';

const PREFIXES: Record<CorrespondenceCodeKind, string> = {
  client: 'CLI',
  object: 'OBJ',
  transmission: 'TRN',
  location: 'LIE',
  manager: 'GES',
  person: 'PER',
};

const secureToken = (length = 8) => {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(length / 2)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, length).toUpperCase();
};

const normalizePrefix = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, '')
  .slice(0, 3);

export const generateCorrespondenceCode = (kind: CorrespondenceCodeKind, prefixHint = '') => {
  const prefix = kind === 'object' ? normalizePrefix(prefixHint) || PREFIXES.object : PREFIXES[kind];
  return `${prefix}-${secureToken(8)}`;
};

export const isCorrespondenceCode = (kind: CorrespondenceCodeKind, value: string) => {
  const prefix = kind === 'object' ? '[A-Z0-9]{2,3}' : PREFIXES[kind];
  return new RegExp(`^${prefix}-[A-F0-9]{8}$`).test(value);
};
