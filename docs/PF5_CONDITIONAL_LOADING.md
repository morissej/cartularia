# PF5 — Chargement conditionnel mesuré

Date de validation locale : 18 août 2026.

## Diagnostic

La trace mobile PF4 montrait un coût initial Firebase sans usage distant sur le
Cartulaire IWC local : deux fragments représentaient 188 135 octets transférés.
L'audit estimait en parallèle 131 446 octets inutilisés dans le fragment
Firebase principal. Le chemin critique consacrait 403,9 ms à l'évaluation des
scripts.

Les autres candidats de la vague n'étaient pas justifiés par la trace :

- 323 nœuds DOM seulement, profondeur maximale 13 : pas de `content-visibility` ;
- aucun coût isolé attribuable à `body:has(...)` : sélecteur conservé ;
- aucune longue tâche de hachage : pas de Worker SHA-256 ;
- aucune modification des règles, schémas ou infrastructures Firebase.

## Correction

- Le Cartulaire IWC indique explicitement à `useHybridPersistence` qu'il reste
  local.
- Firebase Auth et l'initialisation Firebase sont importés uniquement quand la
  synchronisation distante est activée.
- Les opérations `cloudDraft` sont importées uniquement lors d'une
  synchronisation, d'une résolution de conflit ou d'une suppression distante.
- Le service de média privé n'est importé que lorsqu'une image sans URL directe
  doit réellement résoudre un binaire privé.
- Le service de projection publique n'est importé que lorsqu'un `publicCode`
  est demandé sur `watch-website`.
- Le chemin local conserve son `flush()` IndexedDB, son statut `signed-out` et
  ses contrats de persistance existants.

Les fragments Firebase restent présents dans le build afin de servir les
parcours distants ; ils ont seulement quitté le réseau initial IWC.

## Résultat Lighthouse mobile

Mesure locale identique à PF4 : 390 × 844, DPR 3, simulation mobile.

| Indicateur | PF4 | PF5 | Écart |
| --- | ---: | ---: | ---: |
| Score performance | 76 | 86 | +10 points |
| FCP | 1,8 s | 1,8 s | stable |
| LCP | 6,4 s | 4,0 s | -2,4 s (-37,9 %) |
| TBT | 40 ms | 0 ms | -40 ms |
| CLS | 0,00011 | 0,00011 | stable |
| Requêtes | 34 | 24 | -10 (-29,4 %) |
| Transfert total | 640 097 o | 403 698 o | -236 399 o (-36,9 %) |
| Requêtes script | 19 | 13 | -6 |
| Transfert script | 394 494 o | 158 096 o | -236 398 o (-59,9 %) |
| Fragments/appels Firebase initiaux | 2 | 0 | supprimés du chemin IWC |

La feuille de polices Google reste la principale dépendance tierce. Son
auto-hébergement n'a pas été ajouté sans jeu WOFF2 licencié, versionné et
limité aux sous-ensembles réellement nécessaires.

## Verrous de non-régression

- mode local : aucun observateur Auth et aucune opération cloud ;
- mode distant : observateur Auth, synchronisation et désabonnement conservés ;
- imports initiaux interdits par test statique pour Auth, Firebase,
  `cloudDraft`, projection publique et média privé ;
- parcours `watch-website?publicCode=...` vérifié : le service différé est
  appelé et l'état d'indisponibilité reste rendu proprement ;
- budgets PF0 respectés : entrée 199 805 o, App 302 972 o, Registre 36 321 o,
  plus gros fragment 488 180 o ;
- build isolé : 1 432 317 o de JavaScript, dont 425 229 o gzip. Cette taille
  totale inclut toujours les fonctionnalités distantes et n'est pas la charge
  initiale IWC.

## Validation locale

- `npm run test:pf5` : 44 tests UI, 20 tests PF4/UX et 3 verrous PF5 réussis ;
- tests coffre, synchronisation et conservation : 21/21 réussis ;
- TypeScript, lint, validation IA et contrôle de schéma réussis ;
- build Vite isolé réussi, sans écrire dans `dist/` ;
- Cartulaire IWC mobile rendu dans le navigateur avec image et contrôles ;
- aucun fragment `firebase-*`, `index.esm-*`, appel Firestore ou Identity
  Toolkit dans la trace réseau initiale IWC.

La mesure Lighthouse reste une mesure de laboratoire et non un Web Vital de
terrain. Un seul audit final comparable a été conservé : les temps du moteur
simulé ne doivent pas être présentés comme une garantie de production.

## Périmètre

- aucune donnée, clé persistée, route, décision W/R/C ou schéma métier modifié ;
- aucune règle Firebase, autorisation ou infrastructure modifiée ;
- aucune écriture Firebase de production et aucun déploiement Hosting ;
- aucune modification spéculative sans coût mesuré.
