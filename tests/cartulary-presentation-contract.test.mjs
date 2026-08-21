import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CARTULARY_PRESENTATION_CONTRACT_VERSION,
  COMMON_CARTULARY_STRUCTURE,
  cartularyPageDefinitions,
  cartularyPageForSchemaSection,
} from '../src/features/cartulary/presentation/cartularyPresentationContract.ts';

test('tous les Cartulaires partagent les six pages et les structures communes', () => {
  assert.equal(CARTULARY_PRESENTATION_CONTRACT_VERSION, 'cartulary-presentation@1.4.0');
  assert.deepEqual(cartularyPageDefinitions('FR').map(({ id }) => id), ['cover', 'media', 'reference', 'condition', 'value', 'publication']);
  assert.deepEqual(COMMON_CARTULARY_STRUCTURE.map(({ id }) => id), [
    'cover.collection',
    'cover.todos',
    'condition.storage',
    'condition.transmission',
    'reference.reports',
    'publication.cartulary',
    'publication.collections',
    'publication.community',
    'publication.report',
  ]);
  assert.equal(cartularyPageForSchemaSection('technical.powertrain'), 'reference');
  assert.equal(cartularyPageForSchemaSection('history.service'), 'condition');
  assert.equal(cartularyPageForSchemaSection('value.market'), 'value');
  assert.equal(cartularyPageForSchemaSection('publication.report'), 'publication');
});

test('les deux lecteurs existants consomment le même contrat de présentation', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const generic = readFileSync(new URL('../src/components/GenericCartularyView.tsx', import.meta.url), 'utf8');
  for (const source of [app, generic]) {
    assert.match(source, /CARTULARY_PRESENTATION_CONTRACT_VERSION/);
    assert.match(source, /cartularyPageDefinitions/);
    assert.match(source, /data-cartulary-presentation-version/);
  }
});

test('la page Publication sélectionne directement tous les contenus et valide seulement par scope', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const selector = app.slice(
    app.indexOf('const renderPublicationBlockSelector'),
    app.indexOf('const ownershipSummary'),
  );
  assert.match(selector, /togglePublicationBlock/);
  assert.match(selector, /Tout sélectionner/);
  assert.doesNotMatch(selector, /requestPublicationChange|getPublicationPolicy|!policy\.allowed|À valider/);
  assert.match(app, /Publication du mini-site de l'objet/);
  assert.match(app, /Publication active/);
  assert.match(app, /Valider au niveau Collection/);
  assert.match(app, /Valider la publication dans Le Cercle/);
  assert.match(app, /loadCartularyCollectionContext\(mockCartulary\.id, requestedRegistryId\)/);
  assert.match(app, /Associer le Cartulaire à plusieurs collections/);
  assert.match(app, /orderedReportBlocks\.length === 0/);
  assert.match(app, /downloadTextPdf/);
  assert.doesNotMatch(app, /window\.print\(\)/);
  assert.match(app, /localCollectionWebsiteUrl/);
  assert.match(app, /localCommunityWebsiteUrl/);
});

test('l aperçu local de publication reçoit le Cartulaire et les contenus validés', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const cartularyIds = readFileSync(new URL('../src/domain/cartularyIds.ts', import.meta.url), 'utf8');
  assert.match(app, /localPublicationPreviewAllowed/);
  assert.match(app, /blocks: approvedWebsiteBlocks\.join\(','\)/);
  assert.match(app, /href=\{localPublicationPreviewUrl\}/);
  assert.match(app, /localPublicationPreviewAllowed\s*\? requestedPublishedBlocks \?\? approvedWebsiteBlocks/);
  assert.match(cartularyIds, /normalizedPath === '\/watch-website' && parameters\.get\('preview'\) === 'local'/);
});

test('le Cartulaire propriétaire ne propose plus de faux mode de consultation', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /Mode de consultation|Viewing mode|Choisir les données visibles|setAudience|AUDIENCE_STORAGE_KEY/);
  assert.doesNotMatch(css, /audience-toolbar/);
});

test('le mini-site publié reprend les pages du Cartulaire et préserve le ratio des images', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(app, /const publishedWebsitePages = pages/);
  assert.match(app, /page\.id !== 'publication'/);
  assert.match(app, /publicationPageNumberByBlock\.get\(blockId\) === page\.number/);
  assert.match(app, /page-tabs watch-website__tabs/);
  assert.match(app, /activeWebsitePage\.blockIds\.map/);
  assert.match(app, /setActivePage\(page\);\s*window\.location\.hash = page/);
  assert.doesNotMatch(app, /pathname\.replace\(\/\\\/\$\/, ''\) === '\/watch-website'\) return/);
  assert.match(app, /data-cartulary-presentation-version=\{CARTULARY_PRESENTATION_CONTRACT_VERSION\}/);
  assert.match(css, /\.watch-website__hero > \.presentation-picture > img[^}]+object-fit: contain/s);
});
