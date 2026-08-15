import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalize, sha256Digest } from './canonical-json.mjs';

export const SCHEMA_CONTRACT_DIGEST_VERSION = 'schema-contract-jcs-1';
export const SCHEMA_CATALOG_MANIFEST_VERSION = 1;

const manifestUrlFor = (catalogDirectoryUrl) => new URL('manifest.json', catalogDirectoryUrl);
const schemaKey = (schema) => `${schema.schemaId}@${schema.version}`;
const schemaRelativePath = (schema) => `${schema.schemaId}/${schema.version}.json`;

const derivedSections = (schema) =>
  [...new Set(schema.fields.map((field) => field.sectionId))].sort();

export const assertValidSchemaArtifact = (schema, source = schemaKey(schema)) => {
  if (!schema || typeof schema !== 'object') {
    throw new Error(`Le profil ${source} n'est pas un objet JSON.`);
  }
  if (!schema.schemaId || !schema.assetType || !schema.version || !Array.isArray(schema.fields)) {
    throw new Error(`Le profil ${source} est incomplet.`);
  }
  if (schema.fieldCount !== schema.fields.length) {
    throw new Error(
      `Le profil ${source} annonce ${schema.fieldCount} champs mais en contient ${schema.fields.length}.`,
    );
  }
  const fieldIds = schema.fields.map((field) => field.fieldId);
  if (new Set(fieldIds).size !== fieldIds.length) {
    throw new Error(`Le profil ${source} contient des fieldId dupliqués.`);
  }
  const expectedSections = derivedSections(schema);
  if (canonicalize(schema.sections) !== canonicalize(expectedSections)) {
    throw new Error(`Le profil ${source} contient une liste de sections incohérente.`);
  }
};

export const schemaContractPayload = (schema) => {
  assertValidSchemaArtifact(schema);
  return {
    schemaId: schema.schemaId,
    assetType: schema.assetType,
    version: schema.version,
    defaultVisibility: schema.defaultVisibility,
    fieldCount: schema.fieldCount,
    sections: [...schema.sections].sort(),
    fields: [...schema.fields].sort((left, right) => left.fieldId.localeCompare(right.fieldId)),
  };
};

export const schemaContractDigest = (schema) => sha256Digest(schemaContractPayload(schema));
export const schemaArtifactDigest = (schema) => sha256Digest(schema);

const listArtifactUrls = (catalogDirectoryUrl) => {
  const directoryPath = fileURLToPath(catalogDirectoryUrl);
  if (!existsSync(directoryPath)) return [];
  return readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const schemaDirectoryUrl = new URL(`${entry.name}/`, catalogDirectoryUrl);
      return readdirSync(fileURLToPath(schemaDirectoryUrl), { withFileTypes: true })
        .filter((candidate) => candidate.isFile() && candidate.name.endsWith('.json'))
        .map((candidate) => ({
          relativePath: `${entry.name}/${candidate.name}`,
          url: new URL(candidate.name, schemaDirectoryUrl),
        }));
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
};

const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));

const readManifest = (catalogDirectoryUrl) => {
  const manifestUrl = manifestUrlFor(catalogDirectoryUrl);
  if (!existsSync(fileURLToPath(manifestUrl))) return null;
  const manifest = readJson(manifestUrl);
  if (
    manifest.manifestVersion !== SCHEMA_CATALOG_MANIFEST_VERSION ||
    manifest.contractDigestVersion !== SCHEMA_CONTRACT_DIGEST_VERSION ||
    !manifest.schemas ||
    typeof manifest.schemas !== 'object'
  ) {
    throw new Error('Le manifeste du catalogue de schémas est absent ou incompatible.');
  }
  return manifest;
};

const manifestEntryFor = (schema, relativePath) => ({
  path: relativePath,
  artifactDigest: schemaArtifactDigest(schema),
  contractDigest: schemaContractDigest(schema),
});

const sortedManifest = (schemas) => ({
  manifestVersion: SCHEMA_CATALOG_MANIFEST_VERSION,
  contractDigestVersion: SCHEMA_CONTRACT_DIGEST_VERSION,
  schemas: Object.fromEntries(Object.entries(schemas).sort(([left], [right]) => left.localeCompare(right))),
});

export const verifySchemaCatalog = (catalogDirectoryUrl) => {
  const manifest = readManifest(catalogDirectoryUrl);
  if (!manifest) throw new Error('Le manifeste firebase/schema-catalog/manifest.json est absent.');

  const artifacts = listArtifactUrls(catalogDirectoryUrl).map(({ relativePath, url }) => {
    const schema = readJson(url);
    assertValidSchemaArtifact(schema, relativePath);
    if (relativePath !== schemaRelativePath(schema)) {
      throw new Error(`Le profil ${schemaKey(schema)} est rangé sous un chemin incohérent : ${relativePath}.`);
    }
    const key = schemaKey(schema);
    const expectedEntry = manifest.schemas[key];
    if (!expectedEntry) throw new Error(`Le profil ${key} n'est pas épinglé dans le manifeste.`);
    const actualEntry = manifestEntryFor(schema, relativePath);
    if (canonicalize(expectedEntry) !== canonicalize(actualEntry)) {
      throw new Error(
        `Le profil publié ${key} a changé sans nouvelle version (${expectedEntry.artifactDigest} -> ${actualEntry.artifactDigest}).`,
      );
    }
    return { key, relativePath, schema, ...actualEntry };
  });

  const artifactKeys = new Set(artifacts.map((artifact) => artifact.key));
  const missingArtifacts = Object.keys(manifest.schemas).filter((key) => !artifactKeys.has(key));
  if (missingArtifacts.length > 0) {
    throw new Error(`Le manifeste référence des profils absents : ${missingArtifacts.join(', ')}.`);
  }
  return artifacts;
};

export const synchronizeSchemaCatalog = ({ catalogDirectoryUrl, schemas, checkOnly = false }) => {
  const publishedManifest = readManifest(catalogDirectoryUrl);
  if (!checkOnly && publishedManifest) verifySchemaCatalog(catalogDirectoryUrl);

  for (const schema of schemas) {
    assertValidSchemaArtifact(schema);
    const relativePath = schemaRelativePath(schema);
    const outputUrl = new URL(relativePath, catalogDirectoryUrl);
    const outputPath = fileURLToPath(outputUrl);
    if (existsSync(outputPath)) {
      const publishedSchema = readJson(outputUrl);
      if (canonicalize(publishedSchema) !== canonicalize(schema)) {
        throw new Error(
          `Refus d'écraser ${schemaKey(schema)} : créez une nouvelle version au lieu de modifier ${relativePath}.`,
        );
      }
    } else if (checkOnly) {
      throw new Error(`Le profil courant ${schemaKey(schema)} n'est pas exporté sous ${relativePath}.`);
    } else {
      mkdirSync(fileURLToPath(new URL(`${schema.schemaId}/`, catalogDirectoryUrl)), { recursive: true });
      writeFileSync(outputPath, `${JSON.stringify(schema, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      console.log(`Nouveau profil immuable créé : ${relativePath}.`);
    }
  }

  if (checkOnly) return verifySchemaCatalog(catalogDirectoryUrl);

  const currentManifest = publishedManifest;
  const nextEntries = { ...(currentManifest?.schemas ?? {}) };
  for (const { relativePath, url } of listArtifactUrls(catalogDirectoryUrl)) {
    const schema = readJson(url);
    assertValidSchemaArtifact(schema, relativePath);
    const key = schemaKey(schema);
    const nextEntry = manifestEntryFor(schema, relativePath);
    const currentEntry = nextEntries[key];
    if (currentEntry && canonicalize(currentEntry) !== canonicalize(nextEntry)) {
      throw new Error(`Refus de modifier l'empreinte déjà publiée de ${key}.`);
    }
    nextEntries[key] = nextEntry;
  }

  const nextManifest = sortedManifest(nextEntries);
  const manifestUrl = manifestUrlFor(catalogDirectoryUrl);
  if (!currentManifest || canonicalize(currentManifest) !== canonicalize(nextManifest)) {
    const manifestPath = fileURLToPath(manifestUrl);
    const temporaryManifestPath = `${manifestPath}.tmp-${process.pid}`;
    writeFileSync(temporaryManifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporaryManifestPath, manifestPath);
    console.log('Manifeste immuable du catalogue mis à jour.');
  }
  return verifySchemaCatalog(catalogDirectoryUrl);
};
