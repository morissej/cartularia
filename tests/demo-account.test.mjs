import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildDemoAssetDocuments, buildDemoCartularyEnvelope, buildDemoCartularySections, buildDemoRegistryItem, demoValuationAmounts } from '../src/data/demoCartularyDocuments.ts';
import { buildDemoCartularyAssets, DEMO_ACCOUNT, DEMO_CARTULARIES, DEMO_SUBMARINER_CARTULARY_ID, demoCartularyContentById } from '../src/data/demoCartularies.ts';
import { buildCartularyHref } from '../src/features/registry/registryCatalog.ts';

const homePage = readFileSync(new URL('../src/features/public/HomePage.tsx', import.meta.url), 'utf8');
const accountPage = readFileSync(new URL('../src/features/public/AccountAccessPage.tsx', import.meta.url), 'utf8');
const rootPage = readFileSync(new URL('../src/RootPage.tsx', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const hostingConfig = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
const seedScript = readFileSync(new URL('../scripts/seed-demo-account.mjs', import.meta.url), 'utf8');

test('la Galerie et le Registre démo utilisent les médias et montants du Cartulaire', () => {
  for (const cartulary of DEMO_CARTULARIES) {
    const assets = buildDemoAssetDocuments(cartulary);
    const item = buildDemoRegistryItem(cartulary, 'sha256:test');
    assert.ok(assets.some((asset) => asset.id === item.primaryAssetId && asset.tags.includes('main-photo') && asset.presentationDerivative.url.startsWith('/assets/')));
    assert.equal(buildDemoCartularyEnvelope(cartulary).primaryAssetId, item.primaryAssetId);
    assert.equal(buildDemoCartularyEnvelope(cartulary).costBasis, item.costBasis);
    assert.equal(buildDemoCartularyEnvelope(cartulary).netValuation, item.netValuation);
    assert.equal(item.costBasis, cartulary.purchasePrice + demoCartularyContentById(cartulary.id).expenses.reduce((sum, entry) => sum + entry.amount, 0));
    assert.equal(item.netValuation, item.grossValuation - demoValuationAmounts(cartulary).saleCostAmount);
    assert.equal(item.netAfterTaxValuation, item.netValuation);
    assert.ok(assets.every((asset) => asset.visibility === 'secret'));
  }
  assert.match(seedScript, /buildDemoAssetDocuments\(cartulary\)/);
  assert.equal(DEMO_ACCOUNT.collectionName, 'Les cinq icônes');
  assert.match(seedScript, /name: DEMO_ACCOUNT\.collectionName/);
  assert.match(seedScript, /description: DEMO_ACCOUNT\.collectionDescription/);
});

test('le compte démo réunit exactement les cinq Cartulaires demandés', () => {
  assert.equal(DEMO_CARTULARIES.length, 5);
  assert.deepEqual(DEMO_CARTULARIES.map(({ brand }) => brand), [
    'Rolex',
    'Audemars Piguet',
    'Tudor',
    'Jaeger-LeCoultre',
    'Breguet',
  ]);
  assert.equal(new Set(DEMO_CARTULARIES.map(({ id }) => id)).size, 5);
  assert.equal(DEMO_SUBMARINER_CARTULARY_ID, DEMO_CARTULARIES[0].id);
  assert.ok(DEMO_ACCOUNT.password.length >= 12);
});

test('chaque Cartulaire démo est réaliste, complet et explicitement fictif', () => {
  for (const cartulary of DEMO_CARTULARIES) {
    const sections = buildDemoCartularySections(cartulary);
    const content = demoCartularyContentById(cartulary.id);
    const envelope = buildDemoCartularyEnvelope(cartulary);
    const projection = buildDemoRegistryItem(cartulary, 'sha256:test');
    assert.equal(envelope.registryId, DEMO_ACCOUNT.registryId);
    assert.equal(envelope.defaultVisibility, 'secret');
    assert.equal(envelope.publicationStatus, 'none');
    assert.equal(projection.objectCode, cartulary.publicCode);
    assert.equal(projection.projectionStatus, 'active');
    assert.ok(cartulary.description.toLocaleLowerCase('fr').includes('fictif'));
    assert.ok(cartulary.technicalSpecs.length >= 6);
    assert.ok(cartulary.documents.every((document) => document.toLocaleLowerCase('fr').includes('fict')));
    assert.ok(content);
    assert.equal(Object.values(content.specificationValues).some((value) => /à documenter|non renseigné/i.test(value)), false);
    assert.equal(content.checks.length, 6);
    assert.equal(content.documentation.length, 7);
    assert.ok(content.documentation.every(({ description }) => description.toLocaleLowerCase('fr').includes('fict')));
    assert.equal(content.comparables.length, 3);
    assert.ok(content.comparables.every(({ source }) => source.includes('Simulation Cartularia')));
    assert.equal(content.conditionReports.length, 2);
    assert.ok(content.expenses.length >= 3);
    assert.ok(content.valuationHistory.length >= 4);
    assert.deepEqual(
      content.valuationHistory.map(({ date }) => date),
      [...content.valuationHistory.map(({ date }) => date)].sort(),
    );
    assert.equal(content.valuationHistory.at(-1).midValue, cartulary.valuationMid);
    assert.ok(content.valuationHistory.every(({ source }) => /fictif|démonstration/i.test(source)));
    assert.ok(content.ownershipHistory.length > 0);
    assert.ok(content.storageCodes.length > 0);
    assert.ok(content.transmissionCodes.length > 0);
    assert.deepEqual(
      new Set(sections.map(({ schemaSectionId }) => schemaSectionId.split('.')[0])),
      new Set(['cover', 'media', 'reference', 'condition', 'value', 'publication']),
    );
  }
});

test('l’accueil ouvre la Submariner et rend le Registre démo visible', () => {
  assert.match(homePage, /DEMO_SUBMARINER_CARTULARY_ID/);
  assert.match(homePage, /\/cartulary-demo\?cartularyId=/);
  assert.match(homePage, /Registre démo/);
  assert.match(accountPage, /Ouvrir le Registre démo/);
  assert.match(accountPage, /signInToCartularia\(DEMO_ACCOUNT\.userName, DEMO_ACCOUNT\.password\)/);
});

test('le seed limite le compte partagé à la lecture', () => {
  const permissionsBlock = seedScript.match(/permissions: \[(.*?)\],\n\s+createdAt:/s)?.[1] || '';
  assert.match(permissionsBlock, /'cartulary\.read'/);
  assert.match(permissionsBlock, /'registry\.read'/);
  assert.doesNotMatch(permissionsBlock, /'cartulary\.edit'/);
  assert.doesNotMatch(permissionsBlock, /'publication\.manage'/);
});

test('les Cartulaires du compte démo utilisent le gabarit Cartulaire standard', () => {
  for (const cartulary of DEMO_CARTULARIES) {
    assert.match(buildCartularyHref(cartulary.id, '/registry/reg_cartularia_demo/items', 'watch'), /^\/cartulary-demo\?/);
  }
  assert.match(rootPage, /isDemoCartularyRoute \? CartularyApp : GenericCartularyPage/);
});

test('le déploiement évite les vues sans style après une nouvelle version', () => {
  assert.match(mainSource, /vite:preloadError/);
  const globalHeaders = hostingConfig.hosting.headers.find(({ source }) => source === '**')?.headers || [];
  const assetHeaders = hostingConfig.hosting.headers.find(({ source }) => source === '/assets/**')?.headers || [];
  assert.ok(globalHeaders.some(({ key, value }) => key === 'Cache-Control' && value.includes('no-cache')));
  assert.ok(assetHeaders.some(({ key, value }) => key === 'Cache-Control' && value.includes('immutable')));
});

test('chaque Cartulaire remplit tous les rôles média du gabarit standard', () => {
  const expectedRoles = new Set(['main-photo', 'main-video', 'spin-3d', 'slideshow', 'accessories', 'documentation', 'other']);
  for (const cartulary of DEMO_CARTULARIES) {
    const assets = buildDemoCartularyAssets(cartulary);
    assert.deepEqual(new Set(assets.flatMap(({ tags }) => tags)), expectedRoles);
    assert.ok(assets.some(({ type, tags }) => type === 'video' && tags.includes('main-video')));
    assert.ok(assets.filter(({ type, tags }) => type === 'image' && tags.includes('spin-3d')).length >= 2);
  }
});
