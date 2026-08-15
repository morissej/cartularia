import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CAR_SCHEMA } from '../src/schema/carSchema.ts';
import { WATCH_SCHEMA } from '../src/schema/watchSchema.ts';

const schemas = [WATCH_SCHEMA, CAR_SCHEMA];

for (const schema of schemas) {
  const directoryUrl = new URL(`../firebase/schema-catalog/${schema.schemaId}/`, import.meta.url);
  const outputUrl = new URL(`../firebase/schema-catalog/${schema.schemaId}/${schema.version}.json`, import.meta.url);
  mkdirSync(fileURLToPath(directoryUrl), { recursive: true });
  writeFileSync(fileURLToPath(outputUrl), `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
  console.log(
    `Profil ${schema.schemaId}@${schema.version} exporté : ` +
      `${schema.fieldCount} postes, ${schema.sections.length} sections.`,
  );
}
