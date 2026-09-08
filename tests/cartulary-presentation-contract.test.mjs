import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  CARTULARY_PRESENTATION_CONTRACT_VERSION,
  COMMON_CARTULARY_STRUCTURE,
  cartularyPageDefinitions,
  cartularyPageForSchemaSection,
  SPECIALIZED_CARTULARY_SECTIONS,
} from '../src/features/cartulary/presentation/cartularyPresentationContract.ts';
import { filterPublicationBlockIds, getPublicationPolicy, PUBLISHED_BLOCK_IDS } from '../src/domain/publication.ts';
import { cartularyIdFromLocation, IWC_CARTULARY_ID } from '../src/domain/cartularyIds.ts';

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

test('la page Publication sélectionne les contenus autorisés sans confirmation à chaque case, puis confirme au serveur', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const selector = app.slice(
    app.indexOf('const renderPublicationBlockSelector'),
    app.indexOf('const ownershipSummary'),
  );
  assert.match(selector, /togglePublicationBlock/);
  assert.match(selector, /Tout sélectionner/);
  assert.doesNotMatch(selector, /requestPublicationChange|À valider/);
  assert.match(selector, /getPublicationPolicy\(destination, definition.id\).allowed/);
  for (const destination of ['website', 'collection', 'community', 'report']) {
    const selection = filterPublicationBlockIds(destination, PUBLISHED_BLOCK_IDS);
    assert.ok(selection.length > 0);
    assert.ok(selection.every((id) => getPublicationPolicy(destination, id).allowed));
    for (const personal of ['cover-owner', 'cover-transmission', 'cover-storage']) assert.equal(selection.includes(personal), false);
  }
  assert.match(app, /Mini-site de votre objet/);
  assert.match(app, /<PublicWebsitePublicationPanel[^>]+blocks=\{websiteDraftRequest\(websiteDraft\)\}/);
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

test('l’aperçu local conserve le Cartulaire choisi sans changer une autre surface', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /localPublicationPreviewAllowed/);
  assert.match(app, /blocks: approvedWebsiteBlocks\.join\(','\)/);
  assert.match(app, /href=\{localPublicationPreviewUrl\}/);
  assert.match(app, /localPublicationPreviewAllowed\s*\? requestedPublishedBlocks \?\? approvedWebsiteBlocks/);
  assert.equal(cartularyIdFromLocation({ pathname: '/watch-website', search: '?preview=local&cartularyId=cart_fixture_object' }), 'cart_fixture_object');
  assert.equal(cartularyIdFromLocation({ pathname: '/registry', search: '?preview=local&cartularyId=cart_fixture_object' }), IWC_CARTULARY_ID);
  assert.equal(cartularyIdFromLocation({ pathname: '/watch-website', search: '?preview=local&cartularyId=../private' }), IWC_CARTULARY_ID);
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

test('ADR-028 : un seul lecteur, piloté par l’enveloppe et le schéma, pour tout type d’objet', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const catalog = readFileSync(new URL('../src/features/registry/registryCatalog.ts', import.meta.url), 'utf8');
  const rootPage = readFileSync(new URL('../src/RootPage.tsx', import.meta.url), 'utf8');
  assert.match(app, /useAuthoritativeCartulary\(ACTIVE_CARTULARY_ID/);
  for (const page of ['cover', 'media', 'reference', 'condition', 'value', 'publication']) {
    assert.match(app, new RegExp(`<GenericSchemaPageSections page="${page}"`), `page ${page} sans sections génériques`);
  }
  assert.doesNotMatch(catalog, /cartulary-view/, 'le Registre ne doit plus aiguiller par type d’objet');
  assert.doesNotMatch(catalog, /assetType === 'watch'/);
  assert.match(rootPage, /'cartulary-view'\s*\?\s*CartularyApp/);
});

test('ADR-028 : les blocs spécialisés ne s’affichent que si le schéma porte leur section', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  for (const sectionId of ['media.hero', 'reference.origins', 'reference.specifications', 'reference.checks', 'reference.popularity', 'condition.description', 'condition.summary', 'condition.documentation', 'condition.reports', 'value.market_depth', 'value.comparables', 'value.cost_basis', 'value.performance', 'value.sensitivity']) {
    assert.match(app, new RegExp(`schemaHas\\('${sectionId.replace('.', '\\.')}'\\)`), `bloc ${sectionId} non conditionné`);
  }
});

test('ADR-028 : la liste des sections spécialisées ne cite que des sections publiées du catalogue', () => {
  const published = new Set(['watch/1.6.0', 'car/1.2.0'].flatMap((path) => JSON.parse(readFileSync(new URL(`../firebase/schema-catalog/${path}.json`, import.meta.url), 'utf8')).sections));
  for (const sectionId of SPECIALIZED_CARTULARY_SECTIONS) assert.ok(published.has(sectionId), `${sectionId} absent du catalogue`);
  assert.ok(!SPECIALIZED_CARTULARY_SECTIONS.includes('technical.powertrain'), 'les sections propres à une autre verticale restent génériques');
});

// ADR-026, durcissement du 2026-09-08 : aucune condition par marque ou identifiant de Cartulaire
// dans l'application. Les seules mentions tolérées sont des fixtures de seed, des migrations datées
// et la correspondance de routage des codes publics du pilote.
const IDENTITY_ALLOWLIST = [
  'src/domain/cartularyIds.ts',
  'src/bootstrap/applicationBootstrap.ts',
  'src/persistence/localVault.ts',
  'src/data/mockData.ts',
];
const IDENTITY_PATTERN = /isIwcCartulary|isRolexCartulary|IWC_CARTULARY_ID|ROLEX_CARTULARY_ID|cart_iwc_flieger|cart_rolex_gmt|ROL-487D9CAD|OP-4892-XZ9/;
const BRAND_CONDITION_PATTERN = /\b(?:brand|makerName|maker)\s*(?:===|!==|==)\s*['"](?!all['"])[^'"]+['"]/;
// « brand » désigne ici le champ de conteneur QuickTime/MP4, pas une marque d'objet.
const BRAND_ALLOWLIST = ['src/security/fileValidation.ts'];

const walkSources = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) return walkSources(path);
  return /\.(ts|tsx)$/.test(entry.name) && !/ 2\.(ts|tsx)$/.test(entry.name) ? [path] : [];
});
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
const relativeSource = (path) => `src/${relative(sourceRoot, path).split(sep).join('/')}`;

test('ADR-026 durci : aucune condition par marque ou identifiant hors fixtures, migrations datées et routage', () => {
  const offenders = [];
  for (const path of walkSources(sourceRoot)) {
    const relativePath = relativeSource(path);
    if (relativePath.startsWith('src/migrations/') || IDENTITY_ALLOWLIST.includes(relativePath)) continue;
    const source = readFileSync(path, 'utf8');
    const identity = source.match(IDENTITY_PATTERN);
    if (identity) offenders.push(`${relativePath} : ${identity[0]}`);
    const brand = BRAND_ALLOWLIST.includes(relativePath) ? null : source.match(BRAND_CONDITION_PATTERN);
    if (brand) offenders.push(`${relativePath} : ${brand[0]}`);
  }
  assert.deepEqual(offenders, []);
  const bootstrap = readFileSync(new URL('../src/bootstrap/applicationBootstrap.ts', import.meta.url), 'utf8');
  assert.match(bootstrap, /Migration datée \(ADR-029\)/, 'l’hydratation IWC reste documentée comme migration datée');
  const active = readFileSync(new URL('../src/data/activeCartulary.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(active, /mockData/, 'le Cartulaire actif ne lit plus la fixture IWC');
});

test('ADR-026 durci : le mode démonstration ne décide ni des pages ni des structures communes', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  for (const page of ['CoverPage', 'MediaPage', 'ReferencePage', 'ConditionPage', 'ValuePage', 'PublicationPage']) {
    assert.doesNotMatch(app, new RegExp(`isDemoCartulary\\s*(?:&&|\\?)\\s*\\(?\\s*<${page}\\b`), `${page} conditionnée par la démo`);
  }
  assert.doesNotMatch(app, /isDemoCartulary\s*(?:&&|\?)\s*\(?\s*<CartularyTodoBoard\b/);
  assert.doesNotMatch(app, /isDemoCartulary\s*(?:&&|\?)\s*\(?\s*<GenericSchemaPageSections\b/);
});
