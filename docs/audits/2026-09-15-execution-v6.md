# Exécution V6 — « Mobile et accessibilité » (15-16 septembre 2026)

Plan : `docs/audits/2026-09-08-plan-actions-par-vagues.md` § V6 (V-D3 à V-D10). Branche `feat/lecteur-unique-adr-028-031`, ouverture à `109cc85` (V5 close, lot B en production). Analyse du 15 septembre : six lectures avec mesures sur le build local (Chrome 152 headless piloté par le protocole DevTools, 390 × 844 et 360 × 780, réseau coupé hors localhost et polices), deux propositions par point, un juge par point, une critique de cohérence (scratchpad `v6/` : `lecture-*.md`, `proposition-*.md`, `brief-*.md`, `coherence.md`, mesures `mesure-*.json`, captures `shot-*.png`).

## 1. Constat mesuré et périmètre

- V-D3 : la piste d'onglets du Cartulaire défile déjà (`overflow-x: auto`, `index.css:445`) mais sans indice de débordement ; `min-width: 98px` par onglet porte la piste à 676 px pour 390 ; « 03 L'objet » coupé, « 04 », « 05 » et « Preuves » hors écran ; `navigateTo` ne ramène jamais l'onglet actif dans la piste (au lien profond `#value`, l'onglet actif est hors champ) ; barre collante `top: 69px` alors que `.dossier-bar` mesure 61 px (jour de 8 px). Nom d'onglet lu « 00Accueil » (numéro et libellé collés).
- V-D4 : la page Valorisation déborde (document 420 px pour 390, chiffre de l'audit retrouvé) mais le responsable n'est pas un tableau : c'est le graphique « Évolution du marché » (`.market-bars`, cinq barres de 66 px minimum + 12 px d'écart = 378 px dans une carte de 308) ; les tableaux de sensibilité et de dépenses ont déjà un défilement interne (sans colonne collante ni indice). Les cinq autres pages de la démo et l'accueil tiennent dans 390 px.
- V-D5 : les libellés sous les icônes et le lien d'accueil unique sont déjà en place à `109cc85` ; restent l'orpheline de la grille 4 colonnes × 9 entrées, la barre collante de 203 px et l'en-tête de 178 à 243 px. V-D6 : le bandeau de l'accueil n'est pas reproduit (h1 à 174 px) ; les onglets de la maquette de démonstration débordent sans indice.
- V-D7 : 5 cibles < 44 px sur la démo (barre du Cartulaire 21 px, bascule de langue), 35 sur l'accueil bureau, 20 en mobile. V-D8 : une seule page est montée à la fois (un `h1` à l'écran), mais le `h1` de couverture lit « RolexSubmariner » (deux `span` sans espace) et la page 01 porte un second `h1` marque + modèle.
- V-D9 : bascule FR/EN partielle (144 nœuds FR sur 587 en mode EN sur la démo, ≈ 60 d'interface ; Registre, accueil, Cercle, Collection FR par construction ≈ 1 100 chaînes), `lang="en"` posé sur un document majoritairement français. V-D10 : « mini -site » dans `cartularyPresentationContract.ts:26`, `GenericCartularyView.tsx:174` et un test ; titre jamais rendu (absent du bundle) : dette de code.
- Audit automatique d'accessibilité : aucun outil dans le dépôt.

Périmètre : CSS et balisage seuls, aucun serveur, aucune règle ; `App.tsx` ne grossit pas ; littéraux du contrat V4/V5 intacts.

## 2. Décisions

| # | Décision | Retenu |
|---|---|---|
| D1 | Bascule FR/EN partielle (V-D9) | (a) bascule masquée maintenant et préférence stockée non relue (`lang="fr"`) ; traduction du Cartulaire planifiée depuis l'inventaire (≈ 115 points) ; réversible |
| D2 | Forme du masquage | retrait pur (−40 lignes) |
| D3 | Version du contrat après V-D10 | (a) `cartulary-presentation@1.4.0` conservée (titre jamais rendu) |
| D4 | Révélation de l'onglet actif | (b) crochet `useRevealActiveTab` (lien profond, historique, tourne-page, clic) |
| D5 | `.page-turner { overflow-anchor: none }` | (a) inclus |
| D6 | Graphique « Évolution du marché » à 390 px | (a) défilement interne depuis le début de l'historique (CSS seul) |
| D7 | Barre du Registre mobile | statique 3 × 3 (169 px), jamais collante |
| D8 | Déconnexion en mobile | (a) libellé visible « Déconnexion », nom accessible « Se déconnecter » |
| D9 | Fixture du Registre sans session pour l'audit | reportée (réplique statique + recette téléphone) |
| D10 | Onglets « 00Accueil » | (b) espace insécable entre numéro et libellé (nom lu « 00 Accueil ») |
| D11 | Périmètre des 44 px au Registre | (a) barre supérieure et page d'accès |
| D12 | `h1` de la page 01 | (i) « Submariner » seul, marque en surtitre |
| D13 | Décalage collant | (a) littéral `69px` exact par arithmétique de la barre (61 → 69 px) |
| D14 | Borne d'`App.tsx` | (b) valeur mesurée après intégration (≤ 3 473) |
| D15 | Audit automatique | (a) `axe-core` (unique devDependency) injecté par pilote CDP sur le Chrome installé, `scripts/audit-accessibility.mjs`, hors `test:v6`, dans `verify:v6` ; arrêt explicite si Chrome manque |
| D16 | `jsx-a11y` dans oxlint | (a) huit règles à 0 constat en erreur |
| D17 | Violations axe hors briefs | (a) corriger les trois à coût nul (deux contrastes locaux, `role="group"` sur le carrousel), les trois autres en liste d'exceptions datée avec échéance V7 |
| D18 | Libellés de la barre du Registre mobile à 9 px | (a) conservés en V6, relevé en recette téléphone |

## 3. Ordre d'intégration

Piste A (Cartulaire, série) : A0 « mini-site » (trois fichiers) → A1 traduction (bascule retirée, `interfaceState`, `BarreDossier`, `App.tsx` −4, `index.css` −20) → A2 cibles et `h1` (partie Cartulaire) → A3 mobile (`useRevealActiveTab`, ombres d'indice, `.dossier-bar` 69 px, graphique défilant, test contrat V6). Piste B (Registre et accueil, parallèle) : B1 Registre et accueil mobile (`RegistryApp`, `registry.css`, `HomePage`, `public-site.css`) → B2 cibles publiques. Fusion : `test:v6` (une seule définition), `audit:a11y` + `verify:v6`, `.oxlintrc.json`, dédoublonnage des tests ; barrière complète ; mesures CDP sur le build fusionné (390/360/430/1 280) ; journal ; Hosting ; recette téléphone.
