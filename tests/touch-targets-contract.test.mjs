// V6 — point « cibles-h1 », cibles tactiles (V-D7, seuil 44 px du plan) : assertions de source sur les feuilles de style.
// jsdom ne mesure rien : la hauteur rendue est relevée par le pilote CDP (F3) et en recette téléphone.
// Partie Cartulaire (index.css). La partie publique (public-site.css, registry.css) est livrée par la piste B (B2) et
// s'ajoute ici sous son propre test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readSource = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = readSource('../src/index.css');
const variables = readSource('../src/styles/variables.css');

// Jeton existant (variables.css) ou littéral équivalent : les deux formes sont acceptées, la convention d'index.css est le jeton.
const SIZE = '(44px|var\\(--control-size\\))';
const escape = (selector) => selector.replace(/[.>()]/g, '\\$&');
// Règle multi-lignes ouverte en début de ligne : « \n<sélecteur> {\n … min-height: 44px; ».
const blockRule = (selector) => new RegExp(`\\n${escape(selector)} \\{[^}]*min-height: ${SIZE};`);
const mobileStart = css.indexOf('@media (max-width: 767px) {');
const mobile = css.slice(mobileStart, css.indexOf('@media (prefers-reduced-motion: reduce) {', mobileStart));

test('V-D7 : la barre du Cartulaire et ce qui la suit offrent des cibles de 44 px (logo, « À faire », « Retour au Registre »), par le jeton unique --control-size', () => {
  assert.match(variables, /--control-size: 44px;/);
  // Logo : règle scopée à la barre du dossier, jamais globale sur .brand-logo-link (logo du rapport, du mini-site et de l'accueil non touchés).
  assert.match(css, new RegExp(`\\n\\.dossier-bar__logo \\.brand-logo-link \\{ min-height: ${SIZE}; \\}\\n`));
  assert.doesNotMatch(css, new RegExp(`\\n\\.brand-logo-link \\{[^}]*min-height`));
  for (const selector of ['.cartulary-registry-return', '.todo-trigger']) {
    assert.match(css, blockRule(selector), selector);
    assert.doesNotMatch(css, new RegExp(`\\n${escape(selector)} \\{[^}]*min-height: 34px;`), `${selector} : ancienne hauteur 34 px`);
  }
  // Mobile : « À faire » réduit à son icône garde 44 px de large (44 × 44).
  assert.match(mobile, new RegExp(`\\n  \\.todo-trigger \\{ width: ${SIZE}; padding: 0; justify-content: center; \\}\\n`));
  assert.doesNotMatch(mobile, /\.todo-trigger \{ width: 42px;/);
});

test('V-D7 : le lien « Télécharger » des médias fait 44 px, y compris en variante compacte (padding et police compacts conservés)', () => {
  assert.match(css, blockRule('.media-download-link'));
  assert.doesNotMatch(css, /\n\.media-download-link \{[^}]*min-height: 42px;/);
  assert.match(css, /\n\.media-download-link--compact \{ padding-inline: var\(--s3\); font-size: 9px; \}\n/);
  assert.doesNotMatch(css, /\.media-download-link--compact \{[^}]*min-height/);
});

test('D13 (a) : le décalage collant 69 px des onglets et du popover « À faire » est exact par arithmétique de la barre (2 × --s3 + --control-size + 1 px de bordure)', () => {
  const token = (name) => Number(variables.match(new RegExp(`${name}: (\\d+)px;`))[1]);
  const barHeight = 2 * token('--s3') + token('--control-size') + 1;
  assert.equal(barHeight, 69);
  // L'arithmétique n'est exacte que si le plus haut enfant de la barre mesure --control-size : le logo et « À faire » le garantissent
  // (HEAD : 34 px → barre de 61 px, jour de 8 px sous les onglets collants).
  assert.match(css, /\n\.dossier-bar__logo \.brand-logo-link \{ min-height: var\(--control-size\); \}\n/);
  assert.match(css, /\n\.todo-trigger \{\n  display: inline-flex;\n  min-height: var\(--control-size\);\n/);
  // Regex tolérante à un futur jeton --dossier-bar-height (V7) ; tant qu'il n'existe pas, le littéral vaut la valeur calculée.
  const TOP = '(69px|var\\(--dossier-bar-height\\))';
  assert.match(css, new RegExp(`\\n\\.page-tabs \\{\\n  position: sticky;\\n  top: ${TOP};`));
  assert.match(mobile, new RegExp(`\\n  \\.page-tabs \\{ top: ${TOP}; \\}\\n`));
  assert.match(mobile, new RegExp(`\\n  \\.todo-popover \\{ position: fixed; top: ${TOP}; right: var\\(--s3\\); \\}\\n`));
  if (css.includes('--dossier-bar-height')) {
    assert.match(variables, /--dossier-bar-height: calc\(var\(--control-size\) \+ 2 \* var\(--s3\) \+ 1px\);/);
  } else {
    assert.equal(Number(css.match(/\n\.page-tabs \{\n  position: sticky;\n  top: (\d+)px;/)[1]), barHeight);
  }
  // La barre du dossier garde son rembourrage mobile (--s3 vertical) : la hauteur calculée reste vraie sous 768 px.
  assert.match(mobile, /\n  \.dossier-bar \{ padding: var\(--s3\) var\(--s4\) !important; \}\n/);
  // Les onglets eux-mêmes dépassent le seuil (54 px).
  assert.match(css, /\n\.page-tabs button \{\n  min-height: 54px;/);
});
