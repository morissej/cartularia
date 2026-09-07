import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const [app, modals, registry, carousel, privateImage, privateMedia] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/cartulary/modals/CartularyModals.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/registry/RegistryApp.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/MediaCarousel.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/PrivateMediaImage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/privateMedia.ts', import.meta.url), 'utf8'),
]);

test('les surfaces lourdes restent des frontières dynamiques ciblées', () => {
  const assertLazyBoundary = (source, modules) => {
    const parsed = ts.createSourceFile('surface.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const lazyImports = new Set();
    const staticImports = new Set();
    const visit = (node, insideLazy = false) => {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) staticImports.add(node.moduleSpecifier.text);
      const lazy = insideLazy || (ts.isCallExpression(node) && node.expression.getText(parsed) === 'lazy');
      if (lazy && ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) lazyImports.add(node.arguments[0].text);
      ts.forEachChild(node, (child) => visit(child, lazy));
    };
    visit(parsed);
    for (const module of modules) {
      assert.ok(lazyImports.has(module), `${module} doit être chargé dans React.lazy`);
      assert.ok(!staticImports.has(module), `${module} ne doit pas être aussi importé statiquement`);
    }
  };
  assertLazyBoundary(app, ['./components/AuditPanel.tsx', './components/Spin360.tsx']);
  assertLazyBoundary(modals, ['../../../components/Spin360.tsx']);
  assertLazyBoundary(registry, ['RegistryItems', 'RegistryCollections', 'RegistryComparison', 'RegistryAdministration', 'RegistryAccessCenter', 'RegistryFollowUp', 'RegistryGallery', 'RegistryIntegrity', 'NewCartularyPage'].map((component) => `./${component}.tsx`));
});

test('le carrousel ne recrée plus les actifs uniquement pour changer leur source', () => {
  assert.doesNotMatch(carousel, /asset=\{\{\s*\.\.\./);
  assert.match(carousel, /sourceOverride=\{poster\}/);
  assert.match(carousel, /sourceOverride=\{thumbnail\}/);
  assert.match(privateImage, /acquirePrivateMediaObjectUrl/);
});

test('le cache média est borné et les URL de Galerie sont libérables', () => {
  assert.match(privateMedia, /MAXIMUM_IDLE_OBJECT_URLS = 24/);
  assert.match(privateMedia, /releasePrivateMediaObjectUrl/);
  assert.match(privateMedia, /objectUrlCache\.clear\(\)/);
});
