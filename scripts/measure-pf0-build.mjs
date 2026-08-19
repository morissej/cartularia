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

const assets = await Promise.all(files
  .filter((file) => /\.(js|css)$/.test(file))
  .map(async (file) => {
    const path = resolve(assetsDirectory, file);
    const [metadata, contents] = await Promise.all([stat(path), readFile(path)]);
    return { file, bytes: metadata.size, gzipBytes: gzipSync(contents).byteLength };
  }));

const javascript = assets.filter((asset) => asset.file.endsWith('.js'));
const css = assets.filter((asset) => asset.file.endsWith('.css'));
const entryFile = indexHtml.match(/<script[^>]+src="[^"]*\/([^/"]+\.js)"/)?.[1] || '';
const findAsset = (prefix) => javascript.find((asset) => asset.file.startsWith(prefix));
const total = (items, key) => items.reduce((sum, item) => sum + item[key], 0);
const entry = javascript.find((asset) => asset.file === entryFile);
const app = findAsset('App-');
const registry = findAsset('RegistryApp-');
const largest = [...javascript].sort((left, right) => right.bytes - left.bytes)[0];

if (!entry || !app || !registry || !largest) {
  throw new Error(`Artefacts PF0 attendus introuvables dans ${distDirectory}.`);
}

const budgets = {
  entry: 250_000,
  app: 320_000,
  registry: 60_000,
  largest: 500_000,
};
const checks = {
  entry: entry.bytes <= budgets.entry,
  app: app.bytes <= budgets.app,
  registry: registry.bytes <= budgets.registry,
  largest: largest.bytes <= budgets.largest,
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
  entry,
  app,
  registry,
  largest,
  budgets,
  checks,
}, null, 2)}\n`);

if (Object.values(checks).includes(false)) {
  throw new Error('Un budget statique PF0 est dépassé.');
}
