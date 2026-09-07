# E02 — réparation ciblée des données de démonstration

Date : 6 septembre 2026. Périmètre initial : code et tests locaux, puis lectures distantes ciblées. Le responsable d’intégration a ensuite appliqué la réparation data-only décrite en fin de rapport : 53 écritures Firestore sur les cinq dossiers fictifs, sans mutation Auth, IAM, Rules, Storage ou Hosting. Aucun seed complet.

## Résultat

`scripts/seed-demo-account.mjs --data-only` utilise désormais une voie distincte de `seed` : **simulation par défaut**, Auth exclusivement lu. L'application exige en plus `--apply` et `--backup-dir=/chemin/absolu/existant`. Le mode historique sans `--data-only` conserve ses mutations Auth et ne doit pas être utilisé pour E02.

Implémentation : `scripts/lib/demo-data-repair.mjs`. Tests : `tests/demo-data-repair.test.mjs`.

Le plan répare seulement les différences reconnues entre l'ancien jeu fictif et les builders actuels :

- `assets` des cinq Cartulaires : création des médias fictifs manquants et complément des champs manquants d'un média déjà identifié strictement ; seules les URLs exactes produites par `buildDemoAssetDocuments` sont acceptées.
- Enveloppes : code objet, médias principaux, montants courants et devise. Les valeurs personnalisées/inconnues sont refusées ; seul l'ancien coût égal au prix d'achat est reconnu comme variante historique.
- Projections du Registre : codes, montants, média principal et autres champs fictifs attendus ; nouvelle révision, empreinte et date `updatedAt`.
- Collection : harmonisation des deux noms historiques reconnus, `Demo Montres` / `Les cinq icônes`, vers le nom actuel. Aucun changement de publication, visibilité, sélection ou consentement.
- Pour chaque Cartulaire réellement modifié : ajout d'un événement `cartulary.demo.data_repaired` et progression de la chaîne vers la révision 2. L'événement initial reste intact. Une seconde simulation sur l'état réparé donne zéro écriture ; une divergence après cette réparation exige une nouvelle migration explicite.

Aucun remplacement des utilisateurs, organisations, adhésions, droits, sections, sources, propriétaires ou historiques de valorisation. Aucun appel Storage, aucune ouverture d'original privé, aucun upload et aucune publication.

## Garde-fous

1. Options inconnues refusées avant initialisation : une faute dans `--data-only` ne peut pas retomber dans le seed Auth. Projet explicite requis hors émulateurs ; projets d'environnement contradictoires et configuration avec un seul des deux émulateurs refusés.
2. Compte Auth préexistant, actif, vérifié, email attendu, sans claims privilégiés. L'interface transmise au module n'expose que `getUserByEmail`. Compte absent ou désactivé : arrêt, jamais création/réactivation/changement de mot de passe.
3. Documents utilisateur, adhésion et Registre marqués `public_read_only_demo` ; membre unique, rôle guest et permissions exactement en lecture seule ; un seul Registre, une seule Collection, exactement les cinq Cartulaires et leurs cinq projections.
4. Contrat watch@1.6.0 : artefact/manifeste local vérifié ; version distante publiée et bonne empreinte ; recalcul de l'empreinte du contrat distant à partir de tous ses champs, sans se fier au seul marqueur `catalogDigest`.
5. Racines : `demo: true`, bon titulaire, bons identifiants, schéma exact, visibilité secrète, non-publication et valeurs d'origine reconnues. Champ supplémentaire inattendu ou valeur réelle/personnalisée : arrêt.
6. Intégrité : vérification des événements existants, dates, identifiants, actions, acteurs, séquences et hashes ; seule la chaîne seed initial, éventuellement suivie de cette réparation, est acceptée. Aucun écrasement de l'historique.
7. Médias : identifiants exacts, organisation/cartulaire/source fictive attendus, visibilité secrète ; URL tierce, chemin Storage, `binaryId`, champ inattendu ou média inconnu : arrêt. Aucun original réel ne peut être remplacé.
8. Lecture bornée : chaque collection/query est limitée au nombre attendu + 1, afin de détecter les ajouts hors périmètre sans lire une collection arbitrairement grande.
9. Sauvegarde préalable obligatoire, puis seconde vérification Auth et transaction unique. La transaction relit tous les documents de garde et toutes les queries ; toute modification de contenu/date de version ou tout nouveau document depuis la sauvegarde annule le lot entier.

## Commandes contrôlées

Depuis la racine du prototype, avec Node >= 22.18, une session Firebase CLI Admin autorisée et aucun émulateur résiduel dans l'environnement :

```sh
GCLOUD_PROJECT=studio-2614005370-a3e51 node scripts/run-with-firebase-cli-adc.mjs -- node scripts/seed-demo-account.mjs --data-only --allow-remote
```

Cette commande ne sauvegarde rien et n'appelle aucune transaction d'écriture. Elle indique projet, UID, empreinte du schéma et liste exacte des opérations prévues. **Tout refus doit être investigué en lecture seule ; ne pas assouplir automatiquement les gardes pour faire passer le lot.**

L'application ultérieure, après examen d'une simulation réussie, réexécute l'ensemble des contrôles. Elle nécessite un répertoire de sauvegarde existant, hors du dépôt et hors de Hosting :

```sh
GCLOUD_PROJECT=studio-2614005370-a3e51 node scripts/run-with-firebase-cli-adc.mjs -- node scripts/seed-demo-account.mjs --data-only --allow-remote --apply --backup-dir=/chemin/absolu/existant
```

Ne pas supprimer `--data-only`. Ne pas employer le seed complet comme solution de repli.

## Sauvegarde ciblée et retour arrière

Avant toute écriture, le script crée un sous-répertoire unique `demo-data-repair-v1-*` (permissions 0700) et un `backup.json` (0600, création exclusive, synchronisé sur disque et relu). L'enveloppe est protégée par une empreinte SHA-256 du JSON canonique.

Le fichier contient :

- Projet, version de réparation, empreinte de l'état contrôlé et plan exact.
- Chaque cible avant changement, son existence/absence, son contenu intégral et sa version Firestore. L'absence est enregistrée explicitement pour distinguer création et mise à jour.
- Les documents/queries de garde dans le seul périmètre démo et le contrat watch@1.6.0. Aucun enregistrement Auth, aucun mot de passe, aucun credential ADC et aucun binaire.
- Un encodage typé relisible préservant notamment secondes et nanosecondes des timestamps ; `decodeBackupValue` restaure les types. Un type inattendu interrompt la sauvegarde avant toute écriture distante.

Procédure de restauration **à préparer et revoir séparément, non automatisée par ce lot** :

1. Conserver le fichier hors du dépôt, vérifier son `digest` avec `sha256Digest` après retrait de ce champ et confirmer le projet/UID/périmètre.
2. Faire une nouvelle lecture et sauvegarde ciblée de l'état courant. Comparer toutes les cibles au plan appliqué, vérifier notamment les cinq chaînes, les têtes/révisions et l'absence d'activité ultérieure. Toute divergence interdit une restauration automatique.
3. Préparer une transaction à préconditions de versions courantes : rétablir exclusivement les documents préexistants figurant dans `before`, supprimer exclusivement les documents indiqués auparavant absents et créés par ce plan. Cela remet ensemble enveloppes, projections et événements ; ne jamais revenir sur une tête d'intégrité sans son événement correspondant.
4. Ne jamais supprimer un sous-arbre, une collection ou un utilisateur ; ne toucher ni Auth ni Storage. Prévisualiser la liste exacte avant exécution d'une restauration séparément autorisée.
5. Vérifier ensuite Galerie, codes, valeurs et chaînes. En cas de résultat de commit ambigu, commencer par la simulation en lecture seule : l'idempotence permet de distinguer l'état déjà réparé d'un état non appliqué, sans relancer le seed complet.

La sauvegarde n'est ni un export global de projet ni une sauvegarde de credentials. Auth et Firestore ne partagent pas de transaction distribuée : le compte est recontrôlé juste avant la transaction, mais un changement Auth simultané ultérieur reste possible ; ce script ne le réactive jamais.

## Validation et suffisance

Commande locale :

```sh
node --test tests/demo-data-repair.test.mjs tests/demo-account.test.mjs
```

Résultat : **18/18 tests passés** (10 nouveaux et 8 existants). Couverts : simulation sans transaction, Auth absent/désactivé, données réelles ou personnalisées, dérive du schéma/droits/intégrité, médias privés/tiers, idempotence, champs fictifs manquants, sauvegarde impossible, désactivation pendant préparation, modification concurrente et ajout concurrent, restauration exacte des valeurs typées. Lint ciblé et `git diff --check` passent.

Les **35 chemins média uniques** issus des builders existent sous `public/` localement. Les données seules suffisent, sous réserve de réussite des gardes, pour fournir les assets `presentationDerivative` lus par `src/services/registryGallery.ts` et aligner les codes/coûts/net affichés par les projections du Registre. Le jeu local sans assets produit un maximum attendu de 54 opérations pour cette version (38 assets + 5 × enveloppe/projection/événement + Collection) ; le nombre réel dépend des champs déjà présents.

**Limites du lot initial :** les tests unitaires seuls ne prouvaient pas une transaction Firestore réelle. L’application et le contrôle réel ont ensuite été exécutés par l’intégration (voir fin du rapport). Le module n'apporte pas un nouveau déploiement Hosting, ne répare pas un schéma/compte invalide et ne remplace pas les historiques. Les dates historiques de création, valorisation, provenance et `generatedAt` initial sont conservées ; `updatedAt`, révision et événement datent la réparation.

## Contrôle distant en lecture seule — complément du 6 septembre

Le premier contrôle distant réalisé par root a identifié `objectCode: null` dans les cinq anciennes projections, alors que ce champ est absent des cinq racines. Sur autorisation ciblée, le garde de **projection uniquement** accepte désormais ce `null` historique. Le test d'idempotence utilise explicitement cet état. Aucun autre garde n'a été assoupli ; les 18 tests restent verts.

Une simulation distante a ensuite été exécutée via le wrapper ADC, avec `--data-only --allow-remote` et **sans `--apply`**. Résultat : **refus fermé sur `netValuation`**. Une lecture restreinte à six champs des dix documents fictifs a confirmé :

- `netValuation` et `netAfterTaxValuation` valent `null` dans les cinq projections ; ils sont absents des cinq racines.
- `costBasis` des projections vaut encore le prix d'achat historique : 8 850 / 33 800 / 5 150 / 11 200 / 20 500 EUR.
- `grossValuation` correspond aux montants fictifs actuels : 10 300 / 41 500 / 4 700 / 9 700 / 16 500 EUR.
- `primaryAssetId` vaut `null` dans les cinq racines et projections.

À ce stade du premier passage, les gardes sur les deux valeurs nettes sont restés inchangés ; le résultat a été transmis à root pour revue explicite, sans application.

Contrôle HTTP `HEAD` des 35 URLs connues sur `https://studio-2614005370-a3e51.web.app` : **35 réponses 200, zéro type incohérent**. Aucun contenu média téléchargé :

- 29 images : `image/jpeg` (main/rear/full-set des cinq montres, plus `spin-00.jpg` à `spin-13.jpg` de la Rolex).
- 5 vidéos `motion.webm` : `video/webm`.
- `NOTICE_DEMO.txt` : `text/plain; charset=utf-8`.

Ce contrôle démontre disponibilité et type HTTP, pas égalité binaire avec les fichiers locaux ni qualité du rendu navigateur.

## Simulation distante réussie après revue ciblée des valeurs null

Après accord explicite de root, les seuls `netValuation: null` et `netAfterTaxValuation: null` historiques des **projections** sont reconnus en plus des montants calculés attendus. Leurs gardes côté racines restent inchangés. Un test supplémentaire vérifie, pour les cinq Cartulaires et les deux champs, le refus de 0, -1, 123456, d'une chaîne numérique et du `null` côté racine. La fixture d'idempotence utilise les trois `null` effectivement constatés dans les projections.

Résultats : **19/19 tests passés**, lint ciblé et diff-check propres. Nouvelle simulation distante via wrapper ADC : **exit 0**, `mode: dry-run`, `applied: false`, Auth `read-only / unchanged`. Contrat distant confirmé : `sha256:fad0533eb290df894291df7dc080ce255249d9b79b9758b4214adcbda5714fa9`.

### Plan exact retourné : 53 opérations, aucune exécutée

Chaque identifiant ci-dessous désigne une racine `cartularies/{id}` mise à jour et sa projection `registries/reg_cartularia_demo/items/{id}` mise à jour. Chaque asset est créé à `cartularies/{id}/assets/{id}-{suffixe}`. Chaque événement est créé sous `cartularies/{id}/auditEvents/{événement}`.

| Cartulaire (`id`) | Assets créés (suffixes) | Événement créé | Total |
| --- | --- | --- | ---: |
| `cart_demo_rolex_submariner_124060` | `spin-00` à `spin-13`, `rear`, `full-set`, `motion`, `reference-report` | `evt_demo_data_repair_v1_f449b06a884199b18461` | 21 |
| `cart_demo_ap_royal_oak_15510st` | `main`, `rear`, `full-set`, `motion`, `reference-report` | `evt_demo_data_repair_v1_1b95e37cafd2a31259ce` | 8 |
| `cart_demo_tudor_black_bay_chrono_79360n` | `main`, `rear`, `full-set`, `motion`, `reference-report` | `evt_demo_data_repair_v1_d772fbac0623e0097eb9` | 8 |
| `cart_demo_jlc_reverso_tribute_q397848j` | `main`, `rear`, `full-set`, `motion`, `reference-report` | `evt_demo_data_repair_v1_67014c767032868a243a` | 8 |
| `cart_demo_breguet_classique_5157bb` | `main`, `rear`, `full-set`, `motion`, `reference-report` | `evt_demo_data_repair_v1_03a364811daad1347ac3` | 8 |

Décomposition : **38 assets + 5 racines + 5 projections + 5 événements = 53**. Aucune opération sur Collection : ses noms sont déjà conformes. Aucun utilisateur, rôle, publication, original, section, propriétaire ou événement antérieur ne figure parmi les cibles.

Montants fictifs attendus après application, en EUR ; le net après impôt est égal au net (impôt fictif nul) :

| Code objet | Prix d'achat | Coût de revient | Valeur brute | Frais de vente | Valeur nette |
| --- | ---: | ---: | ---: | ---: | ---: |
| `DEMO-ROL-124060` | 8 850 | 9 480 | 10 300 | 1 030 | 9 270 |
| `DEMO-AP-15510ST` | 33 800 | 35 220 | 41 500 | 4 150 | 37 350 |
| `DEMO-TUD-79360N` | 5 150 | 5 605 | 4 700 | 470 | 4 230 |
| `DEMO-JLC-Q397848J` | 11 200 | 11 770 | 9 700 | 970 | 8 730 |
| `DEMO-BRG-5157BB` | 20 500 | 22 140 | 16 500 | 1 650 | 14 850 |

Module gelé après simulation : `scripts/lib/demo-data-repair.mjs`, SHA-256 `276aadb3dbbe231b6963ffebe795c08ff439962a6bd4f9529c1e42b1f2eeb1e4`. Wrapper seed inchangé : SHA-256 `132df5c6e7fc36aff453b8526bbce7c75bef69f88b51a75a0e1698485b375af6`.

## Application par l’intégration et vérification réelle

Après revue du plan et nouveau passage des 19 tests, application du même module gelé avec `--data-only --allow-remote --apply`. Résultat : exit 0, `applied: true`, exactement les 53 opérations prévues. Auth est resté en lecture seule. Aucun objet réel, compte, droit, publication, fichier binaire ou service déployé n’a été modifié.

Sauvegarde persistante, hors du dépôt applicatif :

`/Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/cartularia-demo-repair-20260906.cjOTOW/demo-data-repair-v1-yyqqcK/backup.json`

Empreinte : `sha256:869d0d1b6b91de99579ad02eea373225b3a4067337d0a6402b5fecb9a01cf315`.

Seconde simulation distante après commit : exit 0, `writes: []`, `applied: false`. Elle a revérifié les cinq chaînes et les gardes ; aucune réparation supplémentaire n’est proposée.

Chrome sur le domaine public : connexion par le bouton démo existant réussie ; les cinq codes objets et révisions 2 sont visibles dans le Catalogue ; les cinq images principales de la Galerie sont effectivement décodées (`complete` et `naturalWidth > 0`). Le vieux client Hosting affiche encore le libellé « Demo Montres » et d’anciens liens de mini-site : ces écarts de code ne sont pas corrigés par une migration des données et restent dépendants de la livraison E01.

La page Preuves publique authentifiée confirme ensuite **5 chaînes vérifiées sur 5, 10 événements**, empreintes/ordre/têtes cohérents et aucun ancrage public revendiqué.

L'application, sa sauvegarde effective et les vérifications navigateur sont laissées à root. **Aucun `--apply` ni aucune mutation distante exécutés par cet agent.**
