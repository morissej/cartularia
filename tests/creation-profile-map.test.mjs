import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CREATION_PROFILE_DEFINITIONS, mappedSchemaSections } from '../scripts/lib/creation-profile-map.mjs';
import { buildCreationBundle, resolveCreationSchemaVersion } from '../scripts/lib/create-cartulary-command.mjs';
import { SUPPORTED_CREATION_PROFILES } from '../src/domain/cartularyCreation.ts';

const catalogUrl = new URL('../firebase/schema-catalog/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', catalogUrl), 'utf8'));
const creationVersion = (schemaId) => manifest.activeVersions[schemaId]
  ?? Object.keys(manifest.schemas).filter((key) => key.startsWith(`${schemaId}@`)).map((key) => key.split('@')[1]).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);

test('chaque section et chaque champ de la table de création existent dans la version de création du catalogue', () => {
  for (const [assetType, definition] of Object.entries(CREATION_PROFILE_DEFINITIONS)) {
    const version = creationVersion(definition.schemaId);
    assert.ok(version, `${assetType} : aucune version publiée`);
    const artifact = JSON.parse(readFileSync(new URL(manifest.schemas[`${definition.schemaId}@${version}`].path, catalogUrl), 'utf8'));
    const fieldIds = new Set(artifact.fields.map((field) => field.fieldId));
    for (const { schemaSectionId, fieldIds: mapped } of mappedSchemaSections(definition)) {
      assert.ok(artifact.sections.includes(schemaSectionId), `${assetType}@${version} : section ${schemaSectionId}`);
      for (const fieldId of mapped) assert.ok(fieldIds.has(fieldId), `${assetType}@${version} : champ ${fieldId}`);
    }
  }
});

test('le bundle produit par la table est identique à celui du code précédent (fixture figée)', () => {
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures/creation-bundles.json', import.meta.url), 'utf8'));
  const requestData = { ownerUid: 'owner', cartularyId: 'cart_fixture_0001', registryId: 'reg_test', organizationId: 'org_test', publicCode: 'OBJ-00001' };
  const common = { profileVersion: '1.0.0', collectionId: 'col_test', brand: 'Marque', model: 'Modèle', reference: 'Réf', manufactureYear: 1967, serialNumber: 'SERIE-1', caliber: 'Calibre', description: 'Description.', conditionSummary: 'État.', purchaseDate: '2026-01-02', purchasePrice: 1000, currency: 'EUR', seller: 'Vendeur', valuationDate: '2026-02-03', valuationLow: 900, valuationMid: 1000, valuationHigh: 1100, sourceLabel: 'Source', assertedAt: '2026-09-01T00:00:00.000Z' };
  const media = [{ id: 'asset_cover', binaryId: 'bin_cover', type: 'image', tags: ['main-photo'], name: 'Couverture', mimeType: 'image/jpeg', storagePath: 'private-drafts/owner/cart_fixture_0001/bin_cover/abc/original', capturedAt: '2026-01-01T00:00:00.000Z', timestampSource: 'exif.DateTimeOriginal', category: 'ensemble' }];
  const minimal = { ...common, description: '', conditionSummary: '', purchaseDate: '', purchasePrice: null, seller: '', valuationDate: '', valuationLow: null, valuationMid: null, valuationHigh: null, manufactureYear: null, caliber: '', serialNumber: '' };
  const cases = {
    watch_full: { ...common, assetType: 'watch', schemaId: 'watch', schemaVersion: '1.6.0' },
    watch_legacy: { ...common, assetType: 'watch', schemaId: 'watch', schemaVersion: '1.5.0' },
    watch_minimal: { ...minimal, assetType: 'watch', schemaId: 'watch', schemaVersion: '1.6.0' },
    car_full: { ...common, assetType: 'car', schemaId: 'car', schemaVersion: '1.2.0' },
    car_minimal: { ...minimal, assetType: 'car', schemaId: 'car', schemaVersion: '1.2.0', serialNumber: 'VIN-1', manufactureYear: 1967 },
  };
  for (const [name, profile] of Object.entries(cases)) assert.deepEqual(buildCreationBundle({ requestData, profile, media }), fixtures[name], name);
  const upgraded = buildCreationBundle({ requestData, profile: cases.watch_legacy, media, schemaVersion: '1.6.0' });
  assert.equal(upgraded.envelope.schemaVersion, '1.6.0');
  assert.ok(upgraded.sections.every((section) => section.schemaVersion === 'watch@1.6.0'));
});

test('le client dérive ses types d’objets de la même table et ne code aucune version de schéma', () => {
  assert.deepEqual(Object.keys(SUPPORTED_CREATION_PROFILES), Object.keys(CREATION_PROFILE_DEFINITIONS));
  assert.equal(SUPPORTED_CREATION_PROFILES.car.makerLabel, CREATION_PROFILE_DEFINITIONS.car.makerLabel);
  assert.ok(!('schemaVersion' in SUPPORTED_CREATION_PROFILES.watch));
  const domain = readFileSync(new URL('../src/domain/cartularyCreation.ts', import.meta.url), 'utf8');
  const command = readFileSync(new URL('../scripts/lib/create-cartulary-command.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(domain, /schemaVersion: '\d/);
  assert.doesNotMatch(command, /versions: \[/);
  assert.doesNotMatch(command, /'watch@1\.\d+\.\d+'/);
});

const fakeFirestore = (documents) => ({ doc: (path) => ({ get: async () => ({ exists: path in documents, data: () => documents[path] }) }) });

test('la version de création vient du catalogue : active, sinon dernière publiée, sinon celle demandée si elle est publiée', async () => {
  const active = fakeFirestore({ 'schemaCatalog/watch': { activeVersion: '1.6.0', latestVersion: '1.6.0' }, 'schemaCatalog/watch/versions/1.6.0': { sectionIds: JSON.parse(readFileSync(new URL('watch/1.6.0.json', catalogUrl), 'utf8')).sections } });
  assert.deepEqual(await resolveCreationSchemaVersion({ firestore: active, schemaId: 'watch', requestedVersion: '1.5.0' }), { schemaVersion: '1.6.0', source: 'active' });
  const latestOnly = fakeFirestore({ 'schemaCatalog/car': { activeVersion: null, latestVersion: '1.2.0' }, 'schemaCatalog/car/versions/1.2.0': {} });
  assert.deepEqual(await resolveCreationSchemaVersion({ firestore: latestOnly, schemaId: 'car', requestedVersion: '1.1.0' }), { schemaVersion: '1.2.0', source: 'latest' });
  const noPointer = fakeFirestore({ 'schemaCatalog/car/versions/1.2.0': {} });
  assert.deepEqual(await resolveCreationSchemaVersion({ firestore: noPointer, schemaId: 'car', requestedVersion: '1.2.0' }), { schemaVersion: '1.2.0', source: 'requested' });
  await assert.rejects(resolveCreationSchemaVersion({ firestore: fakeFirestore({}), schemaId: 'car', requestedVersion: '9.9.9' }), /n’est pas publiée/);
  const incomplete = fakeFirestore({ 'schemaCatalog/watch': { activeVersion: '1.6.0' }, 'schemaCatalog/watch/versions/1.6.0': { sectionIds: ['cover.watch'] } });
  await assert.rejects(resolveCreationSchemaVersion({ firestore: incomplete, schemaId: 'watch', requestedVersion: '1.6.0' }), /ne connaît pas les sections/);
  await assert.rejects(resolveCreationSchemaVersion({ firestore: fakeFirestore({}), schemaId: 'boat', requestedVersion: '1.0.0' }), /pas pris en charge/);
});
