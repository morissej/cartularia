import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  CATALOG_PATH, PRESENTATION_ROOTS, STANDARD_WIDTHS, buildCatalogSource, catalogEntriesFor, checkRoot, generateRoot, isIgnoredLocalCopy, listSourceFiles, renderCatalog,
} from '../scripts/generate-presentation-derivatives.mjs';
import { PRESENTATION_CATALOG } from '../src/media/presentationCatalog.generated.ts';
import { presentationBundleThumbnailFor, presentationDerivativeUrl, presentationImageSetFor } from '../src/media/presentationDerivatives.ts';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const rootById = (id) => PRESENTATION_ROOTS.find((root) => root.id === id);
const manifestOf = async (id) => JSON.parse(await readFile(path.join(path.resolve(rootById(id).output), 'manifest.json'), 'utf8'));
const iwc = await manifestOf('iwc');
const demo = await manifestOf('demo-watches');
const walk = async (directory) => (await readdir(directory, { withFileTypes: true, recursive: true })).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));

test('les 19 originaux IWC restent identiques au manifeste PF4, sans copie locale « 2. »', async () => {
  assert.equal(iwc.version, 1);
  assert.equal(iwc.images.length, 19);
  for (const image of iwc.images) {
    const bytes = await readFile(path.join(path.resolve(rootById('iwc').source), image.source));
    assert.equal(sha256(bytes), image.sourceSha256, image.source);
    assert.equal(bytes.byteLength, image.sourceBytes, image.source);
    assert.equal(image.derivatives.length, 8, image.source);
    assert.ok(image.derivatives.every((derivative) => !isIgnoredLocalCopy(derivative.file)));
  }
  assert.deepEqual(await listSourceFiles(rootById('iwc')), iwc.images.map((image) => image.source));
});

test('chaque original IWC possède quatre largeurs WebP et AVIF sans agrandissement', () => {
  for (const image of iwc.images) {
    const formatsByWidth = new Map();
    for (const derivative of image.derivatives) {
      assert.ok(derivative.width <= image.sourceWidth, derivative.file);
      formatsByWidth.set(derivative.width, [...(formatsByWidth.get(derivative.width) || []), derivative.format]);
    }
    assert.equal(formatsByWidth.size, 4, image.source);
    for (const formats of formatsByWidth.values()) assert.deepEqual(formats.sort(), ['avif', 'webp']);
  }
});

test('la démonstration publie ses 29 originaux en WebP seul, aux largeurs du contrat unique, sans agrandissement ni copie locale', async () => {
  const root = rootById('demo-watches');
  assert.equal(demo.version, 1);
  assert.equal(demo.images.length, 29);
  assert.deepEqual(await listSourceFiles(root), demo.images.map((image) => image.source));
  for (const image of demo.images) {
    assert.ok(!isIgnoredLocalCopy(image.source));
    const expectedWidths = STANDARD_WIDTHS.filter((width) => width <= image.sourceWidth);
    assert.deepEqual(image.derivatives.map((derivative) => derivative.width), expectedWidths, image.source);
    assert.ok(image.derivatives.every((derivative) => derivative.format === 'webp' && derivative.file.endsWith('.webp') && !isIgnoredLocalCopy(derivative.file)), image.source);
    assert.ok(image.derivatives.every((derivative) => derivative.file.startsWith(`${path.posix.dirname(image.source)}/`)), 'un sous-dossier par objet');
  }
  const files = (await walk(path.resolve(root.output))).map((file) => path.relative(path.resolve(root.output), file));
  assert.ok(files.every((file) => file === 'manifest.json' || file.endsWith('.webp')), 'aucun AVIF ni autre format dans la racine démo');
  assert.equal(files.filter((file) => file.endsWith('.webp')).length, demo.images.flatMap((image) => image.derivatives).length);
});

test('poids des dérivés démo : vignettes légères, transfert agrégé réduit, cinq couvertures 240 sous 40 ko', () => {
  const ceilings = { 240: 12_000, 480: 40_000, 768: 80_000, 1200: 160_000 };
  let covers = 0;
  for (const image of demo.images) {
    for (const derivative of image.derivatives) assert.ok(derivative.bytes < ceilings[derivative.width], `${derivative.file} pèse ${derivative.bytes} o`);
    if (image.source.endsWith('/main.jpg')) covers += image.derivatives.find((derivative) => derivative.width === 240).bytes;
  }
  assert.equal(demo.images.filter((image) => image.source.endsWith('/main.jpg')).length, 5);
  assert.ok(covers < 40_000, `couvertures 240 : ${covers} o`);
  const originalBytes = demo.images.reduce((sum, image) => sum + image.sourceBytes, 0);
  const standardBytes = demo.images.reduce((sum, image) => sum + image.derivatives.find((derivative) => derivative.width === Math.min(768, image.sourceWidth)).bytes, 0);
  assert.ok(standardBytes < originalBytes * 0.4, 'la largeur 768 ne réduit pas assez le transfert');
  const total = demo.images.flatMap((image) => image.derivatives).reduce((sum, derivative) => sum + derivative.bytes, 0);
  assert.ok(total < 3_500_000, `poids ajouté au dépôt : ${total} o (G11)`);
});

test('les dérivés standard restent visuellement proches des JPEG sources (IWC et démonstration)', async () => {
  for (const [id, manifest] of [['iwc', iwc], ['demo-watches', demo]]) {
    const root = rootById(id);
    for (const image of manifest.images) {
      const width = Math.min(768, image.sourceWidth);
      const reference = await sharp(path.join(path.resolve(root.source), image.source)).resize({ width }).removeAlpha().raw().toBuffer();
      for (const format of root.formats) {
        const derivative = image.derivatives.find((entry) => entry.width === width && entry.format === format);
        const actual = await sharp(path.join(path.resolve(root.output), derivative.file)).removeAlpha().raw().toBuffer();
        assert.equal(actual.length, reference.length, derivative.file);
        let absoluteDifference = 0;
        for (let index = 0; index < actual.length; index += 1) absoluteDifference += Math.abs(actual[index] - reference[index]);
        assert.ok(absoluteDifference / actual.length < 8, `${derivative.file} diverge trop de la source`);
      }
    }
  }
});

test('la largeur standard IWC réduit le transfert agrégé par rapport aux originaux', () => {
  const originalBytes = iwc.images.reduce((sum, image) => sum + image.sourceBytes, 0);
  for (const format of ['webp', 'avif']) {
    const derivativeBytes = iwc.images.reduce((sum, image) => sum + image.derivatives.find((entry) => entry.width === Math.min(768, image.sourceWidth) && entry.format === format).bytes, 0);
    assert.ok(derivativeBytes < originalBytes * 0.6, `${format} ne réduit pas assez le transfert`);
  }
});

test('le catalogue client généré est exactement le recalcul depuis les manifestes (garde de dérive)', async () => {
  assert.equal(await readFile(CATALOG_PATH, 'utf8'), await buildCatalogSource());
  assert.equal(Object.keys(PRESENTATION_CATALOG).length, iwc.images.length + demo.images.length);
  for (const [key, entry] of Object.entries(PRESENTATION_CATALOG)) {
    assert.ok(key.startsWith('/assets/') && key.endsWith('.jpg'), key);
    assert.ok(!/IWC|rolex|submariner/i.test(JSON.stringify(entry).replace(entry.base, '')), 'seuls des chemins portent une identité');
    assert.equal(entry.variants[0].width, entry.thumbnail.width);
    assert.match(entry.thumbnail.sha256, /^[a-f0-9]{64}$/);
  }
  for (const [id, manifest] of [['iwc', iwc], ['demo-watches', demo]]) {
    const root = rootById(id);
    for (const [key, entry] of catalogEntriesFor(root, manifest)) {
      const thumbnail = presentationBundleThumbnailFor(key);
      const file = path.join(path.resolve(root.output), decodeURIComponent(thumbnail.path.slice(`${root.publicPrefix}/derivatives/`.length)));
      assert.equal(sha256(await readFile(file)), entry.thumbnail.sha256, `vignette ${thumbnail.path}`);
      assert.equal(thumbnail.sha256, entry.thumbnail.sha256);
    }
  }
});

test('les URL de présentation correspondent aux vrais dérivés IWC et démo et conservent les autres sources', () => {
  for (const image of iwc.images) {
    const source = `/assets/IWC/${encodeURIComponent(image.source)}`;
    const derivative = image.derivatives.find((entry) => entry.width === 768 && entry.format === 'webp');
    assert.equal(presentationDerivativeUrl(source, 768), `/assets/IWC/derivatives/${encodeURIComponent(derivative.file)}`);
    const picture = presentationImageSetFor(source);
    assert.equal(picture.source, source, 'le JPEG original reste le repli');
    assert.equal(picture.width, image.sourceWidth);
    assert.ok(picture.webpSrcSet.includes(`${presentationDerivativeUrl(source, 768)} 768w`));
    assert.ok(picture.avifSrcSet.includes('.240.avif 240w'));
  }
  for (const image of demo.images) {
    const source = `/assets/demo-watches/${image.source}`;
    const largest = image.derivatives.at(-1);
    assert.equal(presentationDerivativeUrl(source, 768), `/assets/demo-watches/derivatives/${image.derivatives.find((entry) => entry.width === 768).file}`);
    assert.equal(presentationDerivativeUrl(source, 4000), `/assets/demo-watches/derivatives/${largest.file}`, 'jamais plus large que la source');
    assert.equal(presentationDerivativeUrl(source, 768, 'avif'), presentationDerivativeUrl(source, 768), 'AVIF absent : WebP');
    const picture = presentationImageSetFor(source);
    assert.equal(picture.avifSrcSet, '');
    assert.equal(picture.webpSrcSet.split(', ').length, image.derivatives.length);
    assert.equal(picture.width, image.sourceWidth);
    assert.equal(picture.height, image.sourceHeight);
  }
  for (const source of ['/assets/autre.jpg', '/assets/IWC/inconnu.jpg', '/assets/IWC/%broken.jpg', 'blob:protected-media', 'https://example.test/media.webp', '//assets/IWC/_DSC0975-3.jpg', 'private-drafts/uid/originals/x']) {
    assert.equal(presentationDerivativeUrl(source, 768), source);
    assert.equal(presentationImageSetFor(source), null);
    assert.equal(presentationBundleThumbnailFor(source), null);
  }
});

test('le générateur est idempotent, ignore les copies « 2. » et ne réécrit jamais un dérivé sous le même nom', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cartularia-derivatives-'));
  try {
    const source = path.join(directory, 'source');
    await mkdir(path.join(source, 'objet'), { recursive: true });
    const jpeg = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 120, g: 90, b: 60 } } }).jpeg({ quality: 85 }).toBuffer();
    await writeFile(path.join(source, 'objet', 'vue.jpg'), jpeg);
    await writeFile(path.join(source, 'objet', 'vue 2.jpg'), jpeg);
    await writeFile(path.join(source, 'objet', 'notice.txt'), 'texte');
    const root = { id: 'fixture', source, output: path.join(source, 'derivatives'), publicPrefix: '/assets/fixture', recursive: true, widths: (width) => STANDARD_WIDTHS.filter((candidate) => candidate <= width).length ? STANDARD_WIDTHS.filter((candidate) => candidate <= width) : [240], formats: ['webp'] };
    assert.deepEqual(await listSourceFiles(root), ['objet/vue.jpg']);
    const first = await generateRoot(root);
    assert.deepEqual({ generated: first.generated, reused: first.reused, manifestWritten: first.manifestWritten }, { generated: 1, reused: 0, manifestWritten: true });
    assert.deepEqual(first.manifest.images[0].derivatives.map((derivative) => derivative.file), ['objet/vue.240.webp']);
    const bytes = await readFile(path.join(source, 'derivatives', 'objet', 'vue.240.webp'));
    const metadata = await sharp(bytes).metadata();
    assert.deepEqual([metadata.format, metadata.width, metadata.height], ['webp', 240, 160]);
    const second = await generateRoot(root);
    assert.deepEqual({ generated: second.generated, reused: second.reused, manifestWritten: second.manifestWritten }, { generated: 0, reused: 1, manifestWritten: false });
    assert.deepEqual(second.manifest, first.manifest);
    await checkRoot(root);
    const [[key, entry]] = catalogEntriesFor(root, second.manifest);
    assert.equal(key, '/assets/fixture/objet/vue.jpg');
    assert.equal(entry.base, '/assets/fixture/derivatives/objet/vue');
    assert.deepEqual(entry.variants, [{ width: 240, height: 160 }]);
    assert.equal(entry.thumbnail.sha256, sha256(bytes));
    assert.ok(renderCatalog([[key, entry]]).includes(`"${key}": { width: 300, height: 200, base: "/assets/fixture/derivatives/objet/vue", formats: ['webp'], variants: [{ width: 240, height: 160 }]`));
    assert.equal(renderCatalog([[key, entry], ['/assets/fixture/a.jpg', entry]]).indexOf('/assets/fixture/a.jpg') < renderCatalog([[key, entry], ['/assets/fixture/a.jpg', entry]]).indexOf(key), true, 'catalogue trié');

    // Fichier présent mais différent du manifeste : refus, jamais d'écrasement (cache immutable).
    await writeFile(path.join(source, 'derivatives', 'objet', 'vue.240.webp'), Buffer.concat([bytes, Buffer.from([0])]));
    await assert.rejects(generateRoot(root), /jamais réécrit sous le même nom/);
    await assert.rejects(checkRoot(root), /Dérivé modifié/);
    await writeFile(path.join(source, 'derivatives', 'objet', 'vue.240.webp'), bytes);
    // Original modifié alors que son dérivé est publié : refus explicite.
    await writeFile(path.join(source, 'objet', 'vue.jpg'), await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 10, g: 200, b: 60 } } }).jpeg().toBuffer());
    await assert.rejects(checkRoot(root), /Original modifié/);
    await assert.rejects(generateRoot(root), /ne correspond pas au manifeste|renommez/);
    await writeFile(path.join(source, 'objet', 'vue.jpg'), jpeg);
    // Nouvel original : seul le manquant est produit.
    await writeFile(path.join(source, 'objet', 'autre.jpg'), await sharp({ create: { width: 100, height: 50, channels: 3, background: '#888' } }).jpeg().toBuffer());
    const third = await generateRoot(root);
    assert.deepEqual({ generated: third.generated, reused: third.reused }, { generated: 1, reused: 1 });
    assert.deepEqual(third.manifest.images.map((image) => image.source), ['objet/autre.jpg', 'objet/vue.jpg']);
    assert.deepEqual(third.manifest.images[0].derivatives.map(({ file, width }) => [file, width]), [['objet/autre.240.webp', 100]], 'au moins la plus petite, sans agrandissement');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// PF4 : l'@import Google tardif est parti de variables.css ; V7 (V-B5, commit C4) : le document ne dépend plus de Google Fonts du tout —
// les @font-face vivent dans src/styles/fonts.css et index.html précharge Newsreader (police du h1). Détail des fichiers : tests/fonts-contract.test.mjs.
test('les polices ne dépendent plus d’un import CSS tardif ni de Google Fonts', async () => {
  const [variables, html] = await Promise.all([readFile('src/styles/variables.css', 'utf8'), readFile('index.html', 'utf8')]);
  assert.doesNotMatch(variables, /@import\s+url\([^)]*fonts\.googleapis\.com/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com/);
  assert.doesNotMatch(html, /fonts\.gstatic\.com/);
  assert.doesNotMatch(html, /rel="preconnect"/);
  assert.match(html, /rel="preload" as="font" type="font\/woff2" crossorigin href="\/src\/assets\/fonts\/newsreader\//);
});

test('les dérivés de bundle sont résolus par le catalogue partagé, jamais par un préfixe de marque en dur', async () => {
  const [derivatives, spinSource, spinSequence, projectedBlock, reportItem, stylesheet] = await Promise.all([
    readFile('src/media/presentationDerivatives.ts', 'utf8'),
    readFile('src/components/Spin360.tsx', 'utf8'),
    readFile('src/components/SpinSequence.tsx', 'utf8'),
    readFile('src/components/ProjectedPublicBlock.tsx', 'utf8'),
    readFile('src/components/ReportMediaItem.tsx', 'utf8'),
    readFile('src/index.css', 'utf8'),
  ]);
  assert.doesNotMatch(derivatives, /\/assets\/IWC\/|IWC_IMAGE_DIMENSIONS/);
  assert.match(derivatives, /PRESENTATION_CATALOG/);
  assert.match(spinSource, /presentationDerivativeUrl\([^)]*768\)/);
  assert.match(spinSequence, /lazy\(\(\) => import\('\.\/Spin360\.tsx'\)/);
  assert.doesNotMatch(spinSequence, /import \{[^}]*Spin360[^}]*\} from '\.\/Spin360/);
  assert.match(projectedBlock, /<SpinSequence images=/);
  assert.doesNotMatch(projectedBlock, /Spin360/);
  assert.match(reportItem, /eager language=\{language\} role=\{original \? 'original' : 'stage'\}/);
  assert.match(stylesheet, /\.presentation-picture \{ display: contents; \}/);
  assert.match(stylesheet, /@media print/);
});
