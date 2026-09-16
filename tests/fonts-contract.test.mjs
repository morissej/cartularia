// V7 (V-B5, commit C4, décision D1 ; greffe G2 du brief polices) — contrat des polices hébergées avec le site : Archivo, JetBrains Mono et
// Newsreader (sous-ensemble latin, fichiers variables identiques à ceux que Google Fonts servait, licence SIL OFL 1.1) sont déclarées par
// src/styles/fonts.css, importée par src/index.css juste après variables.css (le Coffre personnel importe index.css : mêmes @font-face), et
// précharge Newsreader (police du h1) depuis index.html et personal-vault.html ; plus aucune référence à fonts.googleapis.com / fonts.gstatic.com
// dans les documents, les feuilles et les deux CSP. Les fichiers eux-mêmes sont contrôlés (signature wOF2, fenêtre de taille, OFL.txt par
// famille : parade au dépôt d'un mauvais fichier), et, si dist/ existe, le build (trois .woff2 émis sous dist/assets/, jamais en data:, preload
// et url() de la feuille sur la même empreinte). Les mesures réseau (0 requête tierce, 3 polices même origine) sont celles de measure:surfaces --check.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const NUMBERED_COPY = / \d+\.[^/]+$/; // copies « nom N.ext » déposées par la synchronisation du poste, hors git (décision (c), D9)
const walk = (directory, keep) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) return NUMBERED_COPY.test(entry.name) || / \d+$/.test(entry.name) ? [] : walk(path, keep);
  return keep(entry.name) ? [path] : [];
});

const FONTS_CSS = 'src/styles/fonts.css';
const fontsCss = read(FONTS_CSS);
const faces = [...fontsCss.matchAll(/@font-face \{([^}]*)\}/g)].map(([, body]) => body);
const property = (body, name) => body.match(new RegExp(`\\n\\s*${name}: ([^;]+);`))?.[1] ?? null;
const EXPECTED_FACES = [
  { family: "'Archivo'", weight: '400 700', file: 'archivo/archivo-v25-latin-wght.woff2' },
  { family: "'JetBrains Mono'", weight: '400 700', file: 'jetbrains-mono/jetbrains-mono-v24-latin-wght.woff2' },
  { family: "'Newsreader'", weight: '500 600', file: 'newsreader/newsreader-v26-latin-opsz-wght.woff2' },
];
const LATIN_RANGE = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

// ---------------------------------------------------------------- (1) documents
test('index.html et personal-vault.html : plus aucun lien Google Fonts ni preconnect, un seul preload de police (Newsreader, woff2, crossorigin), lang="fr" conservé', () => {
  for (const document of ['index.html', 'personal-vault.html']) {
    const html = read(document);
    assert.match(html, /<html lang="fr">/, `${document} : lang="fr"`);
    assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/, `${document} : aucune URL Google Fonts`);
    assert.doesNotMatch(html, /rel="preconnect"/, `${document} : aucun preconnect (les deux hôtes Google ont disparu avec la feuille)`);
    const preloads = html.match(/<link rel="preload"[^>]*>/g) ?? [];
    assert.equal(preloads.length, 1, `${document} : exactement un preload (Newsreader, police du h1 ; Archivo et JetBrains Mono sont découvertes par la feuille)`);
    assert.match(preloads[0], /^<link rel="preload" as="font" type="font\/woff2" crossorigin href="\/src\/assets\/fonts\/newsreader\/newsreader-v26-latin-opsz-wght\.woff2" \/>$/, `${document} : forme exacte du preload (crossorigin obligatoire pour une police, sinon double téléchargement)`);
    assert.doesNotMatch(html, /rel="stylesheet" href="https?:/, `${document} : aucune feuille distante`);
  }
});

// ---------------------------------------------------------------- (2) feuilles
test('fonts.css déclare trois @font-face (Archivo 400-700, JetBrains Mono 400-700, Newsreader 500-600) en woff2, swap, sous-ensemble latin ; index.css l’importe après variables.css ; aucune feuille ne cite https://fonts.', () => {
  assert.equal(faces.length, 3, 'trois familles, une police variable chacune (feuille Google reproduite : une face par sous-ensemble latin)');
  for (const [index, expected] of EXPECTED_FACES.entries()) {
    const body = faces[index];
    assert.equal(property(body, 'font-family'), expected.family);
    assert.equal(property(body, 'font-style'), 'normal');
    assert.equal(property(body, 'font-weight'), expected.weight, `${expected.family} : plage de poids de la feuille Google (Newsreader n'y déclarait que 500 et 600)`);
    assert.equal(property(body, 'font-display'), 'swap');
    assert.equal(property(body, 'src'), `url('../assets/fonts/${expected.file}') format('woff2')`, `${expected.family} : un seul fichier, relatif à src/styles/ (Vite l'émet avec une empreinte sous dist/assets/)`);
    assert.equal(property(body, 'unicode-range'), LATIN_RANGE, `${expected.family} : même unicode-range latin que la feuille Google`);
  }
  assert.equal(property(faces[0], 'font-stretch'), '100%', 'Archivo : font-stretch 100 % comme la feuille Google (axe wdth du fichier variable)');
  assert.match(fontsCss, /OFL\.txt/, 'en-tête : renvoi à la licence par famille');
  const indexCss = read('src/index.css');
  const variablesAt = indexCss.indexOf("@import './styles/variables.css';");
  const fontsAt = indexCss.indexOf("@import './styles/fonts.css';");
  assert.ok(variablesAt === 0, 'index.css commence par l’import des variables');
  assert.equal(fontsAt, variablesAt + "@import './styles/variables.css';\n".length, 'fonts.css importée juste après variables.css (les @import doivent précéder toute règle)');
  assert.match(read('src/personalVault/main.tsx'), /import '\.\.\/index\.css';/, 'le Coffre personnel importe index.css : mêmes @font-face');
  for (const path of walk(join(root, 'src'), (name) => name.endsWith('.css') && !NUMBERED_COPY.test(name))) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /https:\/\/fonts\./, `${path.slice(root.length)} : aucune police distante`);
  }
  assert.doesNotMatch(read('src/styles/variables.css'), /@import/, 'variables.css : aucun @import (PF4)');
});

// ---------------------------------------------------------------- (3) fichiers
test('chaque url() de fonts.css existe, est un WOFF2 (signature wOF2) de 20 000 à 200 000 octets, et chaque dossier de famille porte OFL.txt (SIL Open Font License 1.1)', () => {
  const urls = [...fontsCss.matchAll(/url\('([^']+)'\)/g)].map(([, url]) => url);
  assert.equal(urls.length, 3);
  for (const url of urls) {
    const path = resolve(root, 'src/styles', url);
    assert.ok(existsSync(path), `${url} : fichier présent`);
    const bytes = readFileSync(path);
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'wOF2', `${url} : signature WOFF2`);
    assert.ok(bytes.length >= 20_000 && bytes.length <= 200_000, `${url} : ${bytes.length} octets (attendu entre 20 000 et 200 000 : sous-ensemble latin d'une police variable, ni tronqué ni complet)`);
    const licence = join(dirname(path), 'OFL.txt');
    assert.ok(existsSync(licence), `${dirname(url)} : OFL.txt à côté du fichier`);
    assert.match(readFileSync(licence, 'utf8'), /SIL Open Font License, Version 1\.1/, `${dirname(url)}/OFL.txt : licence OFL 1.1`);
  }
  const families = readdirSync(join(root, 'src/assets/fonts'), { withFileTypes: true }).filter((entry) => entry.isDirectory() && !/ \d+$/.test(entry.name)).map((entry) => entry.name);
  assert.deepEqual(families.sort(), ['archivo', 'jetbrains-mono', 'newsreader'], 'un dossier par famille, rien d’autre');
  for (const family of families) {
    const files = readdirSync(join(root, 'src/assets/fonts', family)).filter((name) => !NUMBERED_COPY.test(name)).sort();
    assert.equal(files.length, 2, `${family} : un .woff2 et OFL.txt, rien d'autre (${files.join(', ')})`);
    assert.ok(files.includes('OFL.txt'));
    assert.ok(files.some((name) => name.endsWith('.woff2')));
  }
});

// ---------------------------------------------------------------- (4) CSP
test('firebase.json (Report-Only) et firebase.personal.json (appliquée) : CSP sans hôte Google Fonts, font-src même origine', () => {
  const reportOnly = JSON.parse(read('firebase.json')).hosting.headers.find(({ source }) => source === '**').headers.find(({ key }) => key === 'Content-Security-Policy-Report-Only').value;
  assert.doesNotMatch(reportOnly, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.match(reportOnly, /; style-src 'self' 'unsafe-inline'; font-src 'self' data:; /, 'site principal : polices même origine (data: conservé pour les icônes incorporées)');
  const enforced = JSON.parse(read('firebase.personal.json')).hosting.headers.find(({ source }) => source === '**').headers.find(({ key }) => key === 'Content-Security-Policy').value;
  assert.doesNotMatch(enforced, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.match(enforced, /; style-src 'self' 'unsafe-inline'; font-src 'self'; /, 'Coffre personnel : CSP appliquée, polices même origine seulement');
});

// ---------------------------------------------------------------- (5) build
test('dist/ (s’il existe) : trois .woff2 sous dist/assets/, aucune police incorporée en data:, preload de dist/index.html et url() de la feuille sur la même empreinte', { skip: !existsSync(join(root, 'dist/index.html')) && 'dist/ absent : npm run build' }, () => {
  const assets = join(root, 'dist/assets');
  const emitted = readdirSync(assets).filter((name) => name.endsWith('.woff2') && !NUMBERED_COPY.test(name)).sort();
  assert.equal(emitted.length, 3, `trois polices émises (${emitted.join(', ')})`);
  for (const name of emitted) {
    assert.match(name, /^(archivo-v25-latin-wght|jetbrains-mono-v24-latin-wght|newsreader-v26-latin-opsz-wght)-[A-Za-z0-9_-]{8}\.woff2$/, `${name} : nom d'origine + empreinte`);
    assert.equal(readFileSync(join(assets, name)).subarray(0, 4).toString('latin1'), 'wOF2');
    assert.ok(statSync(join(assets, name)).size >= 20_000);
  }
  const stylesheets = readdirSync(assets).filter((name) => name.endsWith('.css') && !NUMBERED_COPY.test(name));
  const referenced = new Set();
  for (const name of stylesheets) {
    const css = readFileSync(join(assets, name), 'utf8');
    assert.doesNotMatch(css, /data:font/, `${name} : aucune police incorporée (assetsInlineLimit refuse .woff2)`);
    for (const [, file] of css.matchAll(/url\(\/assets\/([^)]+\.woff2)\)/g)) referenced.add(file);
  }
  assert.deepEqual([...referenced].sort(), emitted, 'la feuille référence exactement les trois fichiers émis');
  const html = readFileSync(join(root, 'dist/index.html'), 'utf8');
  const preloads = [...html.matchAll(/<link rel="preload"[^>]*as="font"[^>]*>/g)].map(([tag]) => tag);
  assert.equal(preloads.length, 1, 'un preload de police dans dist/index.html');
  const href = preloads[0].match(/href="([^"]+)"/)[1];
  assert.match(href, /^\/assets\/newsreader-v26-latin-opsz-wght-[A-Za-z0-9_-]{8}\.woff2$/, 'href réécrit par Vite vers le fichier émis');
  assert.ok(existsSync(join(root, 'dist', href)), `${href} : fichier présent dans dist/`);
  assert.ok(referenced.has(href.slice('/assets/'.length)), 'même empreinte que l’url() de la feuille : un seul téléchargement');
  assert.match(preloads[0], /crossorigin/, 'preload avec crossorigin (mode CORS des polices)');
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com|rel="preconnect"/);
});
