export interface CreationFieldSpec {
  from?: string;
  as?: 'year' | 'yearString' | 'money' | 'paragraph';
  literal?: unknown;
  pairs?: ReadonlyArray<{ from: string; as?: 'yearString'; label: string }>;
  part?: 'label' | 'value';
}
export interface CreationSectionDefinition {
  id: string;
  schemaSectionId: string;
  title: string;
  status?: 'imported_unreviewed' | 'imported_unmapped';
  when?: readonly string[];
  fields: Record<string, CreationFieldSpec>;
  extensions?: Record<string, CreationFieldSpec>;
  foldInto?: string;
}
export interface CreationProfileDefinition {
  schemaId: string;
  label: string;
  assetTypeValue: string;
  makerLabel: string;
  referenceLabel: string;
  serialLabel: string;
  technicalLabel: string;
  minYear: number;
  requires: readonly string[];
  sections: readonly CreationSectionDefinition[];
}
export const CREATION_PROFILE_DEFINITIONS: {
  readonly watch: CreationProfileDefinition & { schemaId: 'watch' };
  readonly car: CreationProfileDefinition & { schemaId: 'car' };
};
export const SUPPORTED_CREATION_ASSET_TYPES: string[];
export function mappedSchemaSections(definition: CreationProfileDefinition): Array<{ schemaSectionId: string; fieldIds: string[] }>;
export function materializeCreationSections(input: {
  definition: CreationProfileDefinition;
  normalized: Record<string, unknown>;
  provenance: (value: unknown) => unknown;
  schemaVersion: string;
}): unknown[];
