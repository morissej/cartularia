import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

const sourceDirectory = path.resolve('public/assets/IWC');
const derivativeDirectory = path.join(sourceDirectory, 'derivatives');
const manifest = JSON.parse(await readFile(path.join(derivativeDirectory, 'manifest.json'), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('les 19 originaux restent identiques au manifeste PF4', async () => {
  assert.equal(manifest.images.length, 19);
  for (const image of manifest.images) {
    const bytes = await readFile(path.join(sourceDirectory, image.source));
    assert.equal(sha256(bytes), image.sourceSha256, image.source);
    assert.equal(bytes.byteLength, image.sourceBytes, image.source);
  }
});

test('chaque original possède quatre largeurs WebP et AVIF sans agrandissement', () => {
  for (const image of manifest.images) {
    assert.equal(image.derivatives.length, 8, image.source);
    const formatsByWidth = new Map();
    for (const derivative of image.derivatives) {
      assert.ok(derivative.width <= image.sourceWidth, derivative.file);
      const formats = formatsByWidth.get(derivative.width) || [];
      formats.push(derivative.format);
      formatsByWidth.set(derivative.width, formats);
    }
    assert.equal(formatsByWidth.size, 4, image.source);
    for (const formats of formatsByWidth.values()) assert.deepEqual(formats.sort(), ['avif', 'webp']);
  }
});

test('les dérivés standard restent visuellement proches des JPEG sources', async () => {
  for (const image of manifest.images) {
    const width = Math.min(768, image.sourceWidth);
    const reference = await sharp(path.join(sourceDirectory, image.source))
      .resize({ width })
      .removeAlpha()
      .raw()
      .toBuffer();
    for (const format of ['webp', 'avif']) {
      const derivative = image.derivatives.find((entry) => entry.width === width && entry.format === format);
      const actual = await sharp(path.join(derivativeDirectory, derivative.file))
        .removeAlpha()
        .raw()
        .toBuffer();
      assert.equal(actual.length, reference.length, derivative.file);
      let absoluteDifference = 0;
      for (let index = 0; index < actual.length; index += 1) {
        absoluteDifference += Math.abs(actual[index] - reference[index]);
      }
      assert.ok(absoluteDifference / actual.length < 8, `${derivative.file} diverge trop de la source`);
    }
  }
});

test('la largeur standard réduit le transfert agrégé par rapport aux originaux', () => {
  const originalBytes = manifest.images.reduce((sum, image) => sum + image.sourceBytes, 0);
  for (const format of ['webp', 'avif']) {
    const derivativeBytes = manifest.images.reduce((sum, image) => {
      const width = Math.min(768, image.sourceWidth);
      return sum + image.derivatives.find((entry) => entry.width === width && entry.format === format).bytes;
    }, 0);
    assert.ok(derivativeBytes < originalBytes * 0.6, `${format} ne réduit pas assez le transfert`);
  }
});

test('les polices ne dépendent plus d’un import CSS tardif', async () => {
  const [variables, html] = await Promise.all([
    readFile('src/styles/variables.css', 'utf8'),
    readFile('index.html', 'utf8'),
  ]);
  assert.doesNotMatch(variables, /@import\s+url\([^)]*fonts\.googleapis\.com/);
  assert.match(html, /rel="preconnect" href="https:\/\/fonts\.googleapis\.com"/);
  assert.match(html, /rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin/);
  assert.match(html, /rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2\?/);
});

test('la Galerie, le 360 et l’impression gardent des dérivés et replis explicites', async () => {
  const [galleryService, spinSource, stylesheet] = await Promise.all([
    readFile('src/services/registryGallery.ts', 'utf8'),
    readFile('src/components/Spin360.tsx', 'utf8'),
    readFile('src/index.css', 'utf8'),
  ]);
  assert.match(galleryService, /prototypePresentationUrl\(asset\.url, 1200\)/);
  assert.match(galleryService, /prototypePresentationUrl\(asset\.thumbnailUrl \|\| asset\.url, 480\)/);
  assert.match(spinSource, /\.768\.webp/);
  assert.match(stylesheet, /\.presentation-picture \{ display: contents; \}/);
  assert.match(stylesheet, /@media print/);
});
