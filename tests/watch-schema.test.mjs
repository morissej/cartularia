import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WATCH_SCHEMA,
  WATCH_SCHEMA_EXPECTED_FIELD_COUNT,
  WATCH_SCHEMA_FIELDS,
  WATCH_SCHEMA_VERSION,
} from '../src/schema/watchSchema.ts';

const exportedSchema = JSON.parse(
  readFileSync(new URL('../firebase/schema-catalog/watch/1.3.0.json', import.meta.url), 'utf8'),
);

test('watch@1.3.0 représente exactement les 78 postes du catalogue', () => {
  assert.equal(WATCH_SCHEMA_VERSION, '1.3.0');
  assert.equal(WATCH_SCHEMA_FIELDS.length, WATCH_SCHEMA_EXPECTED_FIELD_COUNT);
  assert.equal(new Set(WATCH_SCHEMA_FIELDS.map((field) => field.fieldId)).size, WATCH_SCHEMA_EXPECTED_FIELD_COUNT);
});

test('aucun champ Secret ne peut être projeté vers une audience', () => {
  const unsafeFields = WATCH_SCHEMA_FIELDS.filter(
    (field) => field.defaultVisibility === 'secret' && field.publishableTo.length > 0,
  );
  assert.deepEqual(unsafeFields, []);
});

test('le profil exporté reste identique au profil typé', () => {
  assert.deepEqual(exportedSchema, WATCH_SCHEMA);
});
