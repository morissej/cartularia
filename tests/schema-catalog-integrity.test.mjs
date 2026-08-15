import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { WATCH_SCHEMA } from '../src/schema/watchSchema.ts';
import {
  schemaContractDigest,
  synchronizeSchemaCatalog,
  verifySchemaCatalog,
} from '../scripts/lib/schema-catalog-files.mjs';

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
  assert.equal(manifest.schemas['watch@1.4.0'].contractDigest, schemaContractDigest(WATCH_SCHEMA));
  assert.match(manifest.schemas['watch@1.4.0'].artifactDigest, /^sha256:[a-f0-9]{64}$/);
});
