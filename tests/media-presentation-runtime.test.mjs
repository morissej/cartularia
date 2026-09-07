import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { inspectTrustedUpload } from '../scripts/lib/private-upload-command.mjs';
import { assertSupportedFfmpegVersion, createVideoPresentation, validateVideoProbe } from '../scripts/lib/media-presentation-runtime.mjs';

const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const fixture = async (text, pageCount = 1) => {
  const pdf = await PDFDocument.create();
  pdf.setAuthor('Private Metadata Author'); pdf.setTitle('Private metadata title'); pdf.setSubject('Not public metadata');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pageCount; index += 1) {
    const page = pdf.addPage([595, 842]);
    page.drawRectangle({ x: 40, y: 560, width: 515, height: 240, color: rgb(0.12, 0.24, 0.3) });
    page.drawText('RAPPORT OBJET', { x: 60, y: 740, size: 26, font, color: rgb(1, 1, 1) });
    page.drawText(text, { x: 60, y: 500, size: 16, font });
    page.drawText(`Page ${index + 1}`, { x: 60, y: 45, size: 10, font });
  }
  return Buffer.from(await pdf.save());
};
const inspectPdf = async (bytes, callback) => {
  const directory = await mkdtemp(join(tmpdir(), 'cartularia-pdf-presentation-test-'));
  const path = join(directory, 'object.pdf');
  try { await writeFile(path, bytes); const result = await inspectTrustedUpload({ path, fileName: 'object.pdf', declaredMimeType: 'application/pdf', expectedDigest: digest(bytes), expectedSize: bytes.length }); await callback(result, path, directory); }
  finally { if (!process.env.KEEP_PDF_PRESENTATION_FIXTURE) await rm(directory, { recursive: true, force: true }); }
};

test('PDF de présentation reconstruit depuis les pixels, lisible, sans métadonnées ; original inchangé', async () => {
  const original = await fixture('Etat observe : bon. Reference : OBJ-2048.');
  await inspectPdf(original, async (result, path, directory) => {
    assert.equal(result.publicationEligible, true, result.presentationFailure);
    assert.equal(result.derivative.mimeType, 'application/pdf'); assert.equal(result.derivative.pageCount, 1);
    assert.equal(result.derivative.processingMethod, 'pdf_rasterized_v1');
    assert.equal(digest(await readFile(path)), digest(original));
    assert.notEqual(result.derivative.sha256, digest(original));
    const copy = await PDFDocument.load(result.derivative.bytes, { updateMetadata: false });
    assert.equal(copy.getPageCount(), 1); assert.equal(copy.getAuthor(), undefined); assert.equal(copy.getTitle(), undefined);
    assert.equal(copy.getPage(0).getWidth(), 595); assert.equal(copy.getPage(0).getHeight(), 842);
    assert.doesNotMatch(result.derivative.bytes.toString('latin1'), /Private Metadata|\/OpenAction|\/JavaScript|\/EmbeddedFile|\/AcroForm/);
    if (process.env.KEEP_PDF_PRESENTATION_FIXTURE) { await writeFile(join(directory, 'presentation.pdf'), result.derivative.bytes); console.log(`PDF_QA_DIRECTORY=${directory}`); }
  });
});
test('un document personnel reste privé, même si le PDF est techniquement valide', async () => {
  await inspectPdf(await fixture('Proprietaire : Exemple. Contact : prive@example.org'), async (result) => {
    assert.equal(result.accepted, true); assert.equal(result.publicationEligible, false); assert.equal(result.presentationFailure, 'personal_document'); assert.equal(result.derivative, null);
  });
});
test('un PDF dépassant trente pages ne peut pas obtenir un dérivé public', async () => {
  await inspectPdf(await fixture('Objet', 31), async (result) => { assert.equal(result.publicationEligible, false); assert.equal(result.presentationFailure, 'pdf_page_limit'); });
});
test('les versions FFmpeg obsolètes et les limites vidéo échouent explicitement', async () => {
  for (const version of ['6.1.1', '7.1.4', '8.0.2']) assert.throws(() => assertSupportedFfmpegVersion(`ffmpeg version ${version}`), { code: 'video_runtime_unsupported' });
  for (const version of ['7.1.5', '8.0.3', '8.1.2', '9.0.1']) assert.doesNotThrow(() => assertSupportedFfmpegVersion(`ffmpeg version ${version}`));
  await assert.rejects(createVideoPresentation({ path: '/tmp/not-opened', workingDirectory: '/tmp', ffmpegPath: '', ffprobePath: '' }), { code: 'video_runtime_unavailable' });
  assert.throws(() => validateVideoProbe({ format: { duration: 500 }, streams: [{ codec_type: 'video', width: 1280, height: 720 }] }), { code: 'video_limits' });
  assert.throws(() => validateVideoProbe({ format: { duration: 20, tags: { location: 'private' } }, streams: [{ codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 }] }, true), { code: 'video_metadata_remaining' });
});
