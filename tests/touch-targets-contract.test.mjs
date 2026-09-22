// V6 — point « cibles-h1 », cibles tactiles (V-D7, seuil 44 px du plan) : assertions de source sur les feuilles de style.
// jsdom ne mesure rien : la hauteur rendue est relevée par le pilote CDP (F3) et en recette téléphone.
// Partie Cartulaire (index.css, piste A, A2) puis partie publique (public-site.css, registry.css, piste B, B2, D11 (a)),
// chacune sous ses propres tests.
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

// ---------------------------------------------------------------------------------------------------------------------
// Partie publique (B2) : accueil, pages d'information, accès au compte (public-site.css) ; barre supérieure et page d'accès
// du Registre (registry.css). Fragments courts : toute retouche de ces règles modifie ce test dans le même commit.
// ---------------------------------------------------------------------------------------------------------------------
const publicCss = readSource('../src/features/public/public-site.css');
const registryCss = readSource('../src/features/registry/registry.css');

/** Corps de la règle dont le sélecteur, en début de ligne (indentation comprise dans `selector`), est exactement `selector` ; chaîne vide si absente. */
const ruleBody = (sheet, selector) => new RegExp(`\\n${escape(selector)} \\{([^}]*)\\}`).exec(sheet)?.[1] ?? '';
/** Tranche d'une requête `@media` jusqu'au repère suivant. */
const mediaSlice = (sheet, from, to) => {
  const start = sheet.indexOf(from);
  const end = sheet.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `bloc « ${from} » introuvable`);
  return sheet.slice(start, end);
};
const publicTablet = mediaSlice(publicCss, '@media (max-width: 1180px) {', '@media (max-width: 720px) {');
const publicMobile = mediaSlice(publicCss, '@media (max-width: 720px) {', '@media (prefers-reduced-motion: reduce) {');
const expectControlSize = (sheet, selector) => {
  const body = ruleBody(sheet, selector);
  assert.ok(body, `règle « ${selector} » absente en début de ligne`);
  assert.match(body, new RegExp(`min-height: ${SIZE};`), `${selector} : min-height 44 px attendue`);
  return body;
};

test('V-D7 accueil : en-tête, liens texte et contact offrent des cibles de 44 px', () => {
  // Logo : règle scopée à l'en-tête public, jamais globale sur .brand-logo-link (logos du rapport, du mini-site et du pied non touchés).
  assert.match(publicCss, new RegExp(`\\n\\.public-header \\.brand-logo-link \\{ min-height: ${SIZE}; \\}\\n`));
  assert.doesNotMatch(publicCss, /\n\.brand-logo-link \{/);
  // Liens de navigation : une ancre en ligne ignore min-height, d'où inline-flex + centrage vertical.
  const nav = expectControlSize(publicCss, '.public-header nav a');
  assert.match(nav, /display: inline-flex;/);
  assert.match(nav, /align-items: center;/);
  for (const selector of ['.public-text-link', '.public-copy-email-btn']) {
    expectControlSize(publicCss, selector);
  }
  // Case de consentement : le label est la cible (44 px), la case reste 16 px (exemption WCAG 2.5.8 : son label fait la taille).
  expectControlSize(publicCss, '.public-contact__consent');
  assert.match(ruleBody(publicCss, '.public-contact__consent input'), /width: 16px; min-height: 16px;/);
  // C13 : le bloc de neuf liens du pied de page est supprimé ; les liens légaux restent en texte lisible.
  assert.doesNotMatch(readSource('../src/features/public/HomePage.tsx'), /Navigation de pied de page/);
  assert.match(readSource('../src/features/public/PublicChrome.tsx'), /className="public-footer__legal"/);
});

test('V-D7 accueil mobile : menu ouvert à 4 px d’écart sous calc(100dvh - 84px)', () => {
  const nav = ruleBody(publicTablet, '  .public-header nav');
  assert.match(nav, /gap: 4px;/);
  assert.doesNotMatch(nav, /gap: 16px;/);
  assert.match(nav, /max-height: calc\(100dvh - 84px\);/);
  assert.match(nav, /overflow-y: auto;/);
  assert.match(ruleBody(publicMobile, '  .public-footer__legal'), /flex-direction: column/);
});

test('V-D7 pages d’information et d’accès : navigation, retours, « Mot de passe oublié » en 44 px, mailto en phrase inchangé', () => {
  // Règle à deux sélecteurs (navigation d'information + lien isolé de retour direct sous main) : forme exacte.
  assert.match(publicCss, new RegExp(`\\n\\.service-information-page nav a,\\n\\.service-information-page main > a \\{ display: inline-flex; align-items: center; min-height: ${SIZE}; \\}\\n`));
  // Le lien mailto en phrase (`main p a`) n'est pas ciblé : `main a` ne porte que couleur et soulignement.
  assert.doesNotMatch(ruleBody(publicCss, '.service-information-page main a'), /min-height/);
  // Retour à l'accueil (icône seule sous 820 px : font-size 0) et logo : 44 × 44 au moins, contenu centré.
  const back = expectControlSize(publicCss, '.account-access-header > a');
  assert.match(back, new RegExp(`min-width: ${SIZE};`));
  assert.match(back, /justify-content: center;/);
  assert.match(ruleBody(mediaSlice(publicCss, '@media (max-width: 820px) {', '\n}'), '  .account-access-header > a'), /font-size: 0;/);
  // « Mot de passe oublié ? Utiliser mon kit de secours » : ancre directe du formulaire de connexion.
  const recovery = expectControlSize(publicCss, '.account-space-grid form > a');
  assert.match(recovery, /display: inline-flex;/);
});

test('V-D7 Registre (D11 (a)) : barre supérieure et page d’accès en 44 px, périmètre limité (actions internes hors lot)', () => {
  for (const selector of ['.registry-signout', '.registry-home-link']) {
    expectControlSize(registryCss, selector);
    assert.doesNotMatch(ruleBody(registryCss, selector), /min-height: 40px;/, `${selector} : ancienne hauteur 40 px`);
  }
  // Sélecteur de contexte (topbar, à partir de deux Registres) : 36 → 44 px en bureau ; le mobile l'avait déjà (B1).
  expectControlSize(registryCss, '.registry-context-select select');
  assert.doesNotMatch(ruleBody(registryCss, '.registry-context-select select'), /min-height: 36px;/);
  // Marque de la topbar et logo de la page d'accès : règles scopées, jamais globales sur .brand-logo-link.
  assert.match(registryCss, new RegExp(`\\n\\.registry-brand \\.brand-logo-link \\{ min-height: ${SIZE}; \\}\\n`));
  // Conteneur de la marque en flex : en block, le lien inline-flex ajoute la descente de ligne (bloc mesuré 47 px pour un lien de 44).
  assert.match(ruleBody(registryCss, '.registry-brand'), /display: flex; width: 176px;/);
  assert.match(registryCss, new RegExp(`\\n\\.registry-auth-logo \\.brand-logo-link \\{ min-height: ${SIZE}; \\}\\n`));
  assert.doesNotMatch(registryCss, /\n\.brand-logo-link \{/);
  // « Créer un compte Cartularia », « Mot de passe oublié ? … », « Retour à l'accueil » (démo) : ancres de grille, centrées.
  const create = expectControlSize(registryCss, '.registry-auth-create-link');
  assert.match(create, /display: inline-flex; align-items: center; justify-content: center;/);
  assert.match(create, /text-align: center;/);
  // La barre latérale mobile reste verrouillée par tests/registry-public-mobile-contract.test.mjs (56 px ≥ 44) : rien à figer ici (C2).
});
