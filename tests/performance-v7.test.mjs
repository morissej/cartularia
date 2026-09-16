// V7 (V-B2, décisions D6, D7, D8, D10, D11) — barrière du point « bundle ». Commit C1 : découpage react/icons de vite.config.ts, greffon
// retirant les copies numérotées de dist/, garde hosting.ignore des deux configurations Hosting, budgets étendus de measure:pf0,
// mesure des surfaces (measure:surfaces) et scripts test:v7 / verify:v7. Commit C2 : préchargement du Registre depuis la page de
// connexion (registryPreload.ts, câblage d'AccountAccessPage, seuil du parcours à chaud). Assertions de source et de comportement (les
// configurations Vite sont importées telles quelles par Node, le greffon et measure:pf0 sont exercés sur des dossiers témoins, les
// sources TSX sont lues par l'AST TypeScript) : chacune échoue sans le code qu'elle verrouille. Les contrôles sur le vrai dist/ sont
// ceux de measure:pf0 et measure:surfaces (verify:v7) ; le comportement du préchargement est exercé par tests/ui/registry-preload.test.tsx.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const { default: viteConfig, numberedCopiesPlugin, removeNumberedCopies } = await import(new URL('../vite.config.ts', import.meta.url));
const { default: personalConfig } = await import(new URL('../vite.personal.config.ts', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'cartularia-v7-'));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const seed = (base, files) => {
  for (const [relative, contents] of Object.entries(files)) {
    mkdirSync(join(base, relative, '..'), { recursive: true });
    writeFileSync(join(base, relative), contents);
  }
};

// ---------------------------------------------------------------- D7 : deux groupes react + icons, récursion par défaut
test('V-B2 (D7) : vite.config.ts déclare deux groupes codeSplitting, react (priorité 2) puis icons (priorité 1), sans includeDependenciesRecursively ni option dépréciée', () => {
  const groups = viteConfig.build?.rolldownOptions?.output?.codeSplitting?.groups;
  assert.ok(Array.isArray(groups), 'build.rolldownOptions.output.codeSplitting.groups attendu');
  assert.deepEqual(groups.map((group) => group.name), ['react', 'icons']);
  const [reactGroup, iconsGroup] = groups;
  assert.equal(reactGroup.priority, 2);
  assert.equal(iconsGroup.priority, 1);
  assert.ok(reactGroup.priority > iconsGroup.priority, 'react est choisi avant icons : React ne peut pas être aspiré dans icons-*.js');
  // Le motif react capture react, react-dom et scheduler (dont react/jsx-runtime) et rien d'autre de node_modules (R2 : react-router resterait dehors, sciemment).
  for (const id of ['node_modules/react/index.js', 'node_modules/react/jsx-runtime.js', 'node_modules/react-dom/client.js', 'node_modules/scheduler/index.js', 'node_modules\\react\\index.js']) assert.ok(reactGroup.test.test(id), id);
  for (const id of ['node_modules/react-router/index.js', 'node_modules/lucide-react/dist/esm/icons/x.js', 'src/react-helpers/index.ts', 'node_modules/firebase/app/index.js']) assert.ok(!reactGroup.test.test(id), `${id} hors du groupe react`);
  for (const id of ['node_modules/lucide-react/dist/esm/icons/arrow-left.js', 'node_modules/lucide-react/dist/esm/lucide-react.js']) assert.ok(iconsGroup.test.test(id), id);
  for (const id of ['node_modules/react/index.js', 'src/components/icons.tsx']) assert.ok(!iconsGroup.test.test(id), `${id} hors du groupe icons`);
  for (const group of groups) assert.equal(group.includeDependenciesRecursively, undefined, `${group.name} : récursion par défaut (false exige preserveEntrySignatures + strictExecutionOrder et fait importer l'entrée par icons-*.js)`);
  const source = read('vite.config.ts');
  assert.doesNotMatch(source, /includeDependenciesRecursively:/);
  for (const deprecated of ['manualChunks', 'advancedChunks', 'rollupOptions']) assert.doesNotMatch(source, new RegExp(deprecated), `${deprecated} déprécié par rolldown (codeSplitting seul)`);
});

// ---------------------------------------------------------------- D8 : greffon closeBundle « cartularia-copies-numerotees »
test('D8 (c) : le greffon cartularia-copies-numerotees est dans les plugins, ne s’applique qu’au build et résout outDir depuis la configuration (chemin relatif ou absolu)', () => {
  const plugins = viteConfig.plugins.flat();
  const plugin = plugins.find((candidate) => candidate?.name === 'cartularia-copies-numerotees');
  assert.ok(plugin, 'greffon absent de plugins');
  assert.equal(plugin.apply, 'build');
  assert.equal(typeof plugin.configResolved, 'function');
  assert.equal(typeof plugin.closeBundle, 'function');
  assert.match(read('vite.config.ts'), /outDir = resolve\(config\.root, config\.build\.outDir\)/, 'resolve, pas join : un --outDir absolu ne doit pas être concaténé');
  // Chemin relatif au root, puis chemin absolu (usage vite build --outDir <absolu>) : le greffon vise le même dossier dans les deux cas.
  for (const outDir of ['dist-temoin', join(scratch, 'dist-absolu')]) {
    const fixture = numberedCopiesPlugin();
    const target = resolve(scratch, outDir);
    seed(target, { 'assets/IWC/derivatives/_DSC1019-3.768 2.avif': 'copie', 'assets/IWC/derivatives/_DSC1019-3.768.avif': 'original' });
    fixture.configResolved({ root: scratch, build: { outDir } });
    const warnings = [];
    const { warn } = console;
    console.warn = (message) => warnings.push(message);
    try { fixture.closeBundle(); } finally { console.warn = warn; }
    assert.ok(!existsSync(join(target, 'assets/IWC/derivatives/_DSC1019-3.768 2.avif')), `${outDir} : copie retirée`);
    assert.ok(existsSync(join(target, 'assets/IWC/derivatives/_DSC1019-3.768.avif')), `${outDir} : original intact`);
    assert.deepEqual(warnings.map((message) => message.replace(/ de [^/]+\//, ' de <outDir>/')), ['[cartularia] 1 copie(s) numérotée(s) retirée(s) de <outDir>/ (synchronisation de poste, voir le journal V7).']);
  }
});

test('D8 (c) : removeNumberedCopies retire récursivement les fichiers « nom N.ext » et les dossiers « nom N » vidés, garde tout le reste et compte ce qu’il retire', () => {
  const dist = join(scratch, 'dist-recursif');
  seed(dist, {
    'index.html': '<!doctype html>',
    'browserconfig 3.xml': 'copie racine',
    'cartularia-logo.svg': 'original racine',
    'assets/index-abc12345.js': 'entrée',
    'assets/IWC/derivatives/_DSC1019-3.768.avif': 'original (tiret-chiffre-point : pas une copie)',
    'assets/IWC/derivatives/_DSC1019-3.768 2.avif': 'copie',
    'assets/IWC/derivatives/_DSC1019-3.768 12.webp': 'copie à deux chiffres',
    'assets/IWC/derivatives 2/only 2.avif': 'copie dans un dossier numéroté',
    'assets/IWC/mixte 2/original.avif': 'original dans un dossier numéroté : le dossier reste',
    'assets/IWC/mixte 2/x 2.avif': 'copie',
    'assets/rapport 2': 'sans extension : pas une copie « nom N.ext »',
  });
  const removed = removeNumberedCopies(dist);
  assert.equal(removed, 6, 'browserconfig 3.xml, _DSC1019-3.768 2.avif, _DSC1019-3.768 12.webp, only 2.avif, le dossier derivatives 2 vidé, x 2.avif');
  for (const kept of ['index.html', 'cartularia-logo.svg', 'assets/index-abc12345.js', 'assets/IWC/derivatives/_DSC1019-3.768.avif', 'assets/IWC/mixte 2/original.avif', 'assets/rapport 2']) assert.ok(existsSync(join(dist, kept)), `${kept} conservé`);
  for (const gone of ['browserconfig 3.xml', 'assets/IWC/derivatives/_DSC1019-3.768 2.avif', 'assets/IWC/derivatives/_DSC1019-3.768 12.webp', 'assets/IWC/derivatives 2', 'assets/IWC/mixte 2/x 2.avif']) assert.ok(!existsSync(join(dist, gone)), `${gone} retiré`);
  assert.equal(removeNumberedCopies(dist), 0, 'idempotent : plus rien à retirer');
});

// ---------------------------------------------------------------- D8 / K3 : hosting.ignore des deux sites
test('D8 (c) : firebase.json et firebase.personal.json ignorent « **/* +([0-9]).* » au déploiement (un ou plusieurs chiffres, comme le greffon), et listFiles de firebase-tools exclut bien ces copies', () => {
  const require = createRequire(import.meta.url);
  const { listFiles } = require('firebase-tools/lib/listFiles.js');
  const site = join(scratch, 'site');
  // Relecture V7 : « _DSC1019-3.768 12.webp » (deux chiffres) était livré par l'ancien motif « **/* [0-9].* » ; « logo 2x.png » n'est pas une copie.
  seed(site, { 'index.html': 'x', 'assets/index-abc12345.js': 'x', 'assets/IWC/derivatives/_DSC1019-3.768.avif': 'x', 'assets/IWC/derivatives/_DSC1019-3.768 2.avif': 'copie', 'assets/IWC/derivatives/_DSC1019-3.768 12.webp': 'copie à deux chiffres', 'assets/logo 2x.png': 'x', 'cartularia-logo-monochrome 2.svg': 'copie', 'browserconfig 3.xml': 'copie' });
  for (const [file, publicDir] of [['firebase.json', 'dist'], ['firebase.personal.json', 'dist-personal']]) {
    const { hosting } = JSON.parse(read(file));
    assert.equal(hosting.public, publicDir, file);
    assert.ok(hosting.ignore.includes('**/* +([0-9]).*'), `${file} : hosting.ignore exclut les copies numérotées (extglob : un ou plusieurs chiffres)`);
    assert.ok(!hosting.ignore.includes('**/* [0-9].*'), `${file} : l’ancien motif à un chiffre ne suffit pas (« nom 12.ext » serait livré)`);
    assert.deepEqual(listFiles(site, hosting.ignore).sort(), ['assets/IWC/derivatives/_DSC1019-3.768.avif', 'assets/index-abc12345.js', 'assets/logo 2x.png', 'index.html'], `${file} : la liste de déploiement ne contient aucune copie`);
    assert.ok(listFiles(site, hosting.ignore.filter((pattern) => pattern !== '**/* +([0-9]).*')).length === 8, `${file} : sans le motif, les copies seraient livrées (témoin)`);
    assert.ok(listFiles(site, [...hosting.ignore.filter((pattern) => pattern !== '**/* +([0-9]).*'), '**/* [0-9].*']).includes('assets/IWC/derivatives/_DSC1019-3.768 12.webp'), `${file} : témoin — le motif à un chiffre livre la copie à deux chiffres`);
  }
  // Hypothèses de measure-surfaces (serveur local) et du parcours à chaud : réécriture unique vers index.html, assets immuables.
  const { hosting } = JSON.parse(read('firebase.json'));
  assert.deepEqual(hosting.rewrites, [{ source: '**', destination: '/index.html' }]);
  assert.ok(hosting.headers.find(({ source }) => source === '/assets/**')?.headers.some(({ key, value }) => key === 'Cache-Control' && value === 'public, max-age=31536000, immutable'));
});

// ---------------------------------------------------------------- D11 / V-B5 : assetsInlineLimit refusant .woff2 dans les deux configurations
test('V-B5 (D11) : les deux configurations Vite refusent d’incorporer une police .woff2 en data: et laissent Vite décider du reste', () => {
  for (const [name, config] of [['vite.config.ts', viteConfig], ['vite.personal.config.ts', personalConfig]]) {
    assert.equal(typeof config.build.assetsInlineLimit, 'function', `${name} : assetsInlineLimit par fonction`);
    assert.equal(config.build.assetsInlineLimit('src/assets/fonts/newsreader/newsreader-v26-latin-opsz-wght.woff2', Buffer.alloc(10)), false, `${name} : .woff2 jamais incorporée`);
    assert.equal(config.build.assetsInlineLimit('src/assets/logo.svg', Buffer.alloc(10)), undefined, `${name} : les autres actifs suivent le seuil par défaut`);
  }
  // D11 : le Coffre ne reçoit ni groupes ni greffon en V7 (hors périmètre, non mesuré).
  assert.equal(personalConfig.build.rolldownOptions, undefined);
  assert.deepEqual(personalConfig.plugins.flat().map((plugin) => plugin?.name).filter((name) => name?.startsWith('cartularia')), []);
});

// ---------------------------------------------------------------- D6 / K7 : measure:pf0 étendu
test('D6 / K7 : measure:pf0 mesure initial, plafonne App à 340 000 o / 92 000 o gzip, compte les morceaux, exige un seul icons-*.js et un seul react-*.js préchargé, et refuse toute copie numérotée', () => {
  const source = read('scripts/measure-pf0-build.mjs');
  assert.match(source, /\n  app: 340_000,\n  appGzip: 92_000,\n/, 'budget relevé (D6) avec sa cause datée');
  assert.match(source, /320 000 dépassé depuis V5 point 1 \(c078b2d, 15 septembre 2026/, 'cause datée en commentaire (relecture V7 : le franchissement date de V5 point 1, 313 273 → 323 275 o, pas de V3)');
  for (const key of ['initial', 'javascriptFiles', 'reactChunk', 'iconsChunk', 'iconsImports', 'iconDefinitionFiles', 'numberedCopies']) assert.match(source, new RegExp(`\\n  ${key}: `), `contrôle ${key}`);
  // Dossier témoin conforme : tout est vert ; puis une copie numérotée profonde, puis une seconde définition d'icône : chacune fait échouer.
  const dist = join(scratch, 'pf0');
  const icon = 'var k=a(`database`,[[`ellipse`,{cx:`12`}]]);';
  seed(dist, {
    'index.html': '<script type="module" crossorigin src="/assets/index-aaaaaaaa.js"></script><link rel="modulepreload" crossorigin href="/assets/rolldown-runtime-bbbbbbbb.js"><link rel="modulepreload" crossorigin href="/assets/react-cccccccc.js">',
    'assets/index-aaaaaaaa.js': 'import"./react-cccccccc.js";',
    'assets/rolldown-runtime-bbbbbbbb.js': 'export{}',
    'assets/react-cccccccc.js': 'export const React=1;',
    'assets/icons-dddddddd.js': `import{a}from"./rolldown-runtime-bbbbbbbb.js";import{b}from"./react-cccccccc.js";${icon}`,
    'assets/App-eeeeeeee.js': 'import{k}from"./icons-dddddddd.js";',
    'assets/RegistryApp-ffffffff.js': 'export{}',
    'assets/index-gggggggg.css': 'body{}',
  });
  const run = () => spawnSync(process.execPath, [join(root, 'scripts/measure-pf0-build.mjs'), dist], { encoding: 'utf8' });
  const green = run();
  assert.equal(green.status, 0, green.stderr);
  const report = JSON.parse(green.stdout);
  assert.deepEqual(report.initial.files, ['index-aaaaaaaa.js', 'rolldown-runtime-bbbbbbbb.js', 'react-cccccccc.js']);
  assert.equal(report.initial.bytes, 'import"./react-cccccccc.js";'.length + 'export{}'.length + 'export const React=1;'.length);
  assert.deepEqual(report.iconDefinitionFiles, ['icons-dddddddd.js']);
  assert.deepEqual(report.icons[0].imports, ['rolldown-runtime-bbbbbbbb.js', 'react-cccccccc.js']);
  assert.equal(report.numberedCopies, 0);
  assert.deepEqual(Object.entries(report.checks).filter(([, ok]) => !ok), []);
  assert.deepEqual(report.budgets, { entry: 250_000, initial: 250_000, app: 340_000, appGzip: 92_000, registry: 60_000, largest: 500_000, javascriptFiles: 65, icons: 40_000 });
  seed(dist, { 'assets/IWC/derivatives/_DSC1019-3.768 2.avif': 'copie' });
  const copy = run();
  assert.notEqual(copy.status, 0, 'une copie numérotée profonde doit faire échouer measure:pf0');
  assert.equal(JSON.parse(copy.stdout).numberedCopies, 1);
  assert.equal(JSON.parse(copy.stdout).checks.numberedCopies, false);
  rmSync(join(dist, 'assets/IWC'), { recursive: true });
  seed(dist, { 'assets/App-eeeeeeee.js': `import{k}from"./icons-dddddddd.js";${icon}` });
  const leaked = run();
  assert.notEqual(leaked.status, 0, 'une définition d’icône hors icons-*.js doit faire échouer measure:pf0');
  assert.deepEqual(JSON.parse(leaked.stdout).iconDefinitionFiles.sort(), ['App-eeeeeeee.js', 'icons-dddddddd.js']);
  // Relecture V7 (F4) : témoins rouges des deux contrôles du découpage — icons-*.js important l'entrée applicative (cas réel de la
  // récursion désactivée), puis react-*.js absent des modulepreload de index.html ; chacun est le seul contrôle en échec.
  const failing = (result) => Object.entries(JSON.parse(result.stdout).checks).filter(([, ok]) => !ok).map(([key]) => key);
  seed(dist, { 'assets/App-eeeeeeee.js': 'import{k}from"./icons-dddddddd.js";', 'assets/icons-dddddddd.js': `import{a}from"./rolldown-runtime-bbbbbbbb.js";import{b}from"./react-cccccccc.js";import{c}from"./App-eeeeeeee.js";${icon}` });
  const iconsImportingApp = run();
  assert.notEqual(iconsImportingApp.status, 0, 'icons-*.js important App-*.js doit faire échouer measure:pf0');
  assert.deepEqual(failing(iconsImportingApp), ['iconsImports']);
  seed(dist, {
    'assets/icons-dddddddd.js': `import{a}from"./rolldown-runtime-bbbbbbbb.js";import{b}from"./react-cccccccc.js";${icon}`,
    'index.html': '<script type="module" crossorigin src="/assets/index-aaaaaaaa.js"></script><link rel="modulepreload" crossorigin href="/assets/rolldown-runtime-bbbbbbbb.js">',
  });
  const reactNotPreloaded = run();
  assert.notEqual(reactNotPreloaded.status, 0, 'react-*.js absent des modulepreload de index.html doit faire échouer measure:pf0');
  assert.deepEqual(failing(reactNotPreloaded), ['reactChunk']);
});

// ---------------------------------------------------------------- measure:surfaces
test('V-B2 : measure-surfaces a les garde-fous de l’audit axe (Chrome installé, code 2, réseau coupé), observe le LCP par type, mesure les quatre surfaces et le parcours connexion → Registre, et contrôle des seuils sur --check', () => {
  const source = read('scripts/measure-surfaces.mjs');
  assert.match(source, /process\.env\.CARTULARIA_CHROME/);
  assert.match(source, /if \(!existsSync\(chromePath\)\) \{ console\.error\(`Mesure non exécutée : Chrome introuvable[^\n]*process\.exit\(2\); \}/);
  assert.match(source, /if \(!existsSync\(join\(distDir, 'index\.html'\)\)\) \{ console\.error\(`Mesure non exécutée : build absent[^\n]*process\.exit\(2\); \}/);
  assert.match(source, /\['MAP \* ~NOTFOUND', 'EXCLUDE 127\.0\.0\.1', \.\.\.\(allowFonts \? \['EXCLUDE fonts\.googleapis\.com', 'EXCLUDE fonts\.gstatic\.com'\] : \[\]\)\]/, 'réseau coupé hors 127.0.0.1 ; Google Fonts seulement avec --fonts (retiré au commit C4)');
  assert.match(source, /`--host-resolver-rules=\$\{resolverRules\}`/);
  assert.match(source, /observer\.observe\(\{ type: 'largest-contentful-paint', buffered: true \}\);/);
  assert.doesNotMatch(source, /entryTypes/);
  assert.match(source, /const check = args\.includes\('--check'\);/);
  assert.match(source, /const allowFonts = args\.includes\('--fonts'\);/);
  for (const path of ["{ name: 'accueil', path: '/' }", "{ name: 'connexion', path: '/account/sign-in' }", "{ name: 'demo-cover', path: `${DEMO}#cover` }", "{ name: 'registre', path: '/registry' }"]) assert.ok(source.includes(path), path);
  assert.match(source, /const REGISTRY_ITEMS = '\/registry\/reg_cartularia_demo\/items';/);
  assert.match(source, /\{ name: 'connexion', path: '\/account\/sign-in', settle: 3500 \}, \{ name: 'registre-items', path: REGISTRY_ITEMS, settle: 2000 \}/, 'parcours à chaud : la connexion attend 3,5 s d’inactivité avant l’étape Registre');
  assert.match(source, /width: 390, height: 844, mobile: true/);
  assert.match(source, /width: 1440, height: 900, mobile: false/);
  // C5 (K9) : seuils fixés depuis le relevé du build fusionné (accueil 20 requêtes / 8 JS, connexion 12 JS initiaux, démo 29, Registre 17), marge +2 requêtes / +1 JS.
  assert.match(source, /const LIMITS = \{\n  accueil: \{ requêtes: 22, js: 9 \},\n  connexion: \{ jsInitiaux: 13 \},\n  'demo-cover': \{ js: 30 \},\n  registre: \{ js: 18 \},\n  'registre-items': \{ jsRéseau: 0, réseau: 3 \},\n\};/);
  // C5 : aucun port éphémère dans le relevé (les liens injectés par Vite portent l'origine du serveur local : ramenés au chemin).
  assert.match(source, /const local = \(href\) => \(href && href\.startsWith\(location\.origin\) \? href\.slice\(location\.origin\.length\) : href\);/);
  assert.match(source, /const base = `http:\/\/127\.0\.0\.1:\$\{server\.address\(\)\.port\}`; \/\/ port éphémère : jamais écrit dans le relevé/);
  assert.match(source, /if \(result\.js\.icônes > 0\) violations\.push/, '0 morceau « icône seule » sur chaque surface');
  // C2 (D10) : l'étape Registre du parcours à chaud est contrôlée sur --check (0 JS réseau, ≤ 3 requêtes réseau), pas seulement relevée.
  assert.match(source, /for \(const step of report\.sequence\) \{\n    const limit = LIMITS\[step\.step\] \?\? \{\};/);
  assert.match(source, /if \(limit\.jsRéseau !== undefined && step\.jsRéseau > limit\.jsRéseau\) violations\.push\(/);
  assert.match(source, /if \(limit\.réseau !== undefined && step\.réseau > limit\.réseau\) violations\.push\(/);
  assert.match(source, /docs\/audits\/perf/);
  assert.match(source, /process\.exit\(violations\.length === 0 \? 0 : 1\);/);
  // Le serveur local rejoue la réécriture Hosting et ses en-têtes de cache (parcours à chaud comparable à la production).
  assert.match(source, /'cache-control': immutable \? 'public, max-age=31536000, immutable' : 'no-cache, no-store, must-revalidate'/);
});

// ---------------------------------------------------------------- C2 / D10 : préchargement du Registre depuis la page de connexion
// Lecture AST (technique de tests/performance-wave5.test.mjs) : imports statiques, import() dynamiques et leur position (dans lazy( ou non,
// dans quel appel), appels de fonctions et corps des useEffect.
const parse = (path) => ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const analyze = (path) => {
  const parsed = parse(path);
  const staticImports = new Map();
  const dynamicImports = [];
  const calls = [];
  const visit = (node, callers) => {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) staticImports.set(node.moduleSpecifier.text, node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) ? node.importClause.namedBindings.elements.map((element) => element.name.text) : []);
    let next = callers;
    if (ts.isCallExpression(node)) {
      const callee = node.expression.kind === ts.SyntaxKind.ImportKeyword ? 'import' : node.expression.getText(parsed);
      calls.push({ callee, node, callers });
      if (callee === 'import' && ts.isStringLiteral(node.arguments[0])) dynamicImports.push({ specifier: node.arguments[0].text, callers });
      next = [...callers, callee];
    }
    ts.forEachChild(node, (child) => visit(child, next));
  };
  visit(parsed, []);
  return { parsed, staticImports, dynamicImports, calls };
};
const resolveSpecifier = (from, specifier) => resolve(root, dirname(from), specifier);
const PRELOAD = 'src/features/public/registryPreload.ts';
const ACCOUNT = 'src/features/public/AccountAccessPage.tsx';
const REGISTRY_APP = 'src/features/registry/RegistryApp.tsx';
const REGISTRY_ITEMS = 'src/features/registry/RegistryItems.tsx';

test('C2 (D10) : registryPreload.ts importe dynamiquement RegistryApp et RegistryItems hors de lazy(), les mêmes modules que RootPage / RegistryApp, sans rien importer d’autre ni toucher Firebase', () => {
  const { staticImports, dynamicImports, calls } = analyze(PRELOAD);
  assert.deepEqual([...staticImports.keys()], [], 'aucun import statique : le module ne doit tirer aucun morceau au chargement de la page de connexion');
  assert.deepEqual(dynamicImports.map(({ specifier }) => specifier), ['../registry/RegistryApp.tsx', '../registry/RegistryItems.tsx']);
  for (const { specifier, callers } of dynamicImports) assert.ok(!callers.includes('lazy'), `${specifier} : préchargement, pas une frontière React.lazy`);
  assert.ok(dynamicImports.every(({ callers }) => callers.includes('Promise.allSettled')), 'les deux import() sont regroupés dans Promise.allSettled : un fichier disparu après déploiement ne produit aucun rejet non géré');
  // Identité des modules : ce que RootPage.tsx et RegistryApp.tsx chargent par lazy() — Vite réutilise donc les mêmes morceaux.
  const preloaded = dynamicImports.map(({ specifier }) => resolveSpecifier(PRELOAD, specifier));
  const rootPage = analyze('src/RootPage.tsx').dynamicImports.map(({ specifier }) => resolveSpecifier('src/RootPage.tsx', specifier));
  const registryApp = analyze(REGISTRY_APP).dynamicImports.map(({ specifier }) => resolveSpecifier(REGISTRY_APP, specifier));
  assert.ok(rootPage.includes(resolve(root, REGISTRY_APP)), 'RootPage.tsx charge toujours RegistryApp par lazy()');
  assert.ok(registryApp.includes(resolve(root, REGISTRY_ITEMS)), 'RegistryApp.tsx charge toujours RegistryItems par lazy()');
  assert.deepEqual(preloaded, [resolve(root, REGISTRY_APP), resolve(root, REGISTRY_ITEMS)]);
  // Planification : 1 500 ms d'inactivité, puis requestIdleCallback (délai maximal 1 000 ms → 2 500 ms au plus tard, D10) ou chargement
  // immédiat sans requestIdleCallback ; l'annulation rend le minuteur et la poignée d'inactivité.
  const source = read(PRELOAD);
  assert.match(source, /export const REGISTRY_PRELOAD_DELAY_MS = 1500;/);
  assert.match(source, /export const REGISTRY_PRELOAD_IDLE_TIMEOUT_MS = 1000;/);
  assert.match(source, /typeof window\.requestIdleCallback === 'function'/, 'tolérant à l’absence de requestIdleCallback (Safari, jsdom)');
  assert.match(source, /window\.requestIdleCallback\([^\n]*\{ timeout: REGISTRY_PRELOAD_IDLE_TIMEOUT_MS \}\)/);
  assert.match(source, /window\.setTimeout\(/);
  assert.match(source, /window\.clearTimeout\(timer\);/);
  assert.match(source, /window\.cancelIdleCallback\(idle\);/);
  assert.ok(calls.some(({ callee }) => callee === 'window.setTimeout') && calls.some(({ callee }) => callee === 'window.clearTimeout') && calls.some(({ callee }) => callee === 'window.cancelIdleCallback'));
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /firebase|firestore|getAuth|onSnapshot|getDoc|fetch\(/i, 'jamais d’appel Firebase ni réseau direct (hors commentaires) : le module ne fait qu’importer');
});

test('C2 (D10) : AccountAccessPage planifie le préchargement dans un useEffect gardé (connexion vers le Registre seulement), rend son annulation, et garde window.location.assign vers le Registre démo', () => {
  const { parsed, staticImports, dynamicImports, calls } = analyze(ACCOUNT);
  assert.deepEqual(staticImports.get('./registryPreload.ts'), ['scheduleRegistryPreload']);
  for (const specifier of ['../registry/RegistryApp.tsx', '../registry/RegistryItems.tsx']) assert.ok(!staticImports.has(specifier), `${specifier} jamais importé statiquement par la page de connexion`);
  assert.deepEqual(dynamicImports, [], 'les import() vivent dans registryPreload.ts, pas dans la page');
  const source = read(ACCOUNT);
  assert.match(source, /const registryAhead = !creation && requestedSpace !== 'vault' && \(demoRequested \|\| returnTo\.startsWith\('\/registry'\)\);/, 'garde G4 : ni création, ni Coffre, ni destination hors Registre');
  // L'appel est le retour d'un useEffect dont la dépendance est la garde : une planification par affichage, annulée au démontage.
  const effects = calls.filter(({ callee }) => callee === 'useEffect');
  const preloadEffect = effects.find(({ node }) => node.arguments[0].getText(parsed).includes('scheduleRegistryPreload()'));
  assert.ok(preloadEffect, 'un useEffect appelle scheduleRegistryPreload()');
  assert.equal(preloadEffect.node.arguments[0].getText(parsed).replace(/\s+/g, ' '), '() => { if (!registryAhead) return undefined; return scheduleRegistryPreload(); }');
  assert.equal(preloadEffect.node.arguments[1].getText(parsed), '[registryAhead]');
  const schedule = calls.filter(({ callee }) => callee === 'scheduleRegistryPreload');
  assert.equal(schedule.length, 1);
  assert.deepEqual(schedule[0].callers, ['useEffect'], 'appelé directement dans le useEffect, sans argument (chargement par défaut)');
  assert.equal(schedule[0].node.arguments.length, 0);
  assert.match(source, /window\.location\.assign\(`\/registry\/\$\{encodeURIComponent\(DEMO_ACCOUNT\.registryId\)\}\/items`\);/, 'aucun routeur (D4) : la connexion démo navigue toujours par window.location.assign');
  // Les tests qui rendent la page mockent les deux modules du Registre (M9 : jsdom sans requestIdleCallback, repli 1 500 ms → firebase.ts réel).
  for (const file of ['tests/ui/account-access-corrections.test.tsx', 'tests/ui/registry-preload.test.tsx']) {
    const testSource = read(file);
    assert.match(testSource, /render\(<AccountAccessPage \/>\)/, `${file} rend la page`);
    for (const module of ['RegistryApp', 'RegistryItems']) assert.match(testSource, new RegExp(`vi\\.mock\\('\\.\\./\\.\\./src/features/registry/${module}\\.tsx'`), `${file} : ${module} mocké`);
  }
  assert.match(read('tests/ui/registry-preload.test.tsx'), /scheduleRegistryPreload: vi\.fn\(/, 'le câblage est observé par une enveloppe transparente de scheduleRegistryPreload');
});

// ---------------------------------------------------------------- package.json : test:v7 / verify:v7 — forme de la barrière
// (la définition exacte des scripts et le compte des dépendances sont figés par le contrat, test « V7 (fusion) », K13 : une assertion par invariant).
test('Barrière V7 : test:v7 prolonge test:v6 sans suite d’émulateur et porte performance-v7, verify:v7 enchaîne audit:a11y (qui construit dist/) avant measure:pf0 et measure:surfaces --check', () => {
  const { scripts } = JSON.parse(read('package.json'));
  assert.ok(scripts['test:v7'].startsWith('npm run test:v6 && '), 'test:v7 commence par test:v6');
  assert.match(scripts['test:v7'], /npm run test:performance-hygiene/, 'hygiène des API de performance (measure-surfaces est balayé)');
  assert.match(scripts['test:v7'], /node --test [^&]*tests\/performance-v7\.test\.mjs/);
  assert.doesNotMatch(scripts['test:v7'], /emulators:exec|:emulator/, 'aucune suite d’émulateur dans la barrière (K8)');
  assert.match(scripts['measure:surfaces'], /^node scripts\/measure-surfaces\.mjs --serve dist --out docs\/audits\/perf --check\b/, 'seuils contrôlés (--check) sur dist/, relevé dans docs/audits/perf');
  assert.ok(scripts['verify:v7'].indexOf('npm run audit:a11y') < scripts['verify:v7'].indexOf('npm run measure:pf0') && scripts['verify:v7'].indexOf('npm run measure:pf0') < scripts['verify:v7'].indexOf('npm run measure:surfaces'), 'audit:a11y construit dist/ que les deux mesures lisent');
});
