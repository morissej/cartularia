import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
test('toutes les images du renderer imprimable ont un mode eager, y compris les pièces documentaires', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const renderer = source.slice(source.indexOf('const renderWatchWebsiteBlock ='), source.indexOf('if (isWatchWebsite && requestedPublicCode &&'));
  const images = renderer.match(/<PrivateMediaImage\b[^>]*\/>/g) || [];
  assert.ok(images.length >= 5);
  for (const image of images) assert.match(image, /\beager(?:[\s=])/);
  assert.match(source, /orderedReportBlocks.length > 0 && reportPreparation.active/);
  assert.match(renderer, /!forPrint && <div className="media-carousel-wrapper"/);
});
