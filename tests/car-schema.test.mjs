import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAR_SCHEMA,
  CAR_SCHEMA_FIELDS,
  CAR_SCHEMA_VERSION,
} from '../src/schema/carSchema.ts';
import { defineVerticalSchema } from '../src/schema/schemaTypes.ts';
import { OWNERSHIP_HISTORY_FIELD_IDS } from '../src/domain/ownershipHistory.ts';

const exportedSchema = JSON.parse(
  readFileSync(new URL(`../firebase/schema-catalog/car/${CAR_SCHEMA_VERSION}.json`, import.meta.url), 'utf8'),
);
const legacySchema = JSON.parse(
  readFileSync(new URL('../firebase/schema-catalog/car/1.0.0.json', import.meta.url), 'utf8'),
);

test('car@1.1.0 ajoute le contrat générique de propriété à la verticale pilote', () => {
  assert.equal(CAR_SCHEMA_VERSION, '1.1.0');
  assert.equal(CAR_SCHEMA_FIELDS.length, CAR_SCHEMA.fieldCount);
  assert.equal(new Set(CAR_SCHEMA_FIELDS.map((field) => field.fieldId)).size, CAR_SCHEMA_FIELDS.length);
  assert.equal(CAR_SCHEMA.assetType, 'car');
  assert.ok(CAR_SCHEMA.sections.includes('technical.powertrain'));
  assert.ok(CAR_SCHEMA.sections.includes('history.service'));
  assert.ok(CAR_SCHEMA.sections.includes('cover.ownership_history'));
  for (const fieldId of Object.values(OWNERSHIP_HISTORY_FIELD_IDS)) {
    assert.ok(CAR_SCHEMA_FIELDS.some((field) => field.fieldId === fieldId));
  }
});

test('car@1.0.0 reste un artefact historique de 40 champs', () => {
  assert.equal(legacySchema.version, '1.0.0');
  assert.equal(legacySchema.fieldCount, 40);
  assert.ok(!legacySchema.sections.includes('cover.ownership_history'));
});

test('chaque champ car porte le contrat vertical complet et protège Secret', () => {
  for (const field of CAR_SCHEMA_FIELDS) {
    assert.ok(field.fieldId);
    assert.ok(field.sectionId);
    assert.ok(field.dataType);
    assert.ok(field.cardinality);
    assert.equal(typeof field.required, 'boolean');
    assert.ok(field.validation);
    assert.ok(field.defaultVisibility);
    assert.ok(Array.isArray(field.publishableTo));
    assert.ok(field.sourcePriority.length > 0);
    assert.equal(typeof field.aiWritable, 'boolean');
    assert.equal(typeof field.humanReviewRequired, 'boolean');
    assert.equal(typeof field.registryFacet, 'boolean');
    if (field.defaultVisibility === 'secret') assert.deepEqual(field.publishableTo, []);
  }
});

test('le profil exporté reste identique au profil typé', () => {
  assert.deepEqual(exportedSchema, CAR_SCHEMA);
});

test('le noyau refuse les doublons et une publication Secret', () => {
  const base = CAR_SCHEMA_FIELDS[0];
  assert.throws(
    () => defineVerticalSchema({
      schemaId: 'invalid-duplicate',
      assetType: 'car',
      version: '0.0.0',
      status: 'baseline',
      fields: [base, base],
    }),
    /dupliqués/,
  );
  assert.throws(
    () => defineVerticalSchema({
      schemaId: 'invalid-secret',
      assetType: 'car',
      version: '0.0.0',
      status: 'baseline',
      fields: [{ ...base, fieldId: 'secret.invalid', defaultVisibility: 'secret', publishableTo: ['public'] }],
    }),
    /ne peut porter/,
  );
});
