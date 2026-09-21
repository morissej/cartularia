// V6 — point « cibles-h1 », titres (V-D8) et onglets (D10) : assertions de source, aucun rendu.
// Aucun test ne monte App.tsx ; la borne de taille d'App.tsx et la garde « mini-site » vivent dans
// tests/cartulary-presentation-contract.test.mjs (une seule borne, une seule garde : C3, C4).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readSource = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = readSource('../src/App.tsx');
const css = readSource('../src/index.css');
const presentation = readSource('../src/features/cartulary/components/CartularyPresentation.tsx');

const count = (source, pattern) => (source.match(pattern) ?? []).length;
const MODEL = "\\{specificationValue\\('Modèle', watch\\.reference\\.model\\)\\}";
const BRAND = "\\{specificationValue\\('Marque', watch\\.reference\\.brand\\)\\}";

test('V-D8 (a) : le h1 de couverture sépare la marque du modèle par une espace réelle, dans ses deux variantes (bouton en édition, span en lecture)', () => {
  assert.equal(count(app, new RegExp(`</span>\\{' '\\}<strong>${MODEL}</strong>`, 'g')), 2);
  assert.doesNotMatch(app, new RegExp(`</span><strong>${MODEL}`), 'marque et modèle soudés (« RolexSubmariner » pour tout outil DOM)');
  // Espace sécable voulue : un titre long doit pouvoir se replier sur mobile (jamais d'insécable ici).
  assert.doesNotMatch(app, new RegExp(`</span>\\{'\\\\u00a0'\\}<strong>${MODEL}`));
  // Contrat l. 646 conservé : le <button de la variante d'édition n'est pas sur la ligne du <h1.
  assert.doesNotMatch(app, /<h1[^\n]*<button[^\n]*editable-click-target[^\n]*canEdit &&/);
});

test('C07 : le h1 du rapport imprimé laisse le titre suivre le flux naturel', () => {
  assert.match(app, new RegExp(`<h1>${BRAND}\\{' '\\}${MODEL}</h1>`));
  assert.doesNotMatch(app, new RegExp(`<h1>${BRAND}[^<]*<br />${MODEL}</h1>`));
});

test('V-D8 (c) : un seul h1 dans le document imprimé — le repli cover-watch (mini-site, rapport) est un h2, ses deux sélecteurs suivent', () => {
  assert.match(app, new RegExp(`<div className="cover-sheet__published-title">\\s*<p>${BRAND}</p>\\s*<h2>${MODEL}</h2>`));
  assert.doesNotMatch(app, new RegExp(`<div className="cover-sheet__published-title">\\s*<p>${BRAND}</p>\\s*<h1>`));
  const reportStart = app.indexOf('className="report-print-view"');
  assert.ok(reportStart > 0);
  assert.equal(count(app.slice(reportStart), /<h1[\s>]/g), 1, 'le seul h1 après le rapport est son titre marque + modèle');
  // CSS : la règle typographique et sa variante mobile ciblent le h2 ; plus aucune règle sur le h1 du repli.
  assert.equal(count(css, /\.cover-sheet__published-title > h2 \{/g), 2);
  assert.doesNotMatch(css, /\.cover-sheet__published-title > h1/);
  assert.match(css, /\.cover-sheet__editable-title strong,\n\.cover-sheet__published-title > h2 \{ margin-top: var\(--s1\); overflow-wrap: anywhere; font-family: var\(--font-display\); font-size: clamp\(48px, 7vw, 86px\); font-weight: 500; letter-spacing: -\.04em; line-height: \.92; \}/);
});

test('Coque du Cartulaire : trois h1 seulement (sr-only en édition, couverture, héros de la page 01 « Submariner » seul — D12 (i)) ; pages 02-05 par PageIntroduction', () => {
  const mainStart = app.indexOf('<main id="cartulary-content"');
  assert.ok(mainStart > 0);
  const main = app.slice(mainStart, app.indexOf('</main>', mainStart));
  assert.equal(count(main, /<h1[\s>]/g), 3);
  assert.match(app, new RegExp(`<h1 className="sr-only">${BRAND} ${MODEL}</h1>`));
  assert.match(main, /<h1>\{watch\.reference\.model\}<\/h1>/, 'page 01 : modèle seul, marque en surtitre');
  assert.match(presentation, /<header className="page-intro"><span className="page-intro__number">\{number\}<\/span><h1>\{title\}<\/h1><\/header>/);
});

test('D10 (b) : les onglets lient numéro et libellé par une espace insécable (nom lu « 00 Accueil »), sur la coque et sur la barre du mini-site publié', () => {
  assert.equal(count(app, /<span>\{page\.number\}<\/span>\{'\\u00a0'\}\{page\.label\}/g), 2);
  assert.doesNotMatch(app, /<span>\{page\.number\}<\/span>\s*\{page\.label\}/, 'numéro et libellé soudés (« 00Accueil »)');
  assert.doesNotMatch(app, /<span>\{page\.number\}<\/span>\{' '\}\{page\.label\}/, 'espace sécable : le libellé pourrait se replier sous le numéro');
});
