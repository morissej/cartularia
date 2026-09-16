// PF0 — budgets statiques du build (dist/), sans navigateur. V7 (V-B2, décisions D6 et D7) : le budget « entrée » seul ne verrait plus
// React (morceau react-*.js préchargé par index.html) : `initial` = script d'entrée + tous les modulepreload de index.html ; contrôles du
// découpage (≤ 65 morceaux JS, exactement un icons-*.js n'important que react-*/rolldown-runtime-*, un seul fichier portant des définitions
// d'icônes lucide, exactement un react-*.js préchargé) et de la livraison (0 copie numérotée « nom N.ext » sous dist/, récursif).
// Rattaché à verify:v7 ; sortie JSON, échec (throw) au premier budget dépassé. Usage : node scripts/measure-pf0-build.mjs [dist]
import { readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const requestedDirectory = process.argv[2] || process.env.PF0_DIST_DIR || 'dist';
const distDirectory = isAbsolute(requestedDirectory)
  ? requestedDirectory
  : resolve(root, requestedDirectory);
const assetsDirectory = resolve(distDirectory, 'assets');
const indexHtml = await readFile(resolve(distDirectory, 'index.html'), 'utf8');
const files = await readdir(assetsDirectory);

// Copies numérotées (« nom N.ext », synchronisation de poste) : comptées à part sur tout dist/, jamais dans l'anatomie.
const NUMBERED_COPY = / \d+\.[^/]+$/;
const countNumberedCopies = async (directory) => {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) count += await countNumberedCopies(resolve(directory, entry.name));
    else if (NUMBERED_COPY.test(entry.name)) count += 1;
  }
  return count;
};

const assets = await Promise.all(files
  .filter((file) => /\.(js|css)$/.test(file) && !NUMBERED_COPY.test(file))
  .map(async (file) => {
    const path = resolve(assetsDirectory, file);
    const [metadata, contents] = await Promise.all([stat(path), readFile(path)]);
    return { file, bytes: metadata.size, gzipBytes: gzipSync(contents).byteLength, source: contents.toString('utf8') };
  }));

const javascript = assets.filter((asset) => asset.file.endsWith('.js'));
const css = assets.filter((asset) => asset.file.endsWith('.css'));
const entryFile = indexHtml.match(/<script[^>]+src="[^"]*\/([^/"]+\.js)"/)?.[1] || '';
const modulepreloadFiles = [...indexHtml.matchAll(/<link rel="modulepreload"[^>]*href="[^"]*\/([^/"]+\.js)"/g)].map((match) => match[1]);
const findAsset = (prefix) => javascript.find((asset) => asset.file.startsWith(prefix));
const total = (items, key) => items.reduce((sum, item) => sum + item[key], 0);
const describe = ({ file, bytes, gzipBytes }) => ({ file, bytes, gzipBytes });
const entry = javascript.find((asset) => asset.file === entryFile);
const app = findAsset('App-');
const registry = findAsset('RegistryApp-');
const largest = [...javascript].sort((left, right) => right.bytes - left.bytes)[0];

if (!entry || !app || !registry || !largest) {
  throw new Error(`Artefacts PF0 attendus introuvables dans ${distDirectory}.`);
}

// V7 : ce que le navigateur charge avant tout code applicatif = entrée + modulepreload (runtime rolldown, react).
const initialAssets = [entry, ...modulepreloadFiles.map((file) => javascript.find((asset) => asset.file === file)).filter(Boolean)];
const initial = { files: initialAssets.map((asset) => asset.file), bytes: total(initialAssets, 'bytes'), gzipBytes: total(initialAssets, 'gzipBytes') };
// Groupes de vite.config.ts : un seul morceau react-*.js (préchargé par index.html), un seul icons-*.js dont les imports statiques
// se limitent au groupe react et au runtime rolldown (sinon React ou l'entrée seraient aspirés dans le groupe des icônes).
const reactChunks = javascript.filter((asset) => /^react-[^.]+\.js$/.test(asset.file));
const iconChunks = javascript.filter((asset) => /^icons-[^.]+\.js$/.test(asset.file));
const iconChunkImports = iconChunks.flatMap((asset) => [...asset.source.matchAll(/from"\.\/([^"]+)"/g)].map((match) => match[1]));
// Signature d'une définition d'icône lucide (createLucideIcon(`nom`, [[`path`, {...}]])) : ne doit apparaître que dans icons-*.js.
const ICON_DEFINITION = /\(`[a-z0-9-]+`,\[\[`(?:path|circle|rect|line|polyline|polygon|ellipse)`,\{/;
const iconDefinitionFiles = javascript.filter((asset) => ICON_DEFINITION.test(asset.source)).map((asset) => asset.file);
const numberedCopies = await countNumberedCopies(distDirectory);
// Informatif (V-B5, budget posé par tests/fonts-contract.test.mjs) : polices livrées avec le site.
const woff2 = files.filter((file) => file.endsWith('.woff2') && !NUMBERED_COPY.test(file)).length;

const budgets = {
  entry: 250_000,
  initial: 250_000,
  // V7 (D6) : 320 000 dépassé depuis V3 (features/cartulary, 330 028 o le 15 septembre 2026, hors de toute barrière) ; relevé à 340 000 o
  // et 92 000 o gzip (mesuré 327 838 / 88 597 après regroupement des icônes le 16 septembre 2026), rattaché à verify:v7.
  app: 340_000,
  appGzip: 92_000,
  registry: 60_000,
  largest: 500_000,
  javascriptFiles: 65,
  icons: 40_000,
};
const checks = {
  entry: entry.bytes <= budgets.entry,
  initial: initial.bytes <= budgets.initial,
  app: app.bytes <= budgets.app,
  appGzip: app.gzipBytes <= budgets.appGzip,
  registry: registry.bytes <= budgets.registry,
  largest: largest.bytes <= budgets.largest,
  javascriptFiles: javascript.length <= budgets.javascriptFiles,
  reactChunk: reactChunks.length === 1 && modulepreloadFiles.includes(reactChunks[0].file),
  iconsChunk: iconChunks.length === 1 && iconChunks[0].bytes <= budgets.icons,
  iconsImports: iconChunkImports.every((file) => /^(?:react|rolldown-runtime)-/.test(file)),
  iconDefinitionFiles: iconDefinitionFiles.length === 1 && iconChunks.some((asset) => asset.file === iconDefinitionFiles[0]),
  numberedCopies: numberedCopies === 0,
};

process.stdout.write(`${JSON.stringify({
  measuredAt: new Date().toISOString(),
  distDirectory,
  javascript: {
    files: javascript.length,
    bytes: total(javascript, 'bytes'),
    gzipBytes: total(javascript, 'gzipBytes'),
  },
  css: {
    files: css.length,
    bytes: total(css, 'bytes'),
    gzipBytes: total(css, 'gzipBytes'),
  },
  entry: describe(entry),
  initial,
  app: describe(app),
  registry: describe(registry),
  largest: describe(largest),
  react: reactChunks.map(describe),
  icons: iconChunks.map((asset) => ({ ...describe(asset), imports: iconChunkImports })),
  iconDefinitionFiles,
  numberedCopies,
  fonts: { woff2 },
  budgets,
  checks,
}, null, 2)}\n`);

if (Object.values(checks).includes(false)) {
  throw new Error('Un budget statique PF0 est dépassé.');
}
