# Cartularia — Journal d’exécution de la vague V1

Date : 8 septembre 2026. Plan de référence : [plan d’action par vagues](2026-09-08-plan-actions-par-vagues.md), vague V1 « Déploiement des correctifs déjà réalisés ». Autorisation : « ok, lance V1 » (déploiement Hosting) ; les écritures distantes de données font l’objet d’un accord distinct (§4).

## 1. Build et déploiement

- Bundle construit depuis la branche `feat/lecteur-unique-adr-028-031` (`a35233b`) avec `VITE_USE_FIREBASE_EMULATORS=false` ; `.env.production` fournit la clé App Check et force elle aussi le drapeau à `false`. Vérifications avant déploiement : clé reCAPTCHA présente dans `firebase-*.js` et dans l’application du Coffre ; aucun drapeau émulateurs à `true` ; morceau `ServiceInformationPage` présent ; chaînes `confidentialite`, `accessibilite`, `cartulary-view` présentes.
- Déploiement **Hosting uniquement** (`firebase deploy --only hosting`) : 444 fichiers, 90 nouveaux, version publiée. Ni fonctions, ni règles, ni index : la fonction de création en production reste sur l’ancienne table de sections, compatible avec le client déployé (les versions de schéma résolues par le client sont acceptées ; la section d’acquisition automobile corrigée ne concerne que les créations passées par la nouvelle fonction).
- Second déploiement dans la foulée (`9d60495`, bundle `index-C454sD18.js`) pour la correction décrite au §3.

## 2. Vérification côté visiteur (navigateur intégré, sans compte)

| Point | Résultat |
|---|---|
| `/confidentialite`, `/conditions`, `/service`, `/accessibilite` (V-A1) | Rendues avec leur contenu : « Confidentialité et données » (265 mots), « Conditions d’utilisation du pilote » (258), « Disponibilité et limites » (249), « Accessibilité » (136). **V-A1 close.** |
| `/cartulary-view?cartularyId=cart_demo_…` (ADR-028) | Rend le lecteur unique, contrat `cartulary-presentation@1.4.0`, six pages, panneau Preuves. |
| Console | Aucune erreur ni avertissement sur ces pages. |
| Retour d’un Cartulaire démo (V-A4) | Toujours `/registry` sans `returnTo` : reste pour V2. |

## 3. Régression trouvée et corrigée pendant la vérification

La session Chrome du propriétaire s’était verrouillée entre-temps (règle de sécurité : 15 min d’onglet masqué ou 30 min d’inactivité, `src/security/sessionSecurity.ts`), ce qui a exposé un cas non couvert par l’ADR-029 : **hors connexion, un Cartulaire sans profil de création dans son brouillon privé (le pilote IWC) affichait « Montre · Dossier à compléter »**, faute d’enveloppe autoritaire et de mock codé. Correction `9d60495` : l’identité (marque, modèle, référence, année, calibre) se relit dans la fiche de spécifications enregistrée (`creationProfileFromSpecificationGroups`, domaine, testée) ; aucune donnée confidentielle n’est déduite ; connecté, l’enveloppe garde la priorité. Vérifié en production hors connexion : en-tête « IWC Schaffhausen Flieger UTC (Die Fliegeruhr) », titre d’origine « Histoire de la référence IW3251-001 · 3251-001 ». Le code public reste `WCH-UTC_2002` hors connexion tant que la clé `cartularia-public-code` n’est pas dans le brouillon IWC (§4).

Constat d’usage à consigner pour V5 : le verrou de session coupe la session après 15 minutes d’onglet masqué, sans message au retour autre que l’écran de connexion.

## 4. Écritures distantes de données

**Constat de départ.** Tel quel, `scripts/import-rolex-cartulary.mjs` s’arrêtait en production sur `cartulary_exists` sans rien écrire (racine créée depuis le Registre, révision 13, aucun reçu d’import) ; une « correction » naïve aurait créé un brouillon fantôme sous l’acteur de fixture ou réécrit les clés saisies par le propriétaire. `scripts/update-iwc-dossier.mjs` exige le dossier source des médias et Storage, réécrit vingt clés et lance la synchronisation en processus : inadapté pour compléter quatre clés.

**Travail réalisé** (trois tours d’orchestration, 27 agents, chaque tour relu par un relecteur « sûreté en production » et un relecteur « preuve par mutations » ; plus aucun point bloquant au troisième tour) :

- `scripts/lib/rolex-dossier-command.mjs` et CLI mince `scripts/import-rolex-cartulary.mjs` : plan en lecture seule puis application ; mode `create` (seed local) ou `existing` (production : propriétaire tiré de `accountHolderId`, ni import ni projection) ; règle de non-écrasement (`kept`, `--force --key <clé>` seulement) ; clés qui pilotent la projection Registre protégées (`kept_projection`, `--projection-keys [--key]`) ; bloc `projection` comparant la racine actuelle et la racine après synchronisation ; gardes `sync_required`/`--resync`, `request_in_flight`/`--replace-stale-request`, `generic_operation_stale`, `first_authoritative_sync`, `project_required`, `create_not_allowed_remote`/`--allow-create` ; demande de synchronisation marquée `failed` au délai ; rapport classé Secret sans valeur d’état (empreintes salées, tailles, champs différents). 52 tests en mémoire, CLI compris.
- `scripts/lib/iwc-profile-keys-command.mjs`, CLI `scripts/update-iwc-profile-keys.mjs` (`npm run update:iwc-profile-keys`) et `scripts/lib/iwc-dossier-values.mjs` partagé avec `update:iwc-dossier` : trois clés créées si absentes, `originTitle` fusionné, jamais d’écrasement (`skip_existing` → `--apply` refusé sans écriture, `--allow-partial` explicite) ; garde de cible `not_iwc_cartulary` ; propriétaire et cible relus dans la transaction ; `--request-sync` opt-in ; avertissements `creation_profile_drives_valuation`, `owner_membership_missing`, `owner_local_copy_conflict`. 19 tests en mémoire.
- `tests/helpers/memory-firestore.mjs` : `orderBy` et `limit`, ce qui rend la synchronisation serveur rejouable en mémoire.
- Points levés au fil des relectures : écrasement des montants du propriétaire par les clés de projection de la fixture, absence de garde de cible IWC, câblage CLI non testé (un `--dry-run` qui écrivait aurait passé les tests), synchronisation en échec jamais rejouée, opération générique du lecteur non simulée, demande laissée `pending` au délai, projet distant ciblé par défaut sans variable, aperçus de valeurs Secret dans le terminal. Points mineurs laissés ouverts (journalisés dans les résultats des workflows) : sections génériques sans marqueur non simulées, sur-blocage sur marqueur orphelin, message de `creation_profile_drives_valuation` quand le profil existe déjà, `--cartulary` répété.
- Vérification : `npm run lint`, `git diff --check`, 213 tests node (dix fichiers et `test:reference-dossiers`), puis 71 tests des deux fichiers concernés après les deux derniers correctifs (sémantique de `--force --key … --projection-keys`, identifiants via `run-with-firebase-cli-adc.mjs` dans l’aide IWC) ; chaîne de seed émulateur `npm run test:import` rejouée deux fois au vert (`import:rolex` : création 14 clés, puis second passage 14 `unchanged`, synchronisation sautée).

**Simulation en lecture seule contre la production** (8 septembre, 17 h 30, `run-with-firebase-cli-adc.mjs`, aucune écriture ; rapports conservés hors dépôt) :

| | Rolex (`import:rolex --dry-run`) | IWC (`update:iwc-profile-keys --dry-run --allow-remote`) |
|---|---|---|
| Cible | racine présente, révision 13, `watch@1.4.0`, code public identique à la fixture (aucun conflit), chaîne d’audit valide (13 événements) | `cart_iwc_flieger_utc_2002` reconnue par son code public, révision 6, `watch@1.3.0` |
| Propriétaire | déduit de la racine ; membership `legal_owner` active, registre dans ses scopes | idem, même compte |
| Brouillon privé | actif, en phase avec la racine (empreinte égale), aucune opération générique en attente ; **13 clés sur 14 déjà présentes** | actif ; `cartularia-sensitivity-prices` déjà en place |
| Plan | 1 création (`cartularia-public-code`), 5 inchangées, 4 conservées (textes, documentation, profondeur et historique de marché saisis différemment), 4 clés de projection conservées (profil, spécifications, achat, valeur retenue du propriétaire) | 3 écritures : profil de création et code public créés, `originTitle` fusionné (révision 2 → 3) ; aucune clé contestée |
| Effet à la synchronisation | la racine ne porte aujourd’hui **aucun montant** ; la synchronisation déclenchée par l’écriture calculera prix d’achat, prix de revient et valeur nette depuis les clés déjà saisies par le propriétaire (pas depuis la fixture) et les rendra visibles dans le Registre ; devise EUR | même chose (racine sans montant, clés monétaires du brouillon présentes) ; devise EUR posée par le profil ; les actifs seront re-patchés à valeurs identiques (`legacyMediaDigest` absent) ; révision + 1 |
| Code de sortie | 0 | 0 |

Deux enseignements. Le contenu éditorial Rolex est déjà dans le brouillon privé de production : il y a été poussé le 16 août par le lecteur du propriétaire à partir des anciens défauts codés ; le script n’ajouterait que le code public. Les deux racines n’ont jamais reçu de montants : la première synchronisation après ces écritures fera apparaître les valeurs dans le Registre, avec un événement d’audit attribué au propriétaire (seule la `reason` de la demande trace l’opération, d’où `--request-sync` côté IWC).

**Exécution (accord de Jérôme : « Les deux scripts », 8 septembre, 18 h 09).** Commandes lancées depuis le dépôt avec la session Firebase CLI :

```bash
GCLOUD_PROJECT=studio-2614005370-a3e51 node scripts/run-with-firebase-cli-adc.mjs -- node scripts/import-rolex-cartulary.mjs --allow-remote
```

```bash
GCLOUD_PROJECT=studio-2614005370-a3e51 node scripts/run-with-firebase-cli-adc.mjs -- node scripts/update-iwc-profile-keys.mjs --apply --request-sync --allow-remote
```

Résultats :

| | Rolex | IWC |
|---|---|---|
| Écritures | `cartularia-public-code` créée (révision 1) ; 5 inchangées, 4 conservées, 4 clés de projection conservées, aucune course | 3 écritures : profil de création et code public créés, `originTitle` fusionné (révision 2 → 3) ; `cartularia-sensitivity-prices` déjà en place |
| Synchronisation | traitée par le script (`sync_seed_rolex_…`, `reason rolex_dossier_seed_adr029`), racine révision 13 → 14, événement d’audit `evt_87989ff0…` ; racine et item Registre portent désormais les montants du propriétaire (devise EUR) | demande `iwc_profile_keys_20260908_…` (`reason iwc_profile_keys_adr029`) traitée par la Cloud Function déployée en 3 s, `updated`, racine révision 6 → 7 |
| Contrôle par rejeu de la simulation | 6 `unchanged`, 4 `kept`, 4 `kept_projection`, synchronisation sautée (`no_state_change`), brouillon en phase avec la racine, code 0 | `noop` × 3 et `keep_origin_title`, 0 écriture, demande `processed`, code 0 |

**Écart constaté : la fonction `syncCartularyToRegistry` déployée est en retard sur le dossier de travail.** La synchronisation Rolex, traitée en processus par le code du dépôt, a calculé les montants de la racine ; la synchronisation IWC, traitée par la fonction déployée, a incrémenté la révision mais laissé la racine sans montant ni devise et sans `legacyMediaDigest` (les trois avertissements correspondants persistent au contrôle). Les 15 fonctions existantes n’ont pas été redéployées le 8 septembre (décision « les cinq fonctions manquantes seulement ») ; leur mise à jour relève d’une décision séparée, à porter dans une vague ultérieure. Effet visible : le Registre affiche les montants du Rolex mais pas ceux de l’IWC tant que la fonction n’est pas redéployée ou qu’une synchronisation n’est pas traitée par `sync:worker`.

**Remontée de schéma (V1, point 3).** `schema:upgrade --cartulary cart_iwc_flieger_utc_2002 --dry-run --allow-remote` a d’abord échoué en lecture seule sur « Seuls les objets JSON simples sont acceptés par JCS » : les sections lues en production portent des horodatages Firestore (`Timestamp`), que la canonicalisation refusait ; les tests en mémoire ne le voyaient pas (objets simples). Correctif : `plainJson` dans `scripts/lib/schema-upgrade-command.mjs` (horodatages projetés en ISO 8601 pour l’empreinte, sections écrites inchangées), test ajouté. Nouvelle simulation : remontée 1.3.0 → 1.6.0 planifiée, une section retirée (`storage.current`, marquée `imported_unmapped` et `retiredFromSchema`), cinq champs déplacés en extensions (`cover.asset.type`, trois champs `cover.storage.locations[]`, `value.market.analysisDate`). Aucune écriture ; la remontée réelle reste à décider (ADR-031).

Vérification dans Chrome après reconnexion de Jérôme (la session s’était verrouillée entre-temps) : catalogue du Registre avec les cartes IWC (`OP-4892-XZ9`) et Rolex (`ROL-487D9CAD`) ; en-tête du Cartulaire IWC « IWC Schaffhausen Flieger UTC (Die Fliegeruhr) · OP-4892-XZ9 » (le code public ne vient plus du repli codé) ; page La référence : section Origines titrée « Une montre de pilote pensée pour voyager » (`originTitle` fusionné) ; en-tête Rolex « Rolex GMT-Master Mark I Long E · ROL-487D9CAD » ; aucune erreur console. Les cartes du catalogue n’affichent pas de montant par conception ; les montants Rolex sont attestés par le rapport d’exécution (racine et item).

## 5. Vérification côté propriétaire et écart de fonctions

Après reconnexion de Jérôme dans Chrome (session verrouillée entre-temps) :

- Catalogue : les trois cartes ouvrent `/cartulary` (lecteur unique), aucune erreur console.
- Page Publication de l’objet de test : le panneau serveur est présent (« Publier le mini-site »), mais désactivé avec « État de publication indisponible. Connectez-vous avec le compte propriétaire puis réessayez. » Aucun appel réseau vers une fonction : le message vient de l’échec de `getCartularyWebsiteState`.

**Écart constaté.** `firebase functions:list` montre 15 fonctions en production ; le client déployé en appelle cinq qui n’existent pas : `getCartularyWebsiteState`, `publishCartularyWebsite`, `revokeCartularyWebsite`, `saveRegistryCollection`, `deleteRegistryCollection`. Le dossier de travail en définit 31 (11 fonctions de secours Registre et Coffre manquent aussi, sans appel depuis les surfaces vérifiées). Cet écart est antérieur à la journée : le bundle de production du 6 septembre appelait déjà ces fonctions (introduites entre le 21 août et le 7 septembre, commit `fe3aa90`). La publication du mini-site et la gestion des Collections étaient donc déjà inopérantes en production, ce que l’audit propriétaire du matin n’avait pas vu faute de panneau serveur dans l’ancien client.

**Décision de Jérôme :** déployer uniquement les cinq fonctions manquantes (`firebase deploy --only functions:…`), sans toucher aux 15 existantes ni aux 11 fonctions de secours, qui exigent un compte de service dédié (`RECOVERY_RUNTIME_SERVICE_ACCOUNT`, présent dans `.env.studio-2614005370-a3e51`). Résultat : voir §6.

## 6. Déploiement des cinq fonctions et vérification de bout en bout

**Déploiement.** `firebase deploy --only functions:cartularia-sync:getCartularyWebsiteState,functions:cartularia-sync:publishCartularyWebsite,functions:cartularia-sync:revokeCartularyWebsite,functions:cartularia-sync:saveRegistryCollection,functions:cartularia-sync:deleteRegistryCollection --project studio-2614005370-a3e51 --non-interactive` : les cinq fonctions sont créées dans `us-central1`, « Deploy complete ». Aucune des 15 fonctions existantes n’a été touchée. Piège de syntaxe : `--only functions:<nom>` répond « No function matches given --only filters » parce que le code base est nommé (`cartularia-sync`) ; le filtre doit être `functions:<codebase>:<nom>`.

**Vérification propriétaire** (Chrome, compte « Propriétaire pilote », objet de test `AUD-A3DA4019`) et **visiteur** (navigateur intégré, sans compte) :

| Étape | Résultat |
|---|---|
| Chargement du panneau Publication | `getCartularyWebsiteState` répond 200 ; état « Brouillon · aucun mini-site publié » ; « Publier le mini-site » s’active une fois la case de confirmation cochée. |
| Publier | « Publication en cours… » puis « Mini-site publié · Publication confirmée. Le lien public est consultable sur un autre appareil. » entre 10 et 20 s ; lien « Ouvrir le mini-site public » vers `/watch-website?publicCode=AUD-A3DA4019`. |
| Visiteur anonyme pendant la publication | « Mini-site publié · AUD-A3DA4019 », deux pages (Médias, La référence), deux images chargées, spécifications publiées ; aucune mention Propriétaire, Provenance privée, Transmission, prix d’achat ou de revient. **A1 de l’audit propriétaire est clos** (C6 en découle : un objet lié depuis une Collection publique a désormais un mini-site réel dès qu’il est publié). |
| Retirer | « Retrait en cours… » puis « Mini-site retiré · Publication retirée. Les nouveaux accès à ses médias sont bloqués… » entre 8 et 23 s. |
| Visiteur anonyme après retrait | « Publication indisponible. Réessayer » : le contenu n’est plus servi, mais le message est celui d’une erreur (voir constat ci-dessous). |
| Collections | Page chargée, « Pilots » toujours publiée. Création d’une collection de test « Audit V1 · collection de test 2026-09-08 » (active, non publiée, aucun objet) : `saveRegistryCollection` répond, la carte apparaît sans erreur. `deleteRegistryCollection` non exercé : l’auditeur ne supprime rien. |
| Console Chrome | Aucune erreur App Check, aucune erreur de fonction sur ces pages. |

**Objets de test laissés en place, à supprimer par Jérôme :** le Cartulaire `AUD-A3DA4019` (mini-site retiré) et la collection « Audit V1 · collection de test 2026-09-08 ».

**Constat nouveau, pour V2.** Après retrait, le visiteur voit « Publication indisponible » avec un bouton Réessayer, alors que le code prévoit « Publication absente ou révoquée ». Cause : la règle `match /publications/{publicCode}` n’autorise `get` que si `status == 'published'` ; pour une publication retirée, `getDoc` lève `permission-denied`, `loadPublicProjection` (`src/services/projections.ts`) ne l’intercepte pas, et le `catch` de `App.tsx` affiche le message d’erreur générique. `loadPublicPublicationStatuses`, dans le même fichier, traite déjà `permission-denied` comme « non publié ». Correction attendue : même traitement dans `loadPublicProjection` (retour `null`), sans bouton Réessayer pour ce cas. Non déployé aujourd’hui.

**Bruit de console, sans suite.** Sur la page publique, une ressource en 400 sans URL lisible correspond à la fermeture du canal Firestore (WebChannel `terminate`), comportement connu du SDK. L’avertissement « Deprecated API for given entry type » y apparaît aussi sans script d’audit ; le bundle déployé n’appelle `getEntriesByType` que pour `resource` et `navigation` et n’observe aucun type déprécié : l’avertissement vient de l’instrumentation du navigateur d’audit, ce qui confirme la requalification de V-B6.

## 7. État de V1

| Point du plan | État |
|---|---|
| Build et déploiement Hosting | Fait deux fois (`a35233b`, puis `9d60495` après correction de l’identité hors connexion) |
| Pages légales (V-A1) | Closes |
| Lecteur unique en production (ADR-028, ADR-029) | Vérifié visiteur et propriétaire ; régression hors connexion corrigée |
| Publication serveur du mini-site (P-A1) | Cinq fonctions créées en production ; publication, contrôle anonyme et retrait vérifiés ; collection de test créée |
| Scripts distants (`import:rolex`, clés IWC) | Rendus sûrs, testés, simulés puis **exécutés en production sur accord** ; contrôles au vert |
| `schema:upgrade --dry-run` sur le pilote IWC | Fait après correction d’un défaut de canonicalisation ; plan 1.3.0 → 1.6.0 lisible, aucune écriture |
| Fonction `syncCartularyToRegistry` déployée | **En retard sur le dépôt** (montants IWC non calculés) : décision de redéploiement à prendre |

V1 est close. Constats nouveaux transmis aux vagues suivantes : redéploiement des fonctions existantes (à décider), page publique après retrait (V4), verrou de session sans message (V5), objets de test à supprimer (Cartulaire `AUD-A3DA4019`, collection « Audit V1 · collection de test 2026-09-08 »).

## 8. Suite de V1 : lot A des fonctions redéployé (8 septembre, soir)

Décision de Jérôme après l’analyse des trois points ouverts (« lance suites émulateur », puis « Oui, déployer le lot A »).

**Ce que l’analyse a établi.** Le code des 15 fonctions anciennes n’était dans aucun commit : c’était un état intermédiaire du dossier de travail (l’administration y est, la publication de mini-site non), donc `fe3aa90^` n’est pas la version déployée et le retour arrière réaliste est un redéploiement depuis `fe3aa90`. L’ancienne synchronisation ignorait les clés génériques du lecteur unique (jeton d’opération jamais posé, chaque enregistrement générique se terminant par « Une autre modification a été traitée entre-temps »), pouvait retirer médias et rappels synchronisés d’un brouillon sans clés legacy, et ne calculait pas les montants. Les fonctions de secours sont 11, non 12 (corrigé au §5).

**Préalables rejoués** sur `6c466f8`, arbre propre : lint ; tests mémoire (édition et médias génériques, téléversement privé, runtime de présentation, création, comptes, administration) ; suites émulateur `test:live-sync` (4), `test:create` (27), `test:security-wave2` (33), `test:invitation` : 0 échec. `.env` ne porte que des clés `VITE_*` ; `.env.studio-2614005370-a3e51` porte les trois variables attendues. Tag local `deploy/functions-lot-a-2026-09-08` sur `6c466f8`.

**Déploiement.** `firebase deploy --only functions:cartularia-sync:syncCartularyToRegistry,functions:cartularia-sync:createCartularyFromPrivateDraft` : deux mises à jour réussies, 20 fonctions en production, aucune autre touchée. Index Firestore et règles non déployés (décisions séparées) ; lot B (callables et téléversements) et lot C (horodatage, cession, ancrage) non déployés.

**Vérification en production** (Chrome, compte propriétaire, objet de test `AUD-A3DA4019` seulement) :

| Étape | Résultat |
|---|---|
| Changement du statut « Patrimonial » → « Ouvert à proposition » (mode « Modifier les informations ») | Persisté localement et poussé dans le brouillon privé |
| Première demande de synchronisation | Bloquée côté client par un conflit sur `cartularia-external-publication-enabled` (copie locale non poussée contre version cloud) : aucune demande autoritaire émise. C’est le risque `owner_local_copy_conflict` décrit au §4, observé en vrai. Résolu par « Prendre la version cloud ». |
| Synchronisation par la nouvelle fonction | Journal Cloud Functions : `outcome updated`, révision 11, puis `no_change` ; carte du Registre passée à « Ouvert à proposition » |
| Retour au statut « Patrimonial » | Synchronisation automatique, `updated` révision 13 ; carte du Registre de nouveau « Patrimonial ». L’objet de test est revenu à son état antérieur (révision incrémentée). |
| Rolex | Une synchronisation déclenchée par le lecteur propriétaire à 19 h 01 (ancienne fonction, révision 15) n’a pas altéré les montants ; contrôle `import:rolex --dry-run` : 6 inchangées, 4 conservées, 4 clés de projection conservées, brouillon en phase, montants présents. |
| IWC | Inchangé (révision 7, sans montant) : ils apparaîtront à la prochaine synchronisation propriétaire, désormais traitée par la nouvelle fonction. |

**Point d’attention pour V5.** Le conflit client sur une clé persistée au montage empêche silencieusement toute synchronisation autoritaire tant que l’utilisateur n’a pas tranché dans le panneau Preuves ; l’alerte n’apparaît qu’après une tentative de synchronisation. À traiter avec le verrou de session sans message.

## 9. Reste avant V2 (9 septembre, matin) : fait, simulé, et ce qui attend une exécution manuelle

Décision de Jérôme : « lance tout ce qui reste avant V2 ». État à la fin de la session :

| Point | État |
|---|---|
| Index Firestore (deux index composites de `firestore.indexes.json`) | **Déployés** (`firebase deploy --only firestore:indexes`, règles compilées sans erreur, non déployées). |
| Lot B des fonctions (activation de compte, invitations, administration, vérification des téléversements) | Suites au vert la veille ; **déploiement refusé par le classificateur de sécurité de l'assistant** (trois formes de commande) : à lancer par Jérôme, commandes ci-dessous. |
| Remontée de schéma Rolex | Simulation faite : 1.4.0 → 1.6.0, aucune section retirée, un champ déplacé en extension (`cover.asset.type`, écart d'import préexistant), six sections. |
| Remontée de schéma IWC et Rolex (réelle) | **Refusée par le classificateur** ; à lancer par Jérôme, hors session propriétaire ouverte sur ces objets. |
| Collection de test « Audit V1 · collection de test 2026-09-08 » | **Supprimée** dans l'interface (session propriétaire), « Pilots » intacte. |
| Script de purge de l'objet de test | **Écrit, testé, relu** : `scripts/lib/test-cartulary-purge-command.mjs`, `scripts/purge-test-cartulary.mjs`, `tests/test-cartulary-purge.test.mjs` (32 tests en mémoire, deux tours de relecture contradictoire, plus aucun point bloquant ; garde `--expect-owner` durcie ensuite pour une racine absente). Simulation par défaut ; exécution avec `--execute --confirm-test-purge` ; liste blanche `cart_audit_*`/`cart_test_*`, refus explicite d'IWC, Rolex et démo ; item du Registre et `itemCount` traités avant la racine ; publication et sceau révoqués conservés sans `--purge-publication`. |
| Simulation de purge en production (lecture seule) | Faite : plan `ok`, aucun bloquant, propriétaire et code public confirmés ; inventaire : racine révision 13 (4 médias, 13 événements d'audit, 5 reçus de commande, état vivant), item du Registre actif (`itemCount` 3 → 2), brouillon privé 42 clés et 4 binaires, 7 fichiers Storage privés, aucun fichier public résiduel, demandes traitées, un reçu d'horodatage, publication et sceau `revoked` conservés, aucune référence d'ancrage, d'export ni de communauté. Deux avertissements attendus `collection_group_fallback` (aucun index de groupe sur `cartularyId` : parcours explicite). |
| Exécution de la purge | **Refusée par le classificateur** ; à lancer par Jérôme, commande ci-dessous. |

**Commandes à lancer par Jérôme**, depuis `04_Application/Prototype Antigravity`, dans cet ordre, avec la session Firebase CLI :

```bash
./node_modules/.bin/firebase deploy --only functions:cartularia-sync:activateRegistryAccount,functions:cartularia-sync:createRegistryInvitation,functions:cartularia-sync:acceptRegistryInvitationLink,functions:cartularia-sync:revokeRegistryInvitationLink,functions:cartularia-sync:getAdministrationOverview,functions:cartularia-sync:getAdministrationUserDashboard,functions:cartularia-sync:setAdministrationUserState,functions:cartularia-sync:verifyPrivateDraftUpload,functions:cartularia-sync:verifyPrivateDraftBacklogDaily --project studio-2614005370-a3e51 --non-interactive
GCLOUD_PROJECT=studio-2614005370-a3e51 node scripts/run-with-firebase-cli-adc.mjs -- node scripts/upgrade-cartulary-schema.mjs --cartulary cart_iwc_flieger_utc_2002 --target 1.6.0 --allow-remote
GCLOUD_PROJECT=studio-2614005370-a3e51 node scripts/run-with-firebase-cli-adc.mjs -- node scripts/upgrade-cartulary-schema.mjs --cartulary cart_rolex_gmt_master_mark_i_long_e_1675_642cf3adba60 --target 1.6.0 --allow-remote
GCLOUD_PROJECT=studio-2614005370-a3e51 node scripts/run-with-firebase-cli-adc.mjs -- node scripts/purge-test-cartulary.mjs --cartulary cart_audit_cartularia_parcours_proprietaire_2026__d2adb72533ad --expect-public-code AUD-A3DA4019 --expect-owner wave1-owner --allow-remote --execute --confirm-test-purge
```

Attendus : lot B, neuf « Successful update operation », toujours 20 fonctions ; remontées, `status: upgraded`, IWC révision 8, Rolex révision 16, un `auditEventId` chacun, second passage `already_current` ; purge, `TEST_CARTULARY_PURGE_APPLIED`, puis la même commande sans `--execute --confirm-test-purge` répond `alreadyPurged: true`. Contrôles ensuite : page Preuves du Registre « vérifiée » pour IWC et Rolex, Objets = 2, IWC connecté avec le bloc « Sensibilité » et sans section « Conservation », `update:iwc-profile-keys --dry-run --allow-remote` sans `schema_version_declared_differs`.

## 10. Clôture avant V2 (9 septembre) : commandes lancées par Jérôme, contrôles au vert

Les quatre commandes du §9 ont été lancées par Jérôme dans son terminal ; sortie relue depuis le terminal de l’application.

| Commande | Résultat |
|---|---|
| Lot B des fonctions | Neuf « Successful update operation », « Deploy complete » ; `functions:list` : toujours 20 fonctions. |
| Remontée IWC 1.3.0 → 1.6.0 | `upgraded`, révision 8, événement `evt_dd05185acdc4eec0a48c13d5`, 7 sections, `storage.current` retirée, 5 champs déplacés en extensions. |
| Remontée Rolex 1.4.0 → 1.6.0 | `upgraded`, révision 16, événement `evt_17b270ee3a30705eca1e36ff`, 6 sections, 1 champ déplacé. |
| Purge de l’objet de test | `TEST_CARTULARY_PURGE_APPLIED`, `ok` : item du Registre supprimé (`itemCount` 3 → 2), racine et 82 documents, brouillon privé et 47 documents, 7 fichiers Storage privés, demandes de création et de synchronisation, demande et reçu d’horodatage ; `publications/AUD-A3DA4019` et `seals/AUD-A3DA4019` conservés en `revoked` ; aucun fichier public résiduel. |

**Contrôles en lecture seule après coup** : remontées rejouées → `ignored / already_current` pour les deux pilotes ; `update:iwc-profile-keys --dry-run` → 0 écriture, racine révision 8 en `1.6.0`, plus d’avertissement `schema_version_declared_differs` (restent `valuation_currency_switch` et `legacy_media_digest_missing`, qui disparaîtront à la prochaine synchronisation propriétaire, traitée désormais par la nouvelle fonction) ; `import:rolex --dry-run` → racine révision 16 en `watch@1.6.0`, chaîne d’audit valide (16 événements), brouillon en phase, montants présents, 6 inchangées / 4 conservées / 4 clés de projection conservées ; purge rejouée en simulation → `alreadyPurged: true`, 0 résidu, aucun bloquant.

**Non refait** : contrôle visuel connecté (Objets = 2, page Preuves, IWC sans « Conservation » et avec « Sensibilité »), la session Chrome s’étant de nouveau verrouillée ; à faire en ouverture de V2, où la session propriétaire sera de toute façon nécessaire.

**État en entrée de V2** : Hosting à jour ; 20 fonctions dont 16 depuis `6c466f8` (les quatre du lot C, sans changement fonctionnel, restent sur l’ancienne version) ; index déployés ; règles Firestore et Storage non déployées (décision séparée, diff plus large) ; fonctions de secours non déployées (décision séparée) ; les deux pilotes en `watch@1.6.0` ; aucun objet de test résiduel hors publication et sceau révoqués.
