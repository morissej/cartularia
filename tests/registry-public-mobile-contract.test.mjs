// V6 — point « registre-accueil-mobile » (V-D5, V-D6, D7, D8, D18) : assertions de source, sans navigateur.
// Complète tests/cartulary-presentation-contract.test.mjs (index.css / App.tsx) pour registry.css, RegistryApp.tsx,
// public-site.css et HomePage.tsx. Fragments courts (une assertion = une propriété nommée) : toute retouche de ces
// règles modifie ce test dans le même commit. Les hauteurs, le fondu et le nom accessible réel sont mesurés en
// navigateur (journal V6) — jsdom ne met pas en page.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { REGISTRY_SIDEBAR_SECTIONS } from '../src/features/registry/registryRouting.ts';

const root = new URL('../', import.meta.url);
const readSource = (path) => readFileSync(new URL(path, root), 'utf8');

/** Tranche `@media (max-width: 720px)` (le premier bloc) jusqu'au bloc `prefers-reduced-motion` qui le suit. */
const mobileSlice = (css, label) => {
  const start = css.indexOf('@media (max-width: 720px) {');
  const end = css.indexOf('@media (prefers-reduced-motion: reduce) {', start);
  assert.ok(start >= 0 && end > start, `bloc mobile 720 px introuvable dans ${label}`);
  return css.slice(start, end);
};

/** Corps de la première règle dont le sélecteur, en début de ligne, est exactement `selector` (chaîne vide si absente). */
const ruleBody = (css, selector) => {
  const match = new RegExp(`(?:^|\\n)[ \\t]*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(css);
  return match ? match[1] : '';
};

// Contraste WCAG 2.x (luminance relative) : un texte figé doit rester ≥ 4,5:1 sur son fond figé.
const luminance = (hex) => {
  const [r, g, b] = [0, 2, 4]
    .map((offset) => parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (foreground, background) => {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
};

const registryCss = readSource('src/features/registry/registry.css');
const registryMobile = mobileSlice(registryCss, 'registry.css');
const registryApp = readSource('src/features/registry/RegistryApp.tsx');
const publicCss = readSource('src/features/public/public-site.css');
const publicMobile = mobileSlice(publicCss, 'public-site.css');
const homePage = readSource('src/features/public/HomePage.tsx');

test('V-D5 — barre du Registre mobile : grille 3 × 3 sans orpheline, libellés visibles, jamais collante (D7)', () => {
  // 9 entrées (tests/registry-navigation.test.mjs fige l'effectif) = 3 rangées pleines ; une 10ᵉ section échoue ici, explicitement.
  assert.equal(REGISTRY_SIDEBAR_SECTIONS.length % 3, 0, 'l’effectif de la barre latérale n’est plus un multiple de 3 : revoir la grille mobile');
  const nav = ruleBody(registryMobile, '.registry-sidebar nav');
  assert.match(nav, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(nav, /repeat\(4/);
  const link = ruleBody(registryMobile, '.registry-sidebar nav a');
  assert.match(link, /min-height: 56px/);
  const label = ruleBody(registryMobile, '.registry-sidebar nav a span');
  assert.match(label, /font-size: 11px/);
  assert.doesNotMatch(label, /display: none/);
  // Barre statique : la navigation entre sections ramène déjà en haut et déplace le focus (navigateRegistry).
  const sidebar = ruleBody(registryMobile, '.registry-sidebar');
  assert.match(sidebar, /position: static/);
  assert.doesNotMatch(sidebar, /position: sticky/);
  assert.match(registryApp, /window\.scrollTo\(\{ top: 0, behavior: 'instant' \}\);\n\s*if \(options\.focus !== false\) focusRegistryMainContent\(\);/);
});

test('V-D5 — topbar du Registre mobile : zones nommées, trois actions 44 px sur la rangée du logo, libellé sur une ligne', () => {
  const topbar = ruleBody(registryMobile, '.registry-topbar');
  assert.match(topbar, /position: static/);
  assert.match(topbar, /grid-template-areas: "brand actions" "label label" "context context"/);
  assert.match(ruleBody(registryMobile, '.registry-brand'), /grid-area: brand/);
  assert.match(ruleBody(registryMobile, '.registry-topbar__actions'), /grid-area: actions/);
  assert.match(ruleBody(registryMobile, '.registry-topbar__actions'), /flex-wrap: wrap/);
  const actions = ruleBody(registryMobile, '.registry-home-link, .registry-signout');
  assert.match(actions, /min-height: var\(--control-size\)/);
  assert.match(ruleBody(registryMobile, '.registry-context-select'), /grid-area: context/);
  assert.match(ruleBody(registryMobile, '.registry-context-select select'), /min-height: var\(--control-size\)/);
  const productLabel = ruleBody(registryMobile, '.registry-product-label');
  assert.match(productLabel, /grid-area: label/);
  assert.match(productLabel, /grid-template-columns: auto minmax\(0, 1fr\)/);
  // Relecture V6 (REG-3) : point médian décoratif entre marque et modèle, texte alternatif vide — jamais lu « point médian » (mesuré : aucun nœud AX).
  assert.match(ruleBody(registryMobile, '.registry-product-label span::after'), /content: ' ·' \/ '';/);
  // L'ancien placement manuel de la déconnexion a disparu avec le groupe d'actions.
  assert.doesNotMatch(registryCss, /registry-signout--account/);
  assert.doesNotMatch(registryApp, /registry-signout--account/);
  // Base bureau : le groupe existe et le libellé court n'y est pas rendu.
  assert.match(ruleBody(registryCss, '.registry-topbar__actions'), /display: flex/);
  assert.match(ruleBody(registryCss, '.registry-topbar__label-short'), /display: none/);
});

test('D8 (a) — nom accessible stable des actions : libellé long en sr-only (jamais display: none), libellé court aria-hidden', () => {
  const long = ruleBody(registryMobile, '.registry-topbar__label-long');
  assert.match(long, /clip: rect\(0 0 0 0\)/);
  assert.match(long, /position: absolute/);
  assert.doesNotMatch(long, /display: none/);
  assert.match(ruleBody(registryMobile, '.registry-topbar__label-short'), /display: inline/);
  assert.match(registryApp, /function TopbarLabel\(\{ long, short \}/);
  assert.match(registryApp, /<span className="registry-topbar__label-long">\{long\}<\/span>/);
  assert.match(registryApp, /<span className="registry-topbar__label-short" aria-hidden="true">\{short\}<\/span>/);
  // Déconnexion : « Déconnexion » visible en mobile, nom accessible « Se déconnecter » (décision D8 (a)).
  assert.match(registryApp, /<TopbarLabel long="Se déconnecter" short="Déconnexion" \/>/);
  assert.match(registryApp, /<TopbarLabel long="Site d’accueil" short="Accueil" \/>/);
  assert.match(registryApp, /<TopbarLabel long="Sécurité et kit de secours" short="Sécurité" \/>/);
});

test('V-D5 — DOM de la coque : un composant d’actions partagé, un seul lien d’accueil, règles orphelines purgées', () => {
  assert.match(registryApp, /function RegistryTopbarActions\(\{ securityHref, onSignOut \}/);
  assert.equal(registryApp.match(/<RegistryTopbarActions/g)?.length, 2, 'RegistryShell et RegistryChooser partagent le composant');
  const actions = registryApp.slice(registryApp.indexOf('function RegistryTopbarActions'), registryApp.indexOf('function RegistryChooser'));
  assert.equal(actions.match(/href="\/"/g)?.length, 1, 'un seul lien vers le site d’accueil dans les actions');
  const shell = registryApp.slice(registryApp.indexOf('<header className="registry-topbar">'), registryApp.indexOf('<div className="registry-layout">'));
  assert.doesNotMatch(shell, /href="\/"/, 'aucun lien d’accueil hors du composant partagé');
  assert.doesNotMatch(shell, /className="registry-home-link"|className="registry-signout"/);
  assert.match(shell, /<BrandLogo href=\{registryHref\(registry\.id\)\} \/>/);
  assert.doesNotMatch(registryCss, /registry-sidebar__home/);
  assert.doesNotMatch(registryApp, /registry-sidebar__home/);
  // Relecture V6 (REG-2) : trois comportements V5 déplacés par la refonte, jamais verrouillés (fragments courts) — lien Sécurité rendu seulement
  // s'il est fourni, absent du Registre démo, déconnexion sous la garde des modifications non enregistrées.
  assert.match(actions, /\{securityHref && \(/, 'lien Sécurité conditionnel');
  assert.match(shell, /securityHref=\{registry\.id !== DEMO_ACCOUNT\.registryId \? `\/account\/security\?returnTo=/, 'pas de lien Sécurité sur le Registre démo');
  assert.match(shell, /onSignOut=\{\(\) => \{ if \(confirmUnsavedNavigation\(\)\) void signOutOfCartularia\(\); \}\}/, 'déconnexion gardée');
});

test('V-D6 — accueil mobile : bandeau court conservé, onglets de la maquette défilants avec fondu d’indice', () => {
  // Le logo (980 × 240 en attributs) ne reprend jamais sa hauteur d'attribut ; en-tête 70 px, hero à 48 px.
  assert.match(ruleBody(readSource('src/index.css'), '.brand-logo'), /height: auto/);
  assert.match(ruleBody(publicCss, '.public-header .brand-logo'), /height: auto/);
  assert.match(ruleBody(publicMobile, '.public-header'), /min-height: 70px/);
  assert.match(ruleBody(publicMobile, '.public-hero'), /padding-block: 48px/);
  // L'aside ne défile plus : l'enveloppe interne porte le défilement, le fondu et l'espace de fin.
  const aside = ruleBody(publicMobile, '.public-product-window__body aside');
  assert.doesNotMatch(aside, /overflow-x: auto/);
  // L'aside est un élément de grille : sans `min-width: 0`, sa largeur min-content (six onglets nowrap) élargit la colonne à 722 px (mesuré).
  assert.match(aside, /min-width: 0/);
  const tabs = ruleBody(publicMobile, '.public-product-window__tabs');
  assert.match(tabs, /overflow-x: auto/);
  assert.match(tabs, /(^|[^-])mask-image: linear-gradient\(90deg, #000 calc\(100% - 40px\), transparent\)/);
  assert.match(tabs, /-webkit-mask-image: linear-gradient\(90deg, #000 calc\(100% - 40px\), transparent\)/);
  assert.match(ruleBody(publicMobile, '.public-product-window__tabs::after'), /flex: 0 0 32px/);
  assert.match(ruleBody(publicMobile, '.public-tab-btn'), /white-space: nowrap/);
  // Bureau : l'enveloppe reprend la colonne de l'aside (rendu 1 280 inchangé).
  assert.match(ruleBody(publicCss, '.public-product-window__tabs'), /display: grid/);
  assert.match(homePage, /<div className="public-product-window__tabs">\s*\{HERO_DEMO_TABS\.map/);
});

test('a11y accueil — lien d’évitement lisible au focus, contrastes de la bande sombre, rôle du groupe, main focalisable', () => {
  // `.public-site a { color: inherit }` (0,1,1) l'emportait sur `.skip-link { color: var(--sheet) }` (0,1,0) : encre sur encre.
  assert.match(publicCss, /\.public-site \.skip-link \{ color: var\(--sheet\); \}/);
  const dark = publicCss.match(/--public-dark: (#[0-9a-fA-F]{6});/)[1];
  const kicker = ruleBody(publicCss, '.public-spaces .public-kicker').match(/color: (#[0-9a-fA-F]{6})/)?.[1];
  assert.ok(kicker, 'kicker de la bande sombre sans couleur dédiée');
  assert.ok(contrast(kicker, dark) >= 4.5, `kicker ${kicker} sur ${dark} : ${contrast(kicker, dark).toFixed(2)}:1`);
  const card = ruleBody(publicCss, '.public-space-grid article').match(/background: (#[0-9a-fA-F]{6})/)[1];
  const number = ruleBody(publicCss, '.public-space-grid__number').match(/color: (#[0-9a-fA-F]{6})/)[1];
  assert.ok(contrast(number, card) >= 4.5, `numéro ${number} sur ${card} : ${contrast(number, card).toFixed(2)}:1`);
  // `aria-label` n'est permis que sur un élément porteur de rôle ; `main` reçoit le focus du lien d'évitement.
  assert.match(homePage, /<div className="public-hero__product" role="group" aria-label=/);
  assert.match(homePage, /<main id="main-content" tabIndex=\{-1\}>/);
});
