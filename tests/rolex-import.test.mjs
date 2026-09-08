import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildRolexDossierState, buildRolexImportBundle, ROLEX_CARTULARY_ID, ROLEX_PUBLIC_CODE } from '../src/migrations/rolexImport.ts';
import { buildCreationBundle } from '../scripts/lib/create-cartulary-command.mjs';

test('le bundle Rolex reste Secret, non publié, sans média fictif, et cite une version publiée du catalogue', () => {
  const bundle = buildRolexImportBundle();
  const catalog = JSON.parse(readFileSync(new URL('../firebase/schema-catalog/manifest.json', import.meta.url), 'utf8'));
  assert.equal(bundle.envelope.id, ROLEX_CARTULARY_ID);
  assert.equal(bundle.envelope.publicCode, ROLEX_PUBLIC_CODE);
  assert.equal(bundle.envelope.defaultVisibility, 'secret');
  assert.equal(bundle.envelope.publicationStatus, 'none');
  assert.ok(catalog.schemas[`${bundle.envelope.schemaId}@${bundle.envelope.schemaVersion}`], 'version de schéma publiée');
  assert.deepEqual(bundle.assets, []);
  for (const collection of ['sections', 'sources', 'valuations', 'comparables', 'ownerRelations', 'events']) {
    assert.ok(bundle[collection].every((document) => document.visibility === 'secret'), `${collection} Secret`);
  }
  const watchSchema = JSON.parse(readFileSync(new URL('../firebase/schema-catalog/watch/1.6.0.json', import.meta.url), 'utf8'));
  for (const section of bundle.sections.filter((candidate) => candidate.status !== 'imported_unmapped')) assert.ok(watchSchema.sections.includes(section.schemaSectionId), `${section.schemaSectionId} connue du schéma`);
});

test('le bundle Rolex utilise les mêmes sections et champs que la création depuis le Registre', () => {
  const state = buildRolexDossierState();
  const profile = state.get('cartularia-creation-profile');
  const created = buildCreationBundle({
    requestData: { cartularyId: ROLEX_CARTULARY_ID, organizationId: 'org_demo', registryId: 'reg_collection_privee', publicCode: ROLEX_PUBLIC_CODE, ownerUid: 'wave1-owner' },
    profile,
    media: [{ id: 'asset_x', binaryId: 'bin_x', type: 'image', name: 'x.jpg', mimeType: 'image/jpeg', tags: ['main-photo'], storagePath: 'private-drafts/wave1-owner/x/bin_x/abc/original' }],
  });
  const imported = buildRolexImportBundle();
  const shape = (bundle) => bundle.sections.map((section) => [section.id, section.schemaSectionId, Object.keys(section.fields).sort().join(','), Object.keys(section.extensions || {}).sort().join(',')]);
  assert.deepEqual(shape(imported), shape(created));
  assert.equal(imported.envelope.displayTitle, created.envelope.displayTitle);
});

test('l’état du brouillon privé Rolex couvre les clés lues par le Cartulaire complet', () => {
  const state = buildRolexDossierState();
  for (const key of ['cartularia-creation-profile', 'cartularia-public-code', 'cartularia-specification-groups', 'cartularia-identification-checks', 'cartularia-documentation-items', 'cartularia-comparable-analysis', 'cartularia-comparables', 'cartularia-editable-copy', 'cartularia-market-depth', 'cartularia-market-history', 'cartularia-retained-valuation', 'cartularia-purchase']) {
    assert.ok(state.has(key), key);
  }
  assert.equal(state.get('cartularia-editable-copy').originTitle, 'La référence qui a défini la GMT vintage');
  const groups = state.get('cartularia-specification-groups');
  assert.ok(groups.flatMap((group) => group.items).every((item) => typeof item.value === 'string' && item.value.length > 0), 'aucune valeur de spécification vide');
});

test('l’application ne porte plus de branche par marque : IWC et Rolex sont des données', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const active = readFileSync(new URL('../src/data/activeCartulary.ts', import.meta.url), 'utf8');
  const gallery = readFileSync(new URL('../src/services/registryGallery.ts', import.meta.url), 'utf8');
  for (const source of [app, active, gallery]) {
    assert.doesNotMatch(source, /isIwcCartulary|isRolexCartulary|rolexFallbackProfile|rolexComparables/);
  }
  assert.doesNotMatch(active, /mockData/);
});
