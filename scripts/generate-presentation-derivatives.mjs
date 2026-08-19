import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const SOURCE_DIRECTORY = path.resolve('public/assets/IWC');
const OUTPUT_DIRECTORY = path.join(SOURCE_DIRECTORY, 'derivatives');
const MANIFEST_PATH = path.join(OUTPUT_DIRECTORY, 'manifest.json');
const CHECK_ONLY = process.argv.includes('--check');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const widthsFor = (sourceWidth) => [...new Set([240, 480, 768, sourceWidth])]
  .filter((width) => width <= sourceWidth);
const outputName = (filename, width, format) => `${filename.slice(0, -4)}.${width}.${format}`;

const sourceFiles = (await readdir(SOURCE_DIRECTORY, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.jpg'))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right, 'en'));

if (CHECK_ONLY) {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  for (const item of manifest.images) {
    const sourceBytes = await readFile(path.join(SOURCE_DIRECTORY, item.source));
    if (sha256(sourceBytes) !== item.sourceSha256) throw new Error(`Original modifié : ${item.source}`);
    for (const derivative of item.derivatives) {
      const derivativePath = path.join(OUTPUT_DIRECTORY, derivative.file);
      const bytes = await readFile(derivativePath);
      const metadata = await sharp(bytes).metadata();
      if (sha256(bytes) !== derivative.sha256) throw new Error(`Dérivé modifié : ${derivative.file}`);
      const decodedFormat = derivative.format === 'avif' ? 'heif' : derivative.format;
      if (metadata.width !== derivative.width || metadata.format !== decodedFormat) {
        throw new Error(`Dérivé invalide : ${derivative.file}`);
      }
    }
  }
  console.log(`Dérivés vérifiés : ${manifest.images.length} originaux, ${manifest.images.flatMap((item) => item.derivatives).length} fichiers.`);
  process.exit(0);
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
const images = [];
for (const filename of sourceFiles) {
  const sourcePath = path.join(SOURCE_DIRECTORY, filename);
  const sourceBytes = await readFile(sourcePath);
  const metadata = await sharp(sourceBytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`Dimensions absentes : ${filename}`);
  const derivatives = [];
  for (const width of widthsFor(metadata.width)) {
    for (const format of ['webp', 'avif']) {
      const file = outputName(filename, width, format);
      const outputPath = path.join(OUTPUT_DIRECTORY, file);
      let pipeline = sharp(sourceBytes).resize({ width, withoutEnlargement: true });
      pipeline = format === 'webp'
        ? pipeline.webp({ quality: 80, effort: 5 })
        : pipeline.avif({ quality: 50, effort: 5 });
      const bytes = await pipeline.toFile(outputPath).then(() => readFile(outputPath));
      const outputMetadata = await sharp(bytes).metadata();
      derivatives.push({
        file,
        format,
        width: outputMetadata.width,
        height: outputMetadata.height,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
      });
    }
  }
  images.push({
    source: filename,
    sourceWidth: metadata.width,
    sourceHeight: metadata.height,
    sourceBytes: sourceBytes.byteLength,
    sourceSha256: sha256(sourceBytes),
    derivatives,
  });
}

await writeFile(MANIFEST_PATH, `${JSON.stringify({ version: 1, images }, null, 2)}\n`);
console.log(`Dérivés générés : ${images.length} originaux, ${images.flatMap((item) => item.derivatives).length} fichiers.`);
