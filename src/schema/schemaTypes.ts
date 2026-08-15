import type {
  AIFieldCardinality,
  AIFieldDataType,
  AIFieldSourceKind,
} from '../ai/fieldCatalog.ts';

export type SchemaVisibility = 'public' | 'community' | 'secret';
export type SchemaPublishTarget = 'registry' | 'community' | 'public' | 'report';

export interface VerticalSchemaField<FieldId extends string = string> {
  fieldId: FieldId;
  sectionId: string;
  label: string;
  purpose: string;
  instructions: string;
  dataType: AIFieldDataType;
  cardinality: AIFieldCardinality;
  required: boolean;
  validation: string;
  defaultVisibility: SchemaVisibility;
  publishableTo: SchemaPublishTarget[];
  sourcePriority: readonly AIFieldSourceKind[];
  aiWritable: boolean;
  humanReviewRequired: boolean;
  registryFacet: boolean;
  allowedValues?: readonly string[];
  examples?: readonly string[];
  dependencies?: readonly string[];
}

export interface VerticalSchema<FieldId extends string = string> {
  schemaId: string;
  assetType: string;
  version: string;
  status: 'baseline' | 'active' | 'deprecated';
  defaultVisibility: 'secret';
  fieldCount: number;
  sections: string[];
  fields: readonly VerticalSchemaField<FieldId>[];
}

export const publishTargetsFor = (visibility: SchemaVisibility): SchemaPublishTarget[] => {
  if (visibility === 'public') return ['registry', 'community', 'public'];
  if (visibility === 'community') return ['community'];
  return [];
};

export const defineVerticalSchema = <FieldId extends string>({
  schemaId,
  assetType,
  version,
  status,
  fields,
}: {
  schemaId: string;
  assetType: string;
  version: string;
  status: VerticalSchema['status'];
  fields: readonly VerticalSchemaField<FieldId>[];
}): VerticalSchema<FieldId> => {
  const fieldIds = fields.map((field) => field.fieldId);
  if (new Set(fieldIds).size !== fieldIds.length) {
    throw new Error(`Le profil ${schemaId}@${version} contient des fieldId dupliqués.`);
  }
  for (const field of fields) {
    if (!field.fieldId || !field.sectionId || !field.label) {
      throw new Error(`Le profil ${schemaId}@${version} contient un champ incomplet.`);
    }
    if (field.defaultVisibility === 'secret' && field.publishableTo.length > 0) {
      throw new Error(`Le champ Secret ${field.fieldId} ne peut porter de cible de publication.`);
    }
  }
  return {
    schemaId,
    assetType,
    version,
    status,
    defaultVisibility: 'secret',
    fieldCount: fields.length,
    sections: [...new Set(fields.map((field) => field.sectionId))].sort(),
    fields,
  };
};
