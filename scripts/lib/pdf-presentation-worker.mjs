import { readFile, writeFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, PDFName } from 'pdf-lib';
import { AnnotationMode, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export const PDF_PRESENTATION_LIMITS = Object.freeze({ maximumPages: 30, maximumPagePixels: 4_000_000, maximumTotalPixels: 80_000_000, maximumOutputBytes: 50 * 1024 * 1024 });
const personalText = /(?:propri[eé]taire|b[eé]n[eé]ficiaire|domicile|titulaire du compte|num[eé]ro de s[eé]curit[eé] sociale|iban|passeport|carte d.identit[eé]|adresse personnelle)|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

export async function renderPdfPresentation(inputPath, outputPath) {
  const bytes = new Uint8Array(await readFile(inputPath));
  if (bytes.length > 50 * 1024 * 1024) fail('file_too_large', 'PDF trop volumineux.');
  // Data-only input: no remote URL, script execution, XFA or system font lookup.
  const task = getDocument({ data: bytes, isEvalSupported: false, enableXfa: false, useSystemFonts: false, useWorkerFetch: false, stopAtErrors: true, verbosity: 0 });
  const source = await task.promise;
  const output = await PDFDocument.create({ updateMetadata: false });
  let totalPixels = 0;
  try {
    if (!source.numPages || source.numPages > PDF_PRESENTATION_LIMITS.maximumPages) fail('pdf_page_limit', 'Le PDF dépasse 30 pages.');
    for (let index = 1; index <= source.numPages; index += 1) {
      const page = await source.getPage(index);
      const text = await page.getTextContent();
      if (personalText.test(text.items.map((item) => item.str || '').join(' '))) fail('personal_document', 'Document contenant des données personnelles : la copie publique est refusée.');
      const original = page.getViewport({ scale: 1 });
      if (!Number.isFinite(original.width) || !Number.isFinite(original.height) || original.width <= 0 || original.height <= 0 || original.width > 14_400 || original.height > 14_400) fail('pdf_dimensions', 'Dimensions de page excessives.');
      const scale = Math.min(2, 2400 / Math.max(original.width, original.height), Math.sqrt(PDF_PRESENTATION_LIMITS.maximumPagePixels / (original.width * original.height)));
      const viewport = page.getViewport({ scale });
      const width = Math.floor(viewport.width); const height = Math.floor(viewport.height);
      totalPixels += width * height;
      if (totalPixels > PDF_PRESENTATION_LIMITS.maximumTotalPixels) fail('pdf_pixel_limit', 'Le PDF dépasse le budget de pixels autorisé.');
      const canvas = createCanvas(width, height);
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport, annotationMode: AnnotationMode.DISABLE, background: '#ffffff' }).promise;
      const image = await output.embedJpg(await canvas.encode('jpeg', 90));
      output.addPage([original.width, original.height]).drawImage(image, { x: 0, y: 0, width: original.width, height: original.height });
      canvas.width = 1; canvas.height = 1;
      page.cleanup();
    }
    // Rebuilt from pixels only: no source object, metadata, attachment, action,
    // form or cryptographic signature is copied into this presentation document.
    output.catalog.delete(PDFName.of('Metadata'));
    output.context.trailerInfo.Info = undefined;
    const result = await output.save({ useObjectStreams: false });
    if (result.length > PDF_PRESENTATION_LIMITS.maximumOutputBytes) fail('derivative_too_large', 'La copie PDF dépasse 50 Mio.');
    await writeFile(outputPath, result);
    return { pageCount: source.numPages, totalPixels, size: result.length, mimeType: 'application/pdf', kind: 'document', metadataStripped: true, processingMethod: 'pdf_rasterized_v1' };
  } finally { await task.destroy(); }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try { process.stdout.write(JSON.stringify(await renderPdfPresentation(process.argv[2], process.argv[3]))); }
  catch (error) { process.stdout.write(JSON.stringify({ error: error.code || 'pdf_render_failed', message: error.code === 'personal_document' ? error.message : 'La copie de présentation du PDF n’a pas pu être vérifiée.' })); process.exitCode = 1; }
}
