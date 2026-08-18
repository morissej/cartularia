import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const assetsDirectory = resolve(root, 'dist/assets');
const sourceFile = resolve(root, 'src/App.tsx');

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
const appSource = await readFile(sourceFile, 'utf8');
const appLines = appSource.length === 0
  ? 0
  : appSource.split(/\r?\n/).length - (/\r?\n$/.test(appSource) ? 1 : 0);

const total = (items, key) => items.reduce((sum, item) => sum + item[key], 0);
const largest = [...javascript].sort((left, right) => right.bytes - left.bytes).slice(0, 5);

process.stdout.write(`${JSON.stringify({
  measuredAt: new Date().toISOString(),
  appLines,
  javascript: { files: javascript.length, bytes: total(javascript, 'bytes'), gzipBytes: total(javascript, 'gzipBytes') },
  css: { files: css.length, bytes: total(css, 'bytes'), gzipBytes: total(css, 'gzipBytes') },
  largestJavascriptAssets: largest,
}, null, 2)}\n`);
