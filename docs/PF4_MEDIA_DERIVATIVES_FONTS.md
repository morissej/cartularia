# PF4 — Dérivés médias et polices

Date de validation locale : 18 août 2026.

## Causes traitées

La baseline PF0 chargeait les JPEG IWC de 800 ou 1 200 pixels quelle que soit
leur surface d'affichage. La photographie principale était ainsi transférée
depuis l'original même sur une carte ou une vignette. La feuille Google Fonts
était en outre découverte tardivement par un `@import` placé dans
`variables.css`.

Les originaux ont une fonction probatoire et ne doivent être ni remplacés ni
réencodés. PF4 crée donc une couche de présentation distincte.

## Correction

- Les 19 JPEG sources sont conservés byte pour byte.
- Chaque source possède quatre largeurs sans suréchantillonnage : 240, 480,
  768 et sa largeur native de 800 ou 1 200 pixels.
- Chaque largeur est produite en WebP et AVIF, soit 152 dérivés.
- Les images du Cartulaire utilisent `<picture>` dans l'ordre AVIF, WebP, puis
  JPEG source.
- `srcset`, `sizes`, `width`, `height` et `aspect-ratio` réservent l'espace et
  laissent le navigateur choisir une résolution adaptée à son DPR.
- Le lecteur 360° précharge et affiche les vues WebP 768 px ; il ne lit plus les
  JPEG probatoires pour l'animation.
- La Galerie pilote utilise un WebP 480 px pour les cartes et un WebP 800 ou
  1 200 px pour le diaporama. Un média privé distant sans dérivé autorisé garde
  son parcours sécurisé existant.
- Les posters vidéo du carrousel et de la modale utilisent un WebP 768 px.
- L'`@import` Google Fonts a été supprimé. Le document déclare désormais les
  deux `preconnect` et la feuille de style directement dans le `<head>`.

L'auto-hébergement WOFF2 reste une option ultérieure : il n'est pas nécessaire
pour supprimer la chaîne de découverte CSS traitée par cette vague.

## Intégrité et reproductibilité

`scripts/generate-presentation-derivatives.mjs` génère les fichiers avec
Sharp. Le manifeste `public/assets/IWC/derivatives/manifest.json` enregistre
l'empreinte SHA-256 et la taille de chaque original et de chaque dérivé.

La commande suivante échoue si un original ou un dérivé ne correspond plus au
manifeste :

```bash
npm run media:derivatives:check
```

## Transfert média agrégé

Les 19 JPEG sources représentent 3 076 289 octets.

| Largeur | WebP | Gain | AVIF | Gain |
| --- | ---: | ---: | ---: | ---: |
| 240 px | 137 160 o | 95,5 % | 75 014 o | 97,6 % |
| 480 px | 383 826 o | 87,5 % | 197 913 o | 93,6 % |
| 768 px | 731 074 o | 76,2 % | 375 975 o | 87,8 % |

Ces sommes comparent une même largeur pour les 19 images. Une page ne charge
pas les 19 fichiers à la fois et le navigateur ne télécharge qu'un format par
image.

## Verrous de non-régression

- 19 empreintes sources vérifiées ;
- 152 dérivés présents, deux formats par largeur et aucun agrandissement ;
- comparaison décodée des 38 dérivés standard avec leur source sous un écart
  moyen absolu de 8 niveaux par canal ;
- chaîne AVIF → WebP → JPEG, dimensions et `sizes` testés dans le DOM ;
- URL `blob:` et médias Storage exclus du catalogue de dérivés locaux ;
- absence d'`@import` Google Fonts et présence des trois liens du `<head>` ;
- tests historiques du carrousel, du 360°, de la Galerie et du cycle de vie des
  médias privés conservés.

## Validation locale

- `npm run test:pf4` : 42 tests UI et 20 tests ciblés/UX réussis ;
- TypeScript et lint réussis ;
- build Vite isolé réussi, sans écrire dans `dist/` ;
- budgets PF0 respectés ;
- audit Lighthouse final 390 × 844 à DPR 3 : score 76, FCP 1,8 s, LCP 6,4 s,
  TBT 40 ms, CLS 0,00011, 34 requêtes et 640 097 octets transférés ;
- navigateur 1 280 × 720 à DPR 2 : AVIF réellement sélectionné pour la
  couverture, le carrousel et l'aperçu 360°, aucun débordement horizontal ;
- zéro vidéo au repos, une vidéo après sélection, poster WebP 768 px et aucune
  vidéo dans les miniatures ;
- lecteur 360° rendu avec le dérivé, commandes et proportions inchangées.

La simulation Lighthouse est une mesure de laboratoire : ses temps FCP/LCP
varient fortement avec la simulation et ne sont pas assimilés à des Web Vitals
de terrain. L'impression reste couverte par les dimensions intrinsèques, le
fallback JPEG et les règles `@media print` existantes ; le dialogue système
d'impression n'est pas pilotable par la surface de recette intégrée.

## Périmètre

- aucun original supprimé, remplacé ou envoyé vers Firebase Storage ;
- aucune donnée, clé persistée, route, décision W/R/C ou schéma métier modifié ;
- aucune règle Firebase ou autorisation modifiée ;
- aucune écriture Firebase de production et aucun déploiement Hosting.
