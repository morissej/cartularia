import assert from 'node:assert/strict';
import test from 'node:test';
import { createTextPdf, normalizePdfLines } from '../src/utils/pdfExport.ts';

test('le rapport produit un vrai document PDF multi-page', () => {
  const pdf = createTextPdf(Array.from({ length: 110 }, (_, index) => `Ligne ${index + 1} — état de l’objet`));
  const text = new TextDecoder().decode(pdf);
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /\/Type \/Pages/);
  assert.match(text, /\/Count 3/);
  assert.match(text, /%%EOF\n$/);
});

test('les lignes longues sont découpées avant export', () => {
  const lines = normalizePdfLines(['Un '.repeat(80)]);
  assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => line.length <= 88));
});
