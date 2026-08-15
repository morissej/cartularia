import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WATCH_SCHEMA,
  WATCH_SCHEMA_FIELDS,
  WATCH_SCHEMA_VERSION,
} from '../src/schema/watchSchema.ts';

const exportedSchema = JSON.parse(
  readFileSync(new URL(`../firebase/schema-catalog/watch/${WATCH_SCHEMA_VERSION}.json`, import.meta.url), 'utf8'),
);
const legacySchema = JSON.parse(
  readFileSync(new URL('../firebase/schema-catalog/watch/1.3.0.json', import.meta.url), 'utf8'),
);

test('watch@1.4.0 dérive son compteur et ses sections du catalogue courant', () => {
  assert.equal(WATCH_SCHEMA_VERSION, '1.4.0');
  assert.equal(WATCH_SCHEMA_FIELDS.length, WATCH_SCHEMA.fieldCount);
  assert.equal(new Set(WATCH_SCHEMA_FIELDS.map((field) => field.fieldId)).size, WATCH_SCHEMA_FIELDS.length);
  assert.equal(WATCH_SCHEMA.sections.length, new Set(WATCH_SCHEMA_FIELDS.map((field) => field.sectionId)).size);
  assert.ok(WATCH_SCHEMA.sections.includes('value.sensitivity'));
});

test('watch@1.3.0 reste un artefact historique distinct et lisible', () => {
  assert.equal(legacySchema.version, '1.3.0');
  assert.equal(legacySchema.fieldCount, legacySchema.fields.length);
  assert.equal(new Set(legacySchema.fields.map((field) => field.fieldId)).size, legacySchema.fields.length);
  assert.ok(!legacySchema.sections.includes('value.sensitivity'));
  assert.ok(WATCH_SCHEMA.fieldCount > legacySchema.fieldCount);
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
