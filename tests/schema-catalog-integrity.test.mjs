import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { WATCH_SCHEMA } from '../src/schema/watchSchema.ts';
import {
  activeVersionsFrom,
  schemaContractDigest,
  synchronizeSchemaCatalog,
  verifySchemaCatalog,
} from '../scripts/lib/schema-catalog-files.mjs';

const successorOf = (schema, version) => ({ ...schema, version });

const temporaryCatalogUrl = () =>
  new URL('./', pathToFileURL(`${mkdtempSync(`${tmpdir()}/cartularia-schema-`)}/`));

test('un profil publié ne peut pas être réécrit sous la même version', () => {
  const catalogDirectoryUrl = temporaryCatalogUrl();
  synchronizeSchemaCatalog({ catalogDirectoryUrl, schemas: [WATCH_SCHEMA] });

  const incompatibleSchema = {
    ...WATCH_SCHEMA,
    fields: WATCH_SCHEMA.fields.map((field, index) =>
      index === 0 ? { ...field, label: `${field.label} modifié` } : field),
  };
  assert.throws(
    () => synchronizeSchemaCatalog({ catalogDirectoryUrl, schemas: [incompatibleSchema] }),
    /Refus d'écraser/,
  );
});

test('le manifeste épingle l’artefact et le contrat canonique', () => {
  const catalogDirectoryUrl = temporaryCatalogUrl();
  synchronizeSchemaCatalog({ catalogDirectoryUrl, schemas: [WATCH_SCHEMA] });
  const artifacts = verifySchemaCatalog(catalogDirectoryUrl);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', catalogDirectoryUrl), 'utf8'));

  assert.equal(artifacts.length, 1);
  const key = `watch@${WATCH_SCHEMA.version}`;
  assert.equal(manifest.schemas[key].contractDigest, schemaContractDigest(WATCH_SCHEMA));
  assert.match(manifest.schemas[key].artifactDigest, /^sha256:[a-f0-9]{64}$/);
});

test('publier une version active succède à la précédente sans réécrire son artefact', () => {
  const catalogDirectoryUrl = temporaryCatalogUrl();
  synchronizeSchemaCatalog({ catalogDirectoryUrl, schemas: [WATCH_SCHEMA] });
  const predecessorUrl = new URL(`watch/${WATCH_SCHEMA.version}.json`, catalogDirectoryUrl);
  const predecessorBefore = readFileSync(predecessorUrl, 'utf8');

  synchronizeSchemaCatalog({ catalogDirectoryUrl, schemas: [successorOf(WATCH_SCHEMA, '9.9.9')] });

  const manifest = JSON.parse(readFileSync(new URL('manifest.json', catalogDirectoryUrl), 'utf8'));
  assert.equal(manifest.activeVersions.watch, '9.9.9');
  assert.equal(readFileSync(predecessorUrl, 'utf8'), predecessorBefore);
  assert.ok(manifest.schemas[`watch@${WATCH_SCHEMA.version}`]);
  assert.ok(manifest.schemas['watch@9.9.9']);
});

test('le catalogue refuse deux versions actives pour un même schéma', () => {
  assert.throws(
    () => activeVersionsFrom([WATCH_SCHEMA, successorOf(WATCH_SCHEMA, '9.9.9')]),
    /Deux versions actives déclarées pour watch/,
  );
});

test('la vérification signale un pointeur de version active périmé', () => {
  const catalogDirectoryUrl = temporaryCatalogUrl();
  synchronizeSchemaCatalog({ catalogDirectoryUrl, schemas: [WATCH_SCHEMA] });
  synchronizeSchemaCatalog({ catalogDirectoryUrl, schemas: [successorOf(WATCH_SCHEMA, '9.9.9')] });

  assert.throws(
    () => synchronizeSchemaCatalog({ catalogDirectoryUrl, schemas: [WATCH_SCHEMA], checkOnly: true }),
    /versions actives/,
  );
});

test('la vérification refuse un pointeur vers un profil absent du catalogue', () => {
  const catalogDirectoryUrl = temporaryCatalogUrl();
  synchronizeSchemaCatalog({ catalogDirectoryUrl, schemas: [WATCH_SCHEMA] });

  const manifestUrl = new URL('manifest.json', catalogDirectoryUrl);
  const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));
  manifest.activeVersions = { watch: '0.0.1' };
  writeFileSync(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  assert.throws(() => verifySchemaCatalog(catalogDirectoryUrl), /watch@0\.0\.1 comme version active/);
});
