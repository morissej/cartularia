import type { VerticalSchemaField } from '../../src/schema/schemaTypes.ts';
export function genericFieldIsEditable(field: VerticalSchemaField | undefined): boolean;
export function genericFieldGroupIsEditable(field: VerticalSchemaField | undefined, fields: readonly VerticalSchemaField[]): boolean;
export function validateGenericFieldValue(field: VerticalSchemaField | undefined, value: unknown): unknown;
