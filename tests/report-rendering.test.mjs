import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
test('toutes les images du renderer imprimable passent par ReportPrintImage (chargées à la préparation), y compris les pièces documentaires', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const renderer = source.slice(source.indexOf('const renderWatchWebsiteBlock ='), source.indexOf('if (isWatchWebsite && requestedPublicCode &&'));
  // V3 tour 5 : la branche imprimée (forPrint) ne rend jamais une PrivateMediaImage nue — chaque image imprimée est une
  // ReportPrintImage, qui charge l'original à la préparation du rapport ; aucune image ne dépend plus d'un simple `eager`.
  const printed = renderer.match(/<ReportPrintImage\b/g) || [];
  assert.equal(printed.length, 5, 'couverture, hero Médias, séquence 360°, bibliothèque, pièces documentaires');
  assert.doesNotMatch(renderer, /eager=\{forPrint\}/);
  const reading = renderer.match(/<PrivateMediaImage\b[^]*?\/>/g) || [];
  assert.ok(reading.length >= 4);
  for (const image of reading) assert.match(image, /\srole=(?:"thumbnail"|"stage")/, `rôle implicite : ${image.slice(0, 80)}`);
  assert.match(source, /orderedReportBlocks.length > 0 && reportPreparation.active/);
  assert.match(renderer, /!forPrint && <div className="media-carousel-wrapper"/);
});
