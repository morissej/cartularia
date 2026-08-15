import {
  AI_FIELD_CATALOG,
  AI_SCHEMA_VERSION,
  type AIFieldDescriptor,
  type AIFieldId,
} from '../ai/fieldCatalog.ts';
import {
  defineVerticalSchema,
  publishTargetsFor,
  type VerticalSchemaField,
} from './schemaTypes.ts';

export const WATCH_SCHEMA_ID = 'watch';
export const WATCH_SCHEMA_VERSION = AI_SCHEMA_VERSION;

export type { SchemaPublishTarget, SchemaVisibility } from './schemaTypes.ts';
export interface WatchSchemaField extends VerticalSchemaField<AIFieldId> {}

const REGISTRY_FACETS = new Set<AIFieldId>([
  'cover.asset.type',
  'cover.watch.brand',
  'cover.watch.model',
  'cover.watch.reference',
]);

export const WATCH_SCHEMA_FIELDS: readonly WatchSchemaField[] = AI_FIELD_CATALOG.map((
  descriptor: AIFieldDescriptor,
): WatchSchemaField => ({
  fieldId: descriptor.id as AIFieldId,
  sectionId: `${descriptor.page}.${descriptor.section}`,
  label: descriptor.label,
  purpose: descriptor.purpose,
  instructions: descriptor.instructions,
  dataType: descriptor.dataType,
  cardinality: descriptor.cardinality,
  required: descriptor.required,
  validation: descriptor.validation,
  defaultVisibility: descriptor.confidentiality,
  publishableTo: publishTargetsFor(descriptor.confidentiality),
  sourcePriority: descriptor.sourcePriority,
  aiWritable: descriptor.aiWritable,
  humanReviewRequired: descriptor.humanReviewRequired,
  registryFacet: REGISTRY_FACETS.has(descriptor.id as AIFieldId),
  ...(descriptor.allowedValues ? { allowedValues: descriptor.allowedValues } : {}),
  ...(descriptor.examples ? { examples: descriptor.examples } : {}),
  ...(descriptor.dependencies ? { dependencies: descriptor.dependencies } : {}),
}));

export const WATCH_SCHEMA = defineVerticalSchema({
  schemaId: WATCH_SCHEMA_ID,
  assetType: 'watch',
  version: WATCH_SCHEMA_VERSION,
  status: 'active',
  fields: WATCH_SCHEMA_FIELDS,
});

export const WATCH_SCHEMA_SECTIONS = WATCH_SCHEMA.sections;
