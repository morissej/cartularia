import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WATCH_SCHEMA } from '../src/schema/watchSchema.ts';

const outputUrl = new URL(`../firebase/schema-catalog/watch/${WATCH_SCHEMA.version}.json`, import.meta.url);
const outputPath = fileURLToPath(outputUrl);

mkdirSync(fileURLToPath(new URL('../firebase/schema-catalog/watch/', import.meta.url)), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(WATCH_SCHEMA, null, 2)}\n`, 'utf8');

console.log(
  `Profil ${WATCH_SCHEMA.schemaId}@${WATCH_SCHEMA.version} exporté : ` +
    `${WATCH_SCHEMA.fieldCount} postes, ${WATCH_SCHEMA.sections.length} sections.`,
);
