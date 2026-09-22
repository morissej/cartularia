import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import sharp from 'sharp';
import {
  buildImagePresentationSet,
  PRESENTATION_MAXIMUM_IMAGE_PIXELS,
} from '../scripts/lib/presentation-variants.mjs';
import {
  OPENTIMESTAMPS_CALENDARS,
  OPENTIMESTAMPS_MAXIMUM_PROOF_BYTES,
  OpenTimestampsPublicAnchorAdapter,
} from '../scripts/lib/trust-adapters.mjs';

const root = new URL('../', import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const source = (path) => readFile(new URL(path, root), 'utf8');
const atLeast = (actual, expected) => {
  const left = String(actual).split('.').map(Number);
  const right = String(expected).split('.').map(Number);
  return right.every((part, index) => (left[index] ?? 0) === part || (left[index] ?? 0) > part
    || left.slice(0, index).some((value, earlier) => value > right[earlier]));
};

test('P8 : les versions corrigées et les binaires natifs de la cible sont verrouillés', async () => {
  const [manifest, lock, firebase] = await Promise.all([
    json('package.json'),
    json('package-lock.json'),
    json('firebase.json'),
  ]);
  assert.equal(manifest.dependencies.sharp, '0.35.4');
  assert.equal(manifest.dependencies['pdfjs-dist'], '6.2.108');
  assert.equal(manifest.dependencies['@napi-rs/canvas'], '1.0.9');
  assert.equal(lock.packages['node_modules/sharp'].version, '0.35.4');
  assert.equal(lock.packages['node_modules/pdfjs-dist'].version, '6.2.108');
  assert.equal(lock.packages['node_modules/@img/sharp-libvips-linux-x64'].version, '1.3.3');
  assert.equal(lock.packages['node_modules/@img/sharp-libvips-linux-arm64'].version, '1.3.3');
  assert.equal(lock.packages['node_modules/request/node_modules/form-data'].version, '2.5.6');
  assert.equal(firebase.functions.runtime, 'nodejs22');
  assert.equal(sharp.versions.sharp, '0.35.4');
  assert.equal(atLeast(sharp.versions.heif, '1.23.2'), true, `libheif ${sharp.versions.heif}`);
  assert.equal(atLeast(sharp.versions.vips, '8.18.6'), true, `libvips ${sharp.versions.vips}`);
});

test('P8 : les décodeurs d’images attendus restent disponibles et libheif produit les dérivés', async () => {
  for (const format of ['jpeg', 'png', 'webp', 'heif']) {
    assert.equal(sharp.format[format].input.buffer, true, `${format} doit rester décodable depuis un buffer`);
  }
  const avif = await readFile(new URL('public/assets/IWC/derivatives/_DSC0991-3.240.avif', root));
  assert.equal((await sharp(avif).metadata()).format, 'heif');
  const presentation = await buildImagePresentationSet({ input: avif });
  assert.ok(presentation.variants.length > 0);
  assert.ok(presentation.variants.every((variant) => variant.mimeType === 'image/webp'));
});

test('P8 : les budgets mémoire et pixels restent explicites et le dépassement échoue avant décodage massif', async () => {
  const [runtime, functions, variants] = await Promise.all([
    source('scripts/lib/media-presentation-runtime.mjs'),
    source('scripts/firebase-functions.mjs'),
    source('scripts/lib/presentation-variants.mjs'),
  ]);
  assert.match(runtime, /--max-old-space-size=512/);
  assert.match(functions, /verifyPrivateDraftUpload = onObjectFinalized\([\s\S]*?memory: '1GiB'[\s\S]*?concurrency: 1/);
  assert.match(variants, /limitInputPixels: PRESENTATION_MAXIMUM_IMAGE_PIXELS/);
  const edge = Math.floor(Math.sqrt(PRESENTATION_MAXIMUM_IMAGE_PIXELS)) + 1;
  const oversizedSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${edge}" height="${edge}"><rect width="100%" height="100%"/></svg>`);
  await assert.rejects(buildImagePresentationSet({ input: oversizedSvg }), /pixel limit|exceeds/i);
});

test('P8 : PDF.js désactive les scripts même après migration', async () => {
  const worker = await source('scripts/lib/pdf-presentation-worker.mjs');
  assert.match(worker, /enableScripting: false/);
  assert.match(worker, /isEvalSupported: false/);
  assert.match(worker, /enableXfa: false/);
  assert.match(worker, /annotationMode: AnnotationMode\.DISABLE/);
});

test('P8 : OpenTimestamps refuse les calendriers arbitraires et les preuves hors budget', async () => {
  const adapter = new OpenTimestampsPublicAnchorAdapter();
  assert.deepEqual(adapter.calendars, OPENTIMESTAMPS_CALENDARS);
  assert.throws(
    () => new OpenTimestampsPublicAnchorAdapter({ calendars: ['http://127.0.0.1:8080'] }),
    { code: 'invalid_opentimestamps_calendars' },
  );
  const oversized = Buffer.alloc(OPENTIMESTAMPS_MAXIMUM_PROOF_BYTES + 1).toString('base64');
  await assert.rejects(
    adapter.anchor({ payloadDigest: `sha256:${'a'.repeat(64)}`, proofBase64: oversized }),
    { code: 'invalid_public_anchor_proof' },
  );
});
