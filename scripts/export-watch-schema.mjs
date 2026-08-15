import { WATCH_SCHEMA } from '../src/schema/watchSchema.ts';
import { synchronizeSchemaCatalog } from './lib/schema-catalog-files.mjs';

const artifacts = synchronizeSchemaCatalog({
  catalogDirectoryUrl: new URL('../firebase/schema-catalog/', import.meta.url),
  schemas: [WATCH_SCHEMA],
  checkOnly: process.argv.includes('--check'),
});

console.log(
  `Catalogue Watch vérifié : ${artifacts.filter(({ schema }) => schema.schemaId === 'watch').length} version(s).`,
);
