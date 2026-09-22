// Dérivés de présentation statiques (bundle Hosting) et catalogue client généré.
//
// Racines : chaque racine décrit un dossier public d'originaux JPEG, son dossier de sortie, ses
// largeurs et ses formats. Les dérivés sont nommés `<stem>.<largeur>.<format>` ; ils héritent du
// cache immutable de firebase.json (`/assets/**`) : un dérivé existant n'est JAMAIS réécrit sous le
// même nom (le générateur refuse et demande un renommage explicite). Un manifeste par racine
// (`<sortie>/manifest.json`, schéma v1 inchangé) sert de barrière (`--check`) et de source du
// catalogue `src/media/presentationCatalog.generated.ts`, indexé par chemin public (aucune marque,
// aucun identifiant d'objet : ADR-026/028).
//
// Usage : node scripts/generate-presentation-derivatives.mjs [--root <id>] [--check]
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const CATALOG_PATH = path.resolve('src/media/presentationCatalog.generated.ts');
export const PRESENTATION_CATALOG_VERSION = 'presentation-catalog@1';
/** Largeurs du contrat unique (K1/K8) : jamais plus large que la source, au moins la plus petite. */
export const STANDARD_WIDTHS = Object.freeze([240, 480, 768, 1200]);
export const THUMBNAIL_WIDTH = 240;

const unique = (values) => [...new Set(values)];
const boundedWidths = (widths, sourceWidth) => {
  const fitting = unique(widths).filter((width) => width <= sourceWidth).sort((left, right) => left - right);
  return fitting.length > 0 ? fitting : [Math.min(...widths)];
};

export const PRESENTATION_ROOTS = Object.freeze([
  {
    id: 'iwc',
    source: 'public/assets/IWC',
    output: 'public/assets/IWC/derivatives',
    publicPrefix: '/assets/IWC',
    recursive: false,
    // Contrat PF4 conservé à l'identique : 240/480/768 + largeur source, WebP et AVIF.
    widths: (sourceWidth) => boundedWidths([240, 480, 768, sourceWidth], sourceWidth),
    formats: ['webp', 'avif'],
  },
  {
    id: 'demo-watches',
    source: 'public/assets/demo-watches',
    output: 'public/assets/demo-watches/derivatives',
    publicPrefix: '/assets/demo-watches',
    recursive: true,
    // Démonstration : WebP seul (G11, sobriété du dépôt), largeurs du contrat unique.
    widths: (sourceWidth) => boundedWidths(STANDARD_WIDTHS, sourceWidth),
    formats: ['webp'],
  },
]);

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** Les copies locales « nom 2.ext » sont ignorées par Git et par le générateur. */
export const isIgnoredLocalCopy = (name) => / 2\./.test(name);
const isJpeg = (name) => name.toLowerCase().endsWith('.jpg');
const outputName = (relativeSource, width, format) => `${relativeSource.slice(0, -4)}.${width}.${format}`;
const manifestPath = (root) => path.join(path.resolve(root.output), 'manifest.json');
const encodedPublicPath = (prefix, relative) => `${prefix}/${relative.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`;

const encode = (root, format) => {
  const pipeline = format === 'webp'
    ? (input) => input.webp({ quality: 80, effort: 5 })
    : (input) => input.avif({ quality: 50, effort: 5 });
  return (bytes, width) => pipeline(sharp(bytes).resize({ width, withoutEnlargement: true })).toBuffer();
};

export async function listSourceFiles(root) {
  const base = path.resolve(root.source);
  const output = path.resolve(root.output);
  const files = [];
  const walk = async (directory, relativeDirectory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (root.recursive && absolute !== output) await walk(absolute, relative);
        continue;
      }
      if (entry.isFile() && isJpeg(entry.name) && !isIgnoredLocalCopy(entry.name)) files.push(relative);
    }
  };
  await walk(base, '');
  return files.sort((left, right) => left.localeCompare(right, 'en'));
}

export async function readManifest(root) {
  const file = manifestPath(root);
  if (!existsSync(file)) return { version: 1, images: [] };
  return JSON.parse(await readFile(file, 'utf8'));
}

/** Vérifie un manifeste contre le disque : originaux et dérivés intacts, dimensions et formats conformes. */
export async function checkRoot(root) {
  const manifest = await readManifest(root);
  const sourceDirectory = path.resolve(root.source);
  const outputDirectory = path.resolve(root.output);
  const expectedSources = await listSourceFiles(root);
  const listed = manifest.images.map((item) => item.source);
  const missing = expectedSources.filter((source) => !listed.includes(source));
  if (missing.length > 0) throw new Error(`${root.id} : originaux sans dérivés : ${missing.join(', ')}`);
  for (const item of manifest.images) {
    if (isIgnoredLocalCopy(item.source)) throw new Error(`${root.id} : copie locale répertoriée : ${item.source}`);
    const sourceBytes = await readFile(path.join(sourceDirectory, item.source));
    if (sha256(sourceBytes) !== item.sourceSha256) throw new Error(`Original modifié : ${item.source}`);
    const widths = root.widths(item.sourceWidth);
    const expectedFiles = widths.flatMap((width) => root.formats.map((format) => outputName(item.source, width, format)));
    const actualFiles = item.derivatives.map((derivative) => derivative.file);
    if (JSON.stringify([...expectedFiles].sort()) !== JSON.stringify([...actualFiles].sort())) {
      throw new Error(`${root.id} : jeu de dérivés incomplet pour ${item.source}`);
    }
    for (const derivative of item.derivatives) {
      if (isIgnoredLocalCopy(derivative.file)) throw new Error(`${root.id} : copie locale répertoriée : ${derivative.file}`);
      const bytes = await readFile(path.join(outputDirectory, derivative.file));
      if (sha256(bytes) !== derivative.sha256) throw new Error(`Dérivé modifié : ${derivative.file}`);
      if (bytes.byteLength !== derivative.bytes) throw new Error(`Taille de dérivé incohérente : ${derivative.file}`);
      const metadata = await sharp(bytes).metadata();
      const decodedFormat = derivative.format === 'avif' ? 'heif' : derivative.format;
      if (metadata.width !== derivative.width || metadata.height !== derivative.height || metadata.format !== decodedFormat) {
        throw new Error(`Dérivé invalide : ${derivative.file}`);
      }
    }
  }
  return manifest;
}

/**
 * Génère les dérivés manquants d'une racine sans jamais réécrire un fichier existant : un dérivé
 * déjà répertorié et intact est réutilisé tel quel ; un fichier présent mais absent du manifeste
 * ou différent de celui-ci fait échouer la génération (cache immutable : renommer, ne pas écraser).
 */
export async function generateRoot(root, { log = () => undefined } = {}) {
  const sourceDirectory = path.resolve(root.source);
  const outputDirectory = path.resolve(root.output);
  await mkdir(outputDirectory, { recursive: true });
  const previous = await readManifest(root);
  const previousBySource = new Map(previous.images.map((item) => [item.source, item]));
  const images = [];
  let generated = 0;
  let reused = 0;
  for (const relativeSource of await listSourceFiles(root)) {
    const sourceBytes = await readFile(path.join(sourceDirectory, relativeSource));
    const sourceSha256 = sha256(sourceBytes);
    const metadata = await sharp(sourceBytes).metadata();
    if (!metadata.width || !metadata.height) throw new Error(`Dimensions absentes : ${relativeSource}`);
    const known = previousBySource.get(relativeSource);
    const knownDerivatives = new Map((known?.sourceSha256 === sourceSha256 ? known.derivatives : []).map((derivative) => [derivative.file, derivative]));
    const derivatives = [];
    for (const width of root.widths(metadata.width)) {
      for (const format of root.formats) {
        const file = outputName(relativeSource, width, format);
        const outputPath = path.join(outputDirectory, file);
        const listed = knownDerivatives.get(file);
        if (existsSync(outputPath)) {
          const existing = await readFile(outputPath);
          if (!listed || sha256(existing) !== listed.sha256) {
            throw new Error(`${root.id} : ${file} existe déjà et ne correspond pas au manifeste ; un dérivé n'est jamais réécrit sous le même nom (cache immutable), renommez la source ou le dérivé.`);
          }
          derivatives.push({ ...listed });
          reused += 1;
          continue;
        }
        if (known && known.sourceSha256 !== sourceSha256 && known.derivatives.some((derivative) => derivative.file === file)) {
          throw new Error(`${root.id} : l'original ${relativeSource} a changé alors que ${file} est déjà publié ; renommez l'original.`);
        }
        await mkdir(path.dirname(outputPath), { recursive: true });
        const bytes = await encode(root, format)(sourceBytes, width);
        await writeFile(outputPath, bytes, { flag: 'wx' });
        const outputMetadata = await sharp(bytes).metadata();
        derivatives.push({ file, format, width: outputMetadata.width, height: outputMetadata.height, bytes: bytes.byteLength, sha256: sha256(bytes) });
        generated += 1;
        log(`  + ${file} (${bytes.byteLength} o)`);
      }
    }
    images.push({ source: relativeSource, sourceWidth: metadata.width, sourceHeight: metadata.height, sourceBytes: sourceBytes.byteLength, sourceSha256, derivatives });
  }
  const manifest = { version: 1, images };
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  const current = existsSync(manifestPath(root)) ? await readFile(manifestPath(root), 'utf8') : null;
  if (current !== serialized) await writeFile(manifestPath(root), serialized);
  return { manifest, generated, reused, manifestWritten: current !== serialized };
}

/** Entrées du catalogue client pour une racine : clé = chemin public décodé de l'original. */
export function catalogEntriesFor(root, manifest) {
  const entries = [];
  for (const item of manifest.images) {
    const stem = item.source.slice(0, -4);
    const widths = unique(item.derivatives.map((derivative) => derivative.width)).sort((left, right) => left - right);
    const formats = unique(item.derivatives.map((derivative) => derivative.format)).sort();
    const thumbnailWidth = widths[0];
    const thumbnail = item.derivatives.find((derivative) => derivative.width === thumbnailWidth && derivative.format === 'webp');
    if (!thumbnail) throw new Error(`${root.id} : vignette WebP absente pour ${item.source}`);
    entries.push([`${root.publicPrefix}/${item.source}`, {
      width: item.sourceWidth,
      height: item.sourceHeight,
      base: encodedPublicPath(`${root.publicPrefix}/${path.posix.basename(root.output)}`, stem),
      formats,
      variants: widths.map((width) => {
        const derivative = item.derivatives.find((candidate) => candidate.width === width && candidate.format === 'webp');
        return { width, height: derivative.height };
      }),
      thumbnail: { width: thumbnail.width, height: thumbnail.height, sha256: thumbnail.sha256 },
    }]);
  }
  return entries;
}

export function renderCatalog(entries) {
  const sorted = [...entries].sort(([left], [right]) => left.localeCompare(right, 'en'));
  const lines = sorted.map(([key, entry]) => {
    const variants = entry.variants.map((variant) => `{ width: ${variant.width}, height: ${variant.height} }`).join(', ');
    const formats = entry.formats.map((format) => `'${format}'`).join(', ');
    return `  ${JSON.stringify(key)}: { width: ${entry.width}, height: ${entry.height}, base: ${JSON.stringify(entry.base)}, formats: [${formats}], variants: [${variants}], thumbnail: { width: ${entry.thumbnail.width}, height: ${entry.thumbnail.height}, sha256: '${entry.thumbnail.sha256}' } },`;
  });
  return [
    '// Fichier généré par scripts/generate-presentation-derivatives.mjs — ne pas modifier à la main.',
    '// Catalogue des dérivés statiques du bundle, indexé par chemin public de l’original (décodé).',
    "// Aucune marque ni identifiant d'objet : seuls des chemins de fichiers (ADR-026/028).",
    `export const PRESENTATION_CATALOG_VERSION = '${PRESENTATION_CATALOG_VERSION}';`,
    '',
    'export type PresentationCatalogFormat = \'avif\' | \'webp\';',
    '',
    'export interface PresentationCatalogEntry {',
    '  /** Dimensions intrinsèques de l’original. */',
    '  readonly width: number;',
    '  readonly height: number;',
    '  /** Chemin public du dérivé sans `.<largeur>.<format>`, segments encodés. */',
    '  readonly base: string;',
    '  readonly formats: readonly PresentationCatalogFormat[];',
    '  readonly variants: readonly { readonly width: number; readonly height: number }[];',
    '  /** Plus petite variante WebP (vignette de bundle des projections Registre). */',
    '  readonly thumbnail: { readonly width: number; readonly height: number; readonly sha256: string };',
    '}',
    '',
    'export const PRESENTATION_CATALOG: Readonly<Record<string, PresentationCatalogEntry>> = {',
    ...lines,
    '};',
    '',
  ].join('\n');
}

export async function buildCatalogSource(roots = PRESENTATION_ROOTS) {
  const entries = [];
  for (const root of roots) entries.push(...catalogEntriesFor(root, await readManifest(root)));
  return renderCatalog(entries);
}

const parseArguments = (argv) => {
  const check = argv.includes('--check');
  const rootIndex = argv.indexOf('--root');
  const rootId = rootIndex >= 0 ? argv[rootIndex + 1] : null;
  const unknown = argv.filter((argument, index) => !['--check', '--root'].includes(argument) && !(index === rootIndex + 1 && rootIndex >= 0));
  if (unknown.length > 0) throw new Error(`Option inconnue : ${unknown.join(' ')}`);
  const roots = rootId ? PRESENTATION_ROOTS.filter((root) => root.id === rootId) : [...PRESENTATION_ROOTS];
  if (roots.length === 0) throw new Error(`Racine inconnue : ${rootId}`);
  return { check, roots };
};

export async function main(argv = process.argv.slice(2)) {
  const { check, roots } = parseArguments(argv);
  if (check) {
    for (const root of roots) {
      const manifest = await checkRoot(root);
      console.log(`Dérivés vérifiés (${root.id}) : ${manifest.images.length} originaux, ${manifest.images.flatMap((item) => item.derivatives).length} fichiers.`);
    }
    const expected = await buildCatalogSource();
    const actual = existsSync(CATALOG_PATH) ? await readFile(CATALOG_PATH, 'utf8') : '';
    if (expected !== actual) throw new Error(`Catalogue périmé : relancez node scripts/generate-presentation-derivatives.mjs (${path.relative(process.cwd(), CATALOG_PATH)}).`);
    console.log('Catalogue client à jour.');
    return;
  }
  for (const root of roots) {
    const result = await generateRoot(root, { log: (line) => console.log(line) });
    console.log(`Dérivés (${root.id}) : ${result.manifest.images.length} originaux, ${result.generated} générés, ${result.reused} réutilisés, manifeste ${result.manifestWritten ? 'écrit' : 'inchangé'}.`);
  }
  const catalog = await buildCatalogSource();
  const current = existsSync(CATALOG_PATH) ? await readFile(CATALOG_PATH, 'utf8') : null;
  if (current !== catalog) await writeFile(CATALOG_PATH, catalog);
  console.log(`Catalogue client ${current !== catalog ? 'écrit' : 'inchangé'} : ${path.relative(process.cwd(), CATALOG_PATH)}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
