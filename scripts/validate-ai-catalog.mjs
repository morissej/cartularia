import { readFileSync } from 'node:fs';

const catalogSource = readFileSync(new URL('../src/ai/fieldCatalog.ts', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const cartularyComponentSource = readFileSync(new URL('../src/features/cartulary/components/CartularyPresentation.tsx', import.meta.url), 'utf8');
const cartularyModalSource = readFileSync(new URL('../src/features/cartulary/modals/CartularyModals.tsx', import.meta.url), 'utf8');
const uiSource = [appSource, cartularyComponentSource, cartularyModalSource].join('\n');

const collect = (source, pattern) => [...source.matchAll(pattern)].map((match) => match[1]);
const catalogIds = collect(catalogSource, /field\(\{ id: '([^']+)'/g);
const helperBindings = collect(uiSource, /aiFieldProps\(\s*'([^']+)'/g);
const componentBindings = collect(uiSource, /aiField="([^"]+)"/g);
const dynamicBindings = ['publishing.blocks.website', 'publishing.blocks.report'];
const boundIds = new Set([...helperBindings, ...componentBindings, ...dynamicBindings]);

const duplicateIds = catalogIds.filter((id, index) => catalogIds.indexOf(id) !== index);
const unknownBindings = [...boundIds].filter((id) => !catalogIds.includes(id));
const unboundDescriptors = catalogIds.filter((id) => !boundIds.has(id));
const errors = [];

if (duplicateIds.length) errors.push(`Identifiants dupliqués : ${[...new Set(duplicateIds)].join(', ')}`);
if (unknownBindings.length) errors.push(`Identifiants UI absents du catalogue : ${unknownBindings.join(', ')}`);
if (unboundDescriptors.length) errors.push(`Descripteurs sans point d’ancrage UI : ${unboundDescriptors.join(', ')}`);
if (!appSource.includes('data-ai-schema-version={AI_SCHEMA_VERSION}')) {
  errors.push('La version du schéma IA n’est pas exposée par l’interface.');
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Catalogue IA valide : ${catalogIds.length} postes, ${boundIds.size} identifiants reliés à l’interface.`);
}
