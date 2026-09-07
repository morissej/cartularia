import assert from 'node:assert/strict';
import test from 'node:test';
import { CAR_SCHEMA_FIELDS } from '../src/schema/carSchema.ts';
import { buildGenericSectionPatches } from '../scripts/lib/generic-sections-command.mjs';
import { genericFieldIsEditable, genericFieldGroupIsEditable, validateGenericFieldValue } from '../scripts/lib/generic-editing-policy.mjs';
import { WATCH_SCHEMA_FIELDS } from '../src/schema/watchSchema.ts';
import { buildCreationBundle } from '../scripts/lib/create-cartulary-command.mjs';
import { defaultActiveCollectionId } from '../src/domain/collections.ts';

const root = { schemaId: 'car', schemaVersion: '1.2.0', assetType: 'car', revision: 7 };

test('N-R06 : les groupes mixtes incomplets ne sont jamais proposés comme éditables', () => {
  const mixed = WATCH_SCHEMA_FIELDS.filter((field) => field.fieldId.startsWith('condition.reports[].') || field.fieldId.startsWith('value.expenses[].'));
  assert.ok(mixed.length > 0);
  for (const field of mixed) assert.equal(genericFieldGroupIsEditable(field, WATCH_SCHEMA_FIELDS), false, field.fieldId);
  for (const field of CAR_SCHEMA_FIELDS.filter((field) => field.fieldId.startsWith('history.service[].'))) assert.equal(genericFieldGroupIsEditable(field, CAR_SCHEMA_FIELDS), true, field.fieldId);
});
const apply = (edits, overrides = {}) => buildGenericSectionPatches({ draft: { version: 1, ...root, baseRevision: 7, edits, ...overrides }, root,
  schemaFields: CAR_SCHEMA_FIELDS, sections: [{ id: 'identity.summary', schemaSectionId: 'cover.car', fields: { 'cover.car.model': { value: 'Original', proofStatus: 'observed' } }, revision: 2 }], ownerUid: 'owner', occurredAt: '2026-09-06T10:00:00Z' });

test('le formulaire et la commande partagent les champs autorisés, sans champs système ou listes personnelles', () => {
  for (const id of ['cover.privacy.objectCode', 'cover.asset.type', 'media.assets[].hash', 'publishing.blocks.website', 'condition.storage.codeNames[]']) assert.equal(genericFieldIsEditable(CAR_SCHEMA_FIELDS.find((field) => field.fieldId === id)), false, id);
  assert.equal(genericFieldIsEditable(CAR_SCHEMA_FIELDS.find((field) => field.fieldId === 'identity.car.vin')), true);
  assert.throws(() => apply([{ fieldId: 'cover.privacy.objectCode', value: 'HACK' }]), /parcours dédié/);
  assert.throws(() => apply([{ fieldId: 'unlisted.thing', value: 'HACK' }]), /parcours dédié/);
  assert.throws(() => apply([{ fieldId: 'cover.car.model', value: 'New', visibility: 'public' }]), /non autorisée/);
});
test('une liste d’entretien est validée et enregistrée en groupe aligné sans ouvrir le Coffre', () => {
  const edits = ['date', 'mileageKm', 'kind', 'description'].map((key, index) => ({ fieldId: `history.service[].${key}`, value: [['2026-09-01'], [12345], ['Vidange'], ['Observation déclarée']][index] }));
  const [patch] = apply(edits); assert.equal(patch.schemaSectionId, 'history.service');
  assert.deepEqual(patch.fields['history.service[].date'].value, ['2026-09-01']);
  assert.equal(patch.fields['history.service[].description'].visibility, 'secret');
  assert.throws(() => apply(edits.slice(0, 2)), /alignés/);
  assert.throws(() => apply(edits.map((edit, index) => index === 1 ? { ...edit, value: [-3] } : edit)), /invalide/);
  assert.throws(() => apply(edits.map((edit) => ({ ...edit, value: Array(101).fill(null) }))), /100 lignes/);
});
test('la modification fusionne les champs et conserve le schéma exact et la provenance serveur privée', () => {
  const [patch] = apply([{ fieldId: 'cover.car.maker', value: ' Nouveau constructeur ' }]);
  assert.equal(patch.id, 'identity.summary'); assert.equal(patch.schemaVersion, 'car@1.2.0'); assert.equal(patch.revision, 3);
  assert.equal(patch.fields['cover.car.model'].value, 'Original');
  assert.deepEqual(patch.fields['cover.car.maker'], { value: 'Nouveau constructeur', proofStatus: 'declared', confidence: 'low', assertedBy: 'owner', observedAt: '2026-09-06T10:00:00Z', sourceRefs: ['source_owner_generic_edit'], visibility: 'secret' });
  assert.throws(() => apply([{ fieldId: 'cover.car.model', value: 'New' }], { baseRevision: 6 }), /changé/);
  assert.throws(() => apply([{ fieldId: 'cover.car.model', value: 'New' }], { schemaVersion: '9.0.0' }), /changé/);
});
test('les dates, montants et caractéristiques invalides sont refusés sans normaliser un VIN historique', () => {
  for (const [fieldId, value] of [['cover.car.year', 1870], ['usage.mileage.valueKm', -1], ['usage.mileage.valueKm', 10.5], ['usage.mileage.observedAt', '2026-02-31'], ['value.retained.amount', { amount: -10, currency: 'EUR' }]]) {
    assert.throws(() => validateGenericFieldValue(CAR_SCHEMA_FIELDS.find((field) => field.fieldId === fieldId), value), /invalide/);
  }
  assert.equal(validateGenericFieldValue(CAR_SCHEMA_FIELDS.find((field) => field.fieldId === 'identity.car.vin'), '911-1967-HISTORIQUE'), '911-1967-HISTORIQUE');
});
test('une collection archivée ne devient jamais la destination par défaut', () => {
  const collections = [{ id: 'archived', status: 'archived' }, { id: 'active', status: 'draft' }];
  assert.equal(defaultActiveCollectionId(collections, 'archived'), 'active');
  assert.equal(defaultActiveCollectionId(collections.slice(0, 1), 'archived'), '');
});
test('le même profil de création accepte montre et automobile sans mettre à niveau une version historique', () => {
  const requestData = { ownerUid: 'owner', cartularyId: 'cart_custom_0001', registryId: 'reg_test', organizationId: 'org_test', publicCode: 'OBJ-00001' };
  const common = { profileVersion: '1.0.0', collectionId: 'col_test', brand: 'Constructeur', model: 'Modèle', reference: 'Version', manufactureYear: 1967, serialNumber: 'CHASSIS-HISTORIQUE', caliber: 'Moteur', conditionSummary: 'À vérifier', purchasePrice: 100, valuationMid: 200, currency: 'EUR', assertedAt: '2026-09-06T10:00:00Z' };
  const media = [{ id: 'asset_cover', binaryId: 'bin_cover', type: 'image', tags: ['main-photo'], name: 'Couverture' }];
  const car = buildCreationBundle({ requestData, profile: { ...common, assetType: 'car', schemaId: 'car', schemaVersion: '1.2.0' }, media });
  assert.equal(car.envelope.assetType, 'car'); assert.equal(car.envelope.publicationStatus, 'none');
  const descriptors = new Map(CAR_SCHEMA_FIELDS.map((field) => [field.fieldId, field]));
  for (const section of car.sections) for (const id of Object.keys(section.fields)) assert.equal(descriptors.get(id)?.sectionId, section.schemaSectionId, id);
  assert.equal(car.envelope.netValuation, null);
  const watch = buildCreationBundle({ requestData, profile: { ...common, assetType: 'watch', schemaId: 'watch', schemaVersion: '1.5.0' }, media });
  assert.equal(watch.envelope.schemaVersion, '1.5.0'); assert.ok(watch.sections.every((section) => section.schemaVersion === 'watch@1.5.0'));
  const zeroValue = buildCreationBundle({ requestData, profile: { ...common, assetType: 'car', schemaId: 'car', schemaVersion: '1.2.0', purchasePrice: 0, valuationLow: 0, valuationMid: 0, valuationHigh: 0 }, media });
  assert.equal(zeroValue.envelope.purchasePrice, 0); assert.equal(zeroValue.envelope.grossValuation, 0); assert.equal(zeroValue.valuations[0].midValue, 0);
});
