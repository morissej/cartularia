import { CAR_SCHEMA } from '../src/schema/carSchema.ts';
import { WATCH_SCHEMA } from '../src/schema/watchSchema.ts';
import { synchronizeSchemaCatalog } from './lib/schema-catalog-files.mjs';

const schemas = [WATCH_SCHEMA, CAR_SCHEMA];
const checkOnly = process.argv.includes('--check');
const artifacts = synchronizeSchemaCatalog({
  catalogDirectoryUrl: new URL('../firebase/schema-catalog/', import.meta.url),
  schemas,
  checkOnly,
});

console.log(
  `Catalogue ${checkOnly ? 'vérifié' : 'synchronisé'} : ` +
    artifacts.map(({ key, schema }) => `${key} (${schema.fieldCount} champs)`).join(', '),
);
