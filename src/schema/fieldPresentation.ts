import type { CartularySectionDocument, ProvenancedValue } from '../domain/cartulary.ts';
import type { VerticalSchema } from './schemaTypes.ts';

export interface GenericFieldRow {
  fieldId: string;
  label: string;
  value: unknown;
  proofStatus: string | null;
  visibility: string | null;
  knownBySchema: boolean;
  source: 'fields' | 'extensions';
}

const isProvenancedValue = (value: unknown): value is ProvenancedValue<unknown> =>
  value !== null &&
  value !== undefined &&
  typeof value === 'object' &&
  'value' in value &&
  'proofStatus' in value &&
  'visibility' in value;

const unwrap = (value: unknown): Pick<GenericFieldRow, 'value' | 'proofStatus' | 'visibility'> => {
  if (isProvenancedValue(value)) {
    return {
      value: value.value,
      proofStatus: value.proofStatus,
      visibility: value.visibility,
    };
  }
  if (Array.isArray(value)) {
    return {
      value: value.map((item) => isProvenancedValue(item) ? item.value : item),
      proofStatus: value.some(isProvenancedValue) ? 'mixed_or_repeated' : null,
      visibility: value.some(isProvenancedValue) ? 'secret' : null,
    };
  }
  return { value, proofStatus: null, visibility: null };
};

export const buildGenericFieldRows = (
  section: CartularySectionDocument,
  schema: Pick<VerticalSchema, 'fields'>,
): GenericFieldRow[] => {
  const descriptors = new Map(schema.fields.map((field) => [field.fieldId, field]));
  const collect = (source: GenericFieldRow['source'], values: Record<string, unknown> | undefined) =>
    Object.entries(values ?? {}).map(([fieldId, rawValue]) => {
      const descriptor = descriptors.get(fieldId);
      return {
        fieldId,
        label: descriptor?.label ?? fieldId,
        ...unwrap(rawValue),
        knownBySchema: Boolean(descriptor),
        source,
      };
    });
  return [
    ...collect('fields', section.fields),
    ...collect('extensions', section.extensions),
  ].sort((left, right) => left.fieldId.localeCompare(right.fieldId));
};

export const formatGenericValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return 'Non renseigné';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (Array.isArray(value)) return value.length ? value.map(formatGenericValue).join(' · ') : 'Aucune donnée';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('amount' in record && 'currency' in record) {
      return record.amount === null ? `Non renseigné (${String(record.currency)})` : `${String(record.amount)} ${String(record.currency)}`;
    }
    return JSON.stringify(value);
  }
  return String(value);
};
