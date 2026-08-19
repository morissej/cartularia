import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const requestedDirectory = process.argv[2] || process.env.PF6_DIST_DIR || 'dist';
const distDirectory = isAbsolute(requestedDirectory)
  ? requestedDirectory
  : resolve(root, requestedDirectory);
const assetsDirectory = resolve(distDirectory, 'assets');
const indexHtml = await readFile(resolve(distDirectory, 'index.html'), 'utf8');
const files = await readdir(assetsDirectory);
const javascript = await Promise.all(files.filter((file) => file.endsWith('.js')).map(async (file) => {
  const path = resolve(assetsDirectory, file);
  const [metadata, contents] = await Promise.all([stat(path), readFile(path)]);
  return { file, bytes: metadata.size, gzipBytes: gzipSync(contents).byteLength };
}));

const entryFile = basename(indexHtml.match(/<script[^>]+src="[^"]*\/([^/"]+\.js)"/)?.[1] || '');
const findAsset = (prefix) => javascript.find((asset) => asset.file.startsWith(prefix));
const entry = javascript.find((asset) => asset.file === entryFile);
const app = findAsset('App-');
const registry = findAsset('RegistryApp-');
const largest = [...javascript].sort((left, right) => right.bytes - left.bytes)[0];

if (!entry || !app || !registry || !largest) throw new Error('Artefacts Vite attendus introuvables. Exécutez npm run build avant la mesure.');

const baseline = { entry: 801326, app: 358349, registry: 142369 };
const budgets = { entry: 250000, app: 320000, registry: 60000, largest: 500000 };
const measured = {
  measuredAt: new Date().toISOString(),
  distDirectory,
  chunks: javascript.length,
  entry,
  app,
  registry,
  largest,
  deltas: {
    entryBytes: entry.bytes - baseline.entry,
    appBytes: app.bytes - baseline.app,
    registryBytes: registry.bytes - baseline.registry,
  },
  budgets,
};

process.stdout.write(`${JSON.stringify(measured, null, 2)}\n`);
if (entry.bytes > budgets.entry || app.bytes > budgets.app || registry.bytes > budgets.registry || largest.bytes > budgets.largest) {
  throw new Error('Un budget de performance de la vague 5 est dépassé.');
}
