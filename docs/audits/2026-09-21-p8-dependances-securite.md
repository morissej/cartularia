# P8 — Dépendances de sécurité et chaînes de traitement

Date : 2026-09-21

Périmètre : F12 de `2026-09-18-assessment-code.md`

État : correction locale validée, non déployée

## Résultat

Les avis critiques et élevés ont été supprimés des dépendances de production sans `npm audit fix --force`. Sharp et PDF.js sont maintenant sur leurs premières versions corrigées compatibles. La chaîne OpenTimestamps demeure ancienne et signalée, faute de version amont corrigée, mais ses destinations réseau et la taille des preuves entrantes sont désormais bornées.

| Ensemble audité | Total avant | Total après | Critiques avant → après | Élevés avant → après | Modérés avant → après | Faibles avant → après |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Complet, outils inclus | 47 | 44 | 2 → 0 | 10 → 8 | 34 → 35 | 1 → 1 |
| Production (`--omit=dev`) | 24 | 21 | 2 → 0 | 2 → 0 | 19 → 20 | 1 → 1 |

Ces nombres comptent la propagation des avis dans le graphe npm, pas autant de vulnérabilités indépendantes. L'augmentation d'une unité des avis modérés reflète leur classification et leur propagation après résolution ; le total signalé baisse et aucun avis critique ou élevé ne reste dans le graphe de production.

## Versions résolues

| Composant | Avant | Après | Justification |
| --- | --- | --- | --- |
| `sharp` | `0.35.3` | `0.35.4` exact | Version corrigée de l'avis libheif ; traitement d'images non fiables réellement utilisé |
| `pdfjs-dist` | `5.6.205` | `6.2.108` exact | Première version corrigée de l'avis de scripting PDF.js |
| `@napi-rs/canvas` | `0.1.100` | `1.0.9` exact | Alignement avec PDF.js 6 et ses types natifs de chemins |
| `opentimestamps` | `0.4.9` | `0.4.9` | Aucune version amont plus récente disponible |
| `request > form-data` | `2.3.3` | `2.5.6` par override ciblé | Retire les avis critiques `form-data` sans changer aveuglément le graphe |

`request@2.88.2` reste transitive sous OpenTimestamps. L'override est limité à son `form-data` de même majeure ; il ne prétend pas corriger l'avis SSRF propre à `request`.

## Sharp, libheif et formats

- La cible Firebase déclarée est Node.js 22. Le verrou npm résout `@img/sharp-libvips-linux-x64@1.3.3` et son équivalent Linux ARM64.
- L'archive npm Linux x64 réellement référencée a été inspectée localement : son manifeste natif déclare `libheif 1.23.2` et `libvips 8.18.6`.
- L'installation locale Darwin ARM64 expose également `sharp 0.35.4`, `libheif 1.23.2` et `libvips 8.18.6`.
- Les décodeurs Sharp disponibles déclarent JPEG, PNG, WebP, TIFF, GIF, SVG et HEIF. La politique d'upload Cartularia accepte JPEG, PNG, WebP et HEIC/HEIF.
- Un conteneur AVIF/HEIF réel est décodé puis soumis à la génération des variantes dans la suite P8.

Cette inspection établit le contenu du paquet natif verrouillé, pas la version actuellement déployée sur Firebase. Aucun binaire de production n'a été interrogé. Aucun échantillon HEIC d'appareil photo n'était disponible ; le test réel couvre un conteneur HEIF/AVIF et les déclarations de capacité du codec.

## PDF.js et refus des documents actifs

- Le worker de rendu garde `isEvalSupported: false`, `enableXfa: false` et `annotationMode: DISABLE`.
- `enableScripting: false` est maintenant explicite lors de l'ouverture du document.
- Le passage à PDF.js 6.2.108 a imposé l'alignement de `@napi-rs/canvas` en 1.0.9 ; sans cet alignement, un rendu réel échouait sur des types natifs incompatibles.
- Les tests rendent un PDF et vérifient que scripts, évaluation, XFA et annotations actives restent désactivés.

## OpenTimestamps et transitives

La bibliothèque officielle JavaScript OpenTimestamps ne publie toujours que `0.4.9` et dépend de la chaîne abandonnée `request` / `request-promise`. La migration vers une autre implémentation n'a pas été improvisée dans P8, car elle changerait le format et la confiance de la preuve d'ancrage.

Les protections suivantes ont été ajoutées autour de l'adaptateur existant :

- calendriers HTTPS limités à une liste fixe approuvée ;
- quorum validé par rapport à cette liste ;
- Esplora fixé à `https://blockstream.info/api` ;
- URL arbitraires et destinations locales refusées ;
- preuve entrante strictement décodée en base64 et limitée à 64 Kio ;
- mêmes destinations imposées aux opérations `stamp`, `upgrade` et `verify`, sans réutiliser aveuglément une URI contenue dans une preuve entrante.

La création et la vérification d'une preuve restent couvertes par les tests d'ancrage avec doubles déterministes. Aucun appel aux calendriers Bitcoin réels et aucun exploit distant n'ont été exécutés.

## Alertes restantes et portée

- **Production, 21 avis faibles ou modérés :** la principale chaîne atteignable est OpenTimestamps → `request-promise` → `request`. Son avis SSRF reste signalé. Les destinations réseau sont maintenant imposées par Cartularia, ce qui réduit le chemin exploitable observé sans déclarer l'avis corrigé.
- **Production, transitives Firebase/Google Cloud :** les avis restants proviennent aussi de dépendances d'administration, de fonctions et de transport. L'audit npm ne propose pas de correction directe compatible pour plusieurs de ces branches ; aucun exploit Cartularia n'a été démontré.
- **Développement, 8 avis élevés :** ils proviennent de la chaîne `firebase-tools` et de ses outils de schéma/MCP (`@modelcontextprotocol/sdk`, Exegesis, Ajv, `fast-uri`, `js-yaml`, `json-schema-ref-parser`). `firebase-tools@15.27.0` est la version directe résolue et npm ne propose pas de correction directe. Ces paquets ne sont pas dans l'audit `--omit=dev` ni dans le bundle de production.

Ces restrictions de portée ne remplacent pas une correction amont. Les avis restants doivent continuer à être surveillés lors des mises à jour de Firebase et d'OpenTimestamps.

## Limites mémoire et traitements testés

- La génération des variantes conserve une limite de pixels d'entrée.
- Le worker PDF reste lancé avec `--max-old-space-size=512`.
- La fonction de traitement est configurée à 1 Gio et concurrence 1.
- Une image SVG déclarant des dimensions massives est refusée avant un décodage susceptible d'allouer une image démesurée.
- Les parcours image, rendu PDF, upload privé et ancrage public sont couverts ensemble par le script P8.

## Vérifications exécutées

- `npm run test:p8-dependency-security` : 48 tests réussis.
- `npm run test:public-anchor` sur émulateur Firestore local : 3 tests réussis.
- `npm run test:private-binary-trust:unit` : 131 tests réussis.
- `npm run test:ui` : 110 fichiers, 712 tests réussis.
- `npm run lint` : réussi.
- `npm run build` : réussi ; avertissement Vite existant sur un chunk supérieur à 500 kB.
- `git diff --check` : réussi.

Le premier lancement ciblé incluait des tests nécessitant des émulateurs absents : douze échecs étaient environnementaux. Il a aussi révélé l'incompatibilité réelle entre PDF.js 6 et l'ancienne racine Canvas, corrigée par l'alignement en 1.0.9. Le premier lancement d'ancrage sur émulateur a ensuite montré qu'une fixture ne créait pas les profils utilisateur désormais exigés par les règles ; seuls les profils fictifs de la fixture ont été ajoutés, sans affaiblir les règles. Le relancement final passe.

## Limites et état externe

- Aucun déploiement, push, commit, modification de données distantes, appel de calendrier Bitcoin réel ou test d'exploit en production n'a été effectué.
- Les versions déclarées et verrouillées ont été inspectées localement. La version native réellement chargée par une fonction déjà déployée n'a pas été vérifiée.
- Les tests de limites mémoire vérifient les contrats de configuration et des refus déterministes ; ils ne constituent pas un test de charge sur l'infrastructure Firebase.
- L'audit npm est un instantané du 2026-09-21 et peut évoluer avec les avis publiés ultérieurement.

## Fichiers du lot P8

- `package.json`
- `package-lock.json`
- `scripts/lib/pdf-presentation-worker.mjs`
- `scripts/lib/trust-adapters.mjs`
- `tests/dependency-security-p8.test.mjs`
- `tests/public-anchor.test.mjs`
- `docs/audits/2026-09-21-p8-dependances-securite.md`
