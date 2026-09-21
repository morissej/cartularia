# Assessment du code Cartularia — 18 septembre 2026

**Mandat : revue sans correctif. Aucun code applicatif, règle, dépendance ou environnement distant modifié. Les prompts ci-dessous sont des propositions non exécutées.**

## Avis général

La base possède des protections utiles : séparation Registre/Coffre/bridge, autorisations Firebase, transactions et révisions, contrôle des signatures de fichiers, dérivés distincts des originaux et nombreux tests. Cependant, plusieurs frontières de confiance et scénarios d'interruption restent incorrects. Je recommande de traiter les P1 avant la prochaine livraison fonctionnelle.

L'enjeu principal est la confidentialité et la fiabilité des sauvegardes. Les inefficiences les plus nettes concernent les relectures des journaux d'intégrité, le parcours intégral du stock de fichiers et les imports concurrents.

**P1** : traitement prioritaire, impact possible sur confidentialité, intégrité ou conservation des données. **P2** : correction planifiée de fiabilité, coût ou protection complémentaire. Ces priorités ne sont pas des scores CVSS.

## Périmètre et niveau de preuve

Revue transversale du checkout actif `04_Application/Prototype Antigravity`, branche `feat/lecteur-unique-adr-028-031`, base Git `d79851d`, incluant les changements locaux présents. Lecture de la documentation d'architecture et des changements récents, puis inspection des parcours Cartulaire, Registre, publication, Coffre, persistance, règles, fonctions serveur, traitements médias, dépendances et CI.

Les copies numérotées, sorties de build, caches et anciens prototypes ne sont pas assimilés au code actif. Le prototype voisin n'a fait l'objet que d'un repérage.

La revue combine inspection, tests existants, reproductions en mémoire et deux essais de règles sur émulateur Firestore isolé avec identités fictives. Elle ne constitue pas une lecture exhaustive de chaque ligne, un pentest distant, un audit cryptographique formel ni une certification de production. Aucun contrôle de l'IAM réel, des règles effectivement déployées, des journaux d'incident ou des versions serveur déployées. Aucun parcours navigateur authentifié de production reproduit pendant cet audit.

## Constats prioritaires

| ID | Priorité | Constat | Preuve |
| --- | --- | --- | --- |
| F01 | P1 | Données privées locales affichables après déconnexion/refus d'accès | Chemin de code complet |
| F02 | P1 | Suspension sans fermeture de tous les accès déjà ouverts | Émulateur + code |
| F03 | P1 | Manifeste antidaté accepté comme fichier vérifié | Émulateur + prédicat réel |
| F04 | P1 | Une sauvegarde peut acquitter une modification plus récente non envoyée | Reproduction en mémoire |
| F05 | P1/P2 | Reprise d'upload et reprise de vérification incomplètes | Décideur réel + mocks serveur |
| F06 | P2 | Import partiellement échoué : fichiers orphelins et mémoire gaspillée | Coffre réel avec backend mémoire |
| F07 | P2 | File des tâches acquittée trop tôt et non rejouée au redémarrage | Code + contrat SDK |
| F08 | P2 | Erreur de lecture des rappels présentée comme absence d'alertes | Chemin de code |
| F09 | P2 | Journaux : erreur périmée et recalcul global à chaque changement | Reproduction + amplification calculable |
| F10 | P2 | Backlog « limité à 10 » avec parcours complet des fichiers | Reproduction par mocks |
| F11 | P2 | Coffre déchiffré sans verrouillage automatique de session | Inspection |
| F12 | P1 pour Sharp ; triage pour le reste | Dépendances affectées par des avis de sécurité | Audit npm + avis mainteneurs |
| F13 | P2 | Validation globale rouge et CI sans tests métier/UI/règles | Exécution + workflow |

### F01 — La déconnexion ne ferme pas la lecture du Cartulaire local

[App.tsx:2334](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/App.tsx:2334>) rend les données privées même lorsque l'accès autoritaire vaut `signed-out` ou `denied`. [CartularyAccessNotice.tsx:29](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/cartulary/components/CartularyAccessNotice.tsx:29>) ne fait qu'afficher un bandeau « Lecture seule ». Le [bootstrap:130](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/bootstrap/applicationBootstrap.ts:130>) restaure le cache avant la confirmation des droits ; les clés du [coffre local:63](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/persistence/localVault.ts:63>) sont organisées par Cartulaire et non par utilisateur.

**Scénario :** un propriétaire ouvre un dossier privé, se déconnecte, puis une autre personne utilisant le même profil navigateur revient à son URL. Les informations locales restent affichables. Le [verrou de session:98](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/security/sessionSecurity.ts:98>) est limité à la route `/` et ne recouvre pas le lecteur `/cartulary`.

**Impact :** confidentialité locale, notamment sur poste partagé ou changement de compte. Ce n'est pas la démonstration d'une lecture distante anonyme. Les règles Firebase continuent à protéger leurs propres requêtes. Une protection visuelle seule ne protège pas les données au repos d'une personne ayant accès au profil navigateur.

**Correction proposée :** contrôle avant rendu, invalidation des opérations en cours, cloisonnement des caches par identité et déverrouillage explicite du mode hors ligne. Préserver les modifications non synchronisées ; ne pas résoudre le problème par une purge aveugle.

### F02 — Une suspension laisse des autorisations utilisables avec une session existante

[administration-command.mjs:348](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/scripts/lib/administration-command.mjs:348>) désactive le compte Auth et suspend son profil. Toutefois, [firestore.rules:20](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/firestore.rules:20>) se fonde sur le membership actif pour les lectures Registre/Cartulaire sans vérifier le statut du profil.

**Reproduction :** avec les règles réelles sur émulateur, une session qui pouvait lire un Cartulaire continue à le lire après passage de son profil à `suspended`, tant que son membership demeure actif.

Le [contrôle administrateur:16](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/scripts/lib/administration-command.mjs:16>) vérifie le claim et la fraîcheur d'authentification, sans relire l'état actuel du compte. Le risque d'utilisation d'un ancien token admin pendant cette fenêtre ressort du code ; cet appel n'a pas été reproduit en production.

Firebase distingue les tokens ID déjà émis des tokens de renouvellement : désactiver le renouvellement ne remplace pas un contrôle immédiat d'état/révocation à chaque frontière pertinente. [Documentation Firebase](https://firebase.google.com/docs/auth/admin/manage-sessions).

**Correction proposée :** contrôle central de compte actif/révocation dans les règles et commandes privilégiées, adapté aux trois projets indépendants. Préserver les parcours de démonstration autorisés ; tester avec une session déjà ouverte.

### F03 — Le client peut faire passer un fichier non vérifié pour un fichier historique fiable

[presentation-variants.mjs:44](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/scripts/lib/presentation-variants.mjs:44>) accepte un manifeste `ready`, sans version de vérification, lorsque `clientUpdatedAt` est antérieur au 18 août 2026. Or [firestore.rules:377](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/firestore.rules:377>) permet au client de choisir cette date et cet état.

**Reproduction :** un compte fictif actif a créé aujourd'hui un manifeste antidaté via les règles réelles ; `privateBinaryIsVerified` a retourné `true`, sans contrôle serveur ni fichier Storage.

La [création autoritaire:278](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/scripts/lib/create-cartulary-command.mjs:278>) consomme ce prédicat et vérifie le préfixe/suffixe du chemin, sans vérifier l'existence du fichier à cet endroit. Autre faiblesse connexe : [firestore.rules:408](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/firestore.rules:408>) permet de changer l'identité du binaire (`sha256`, taille, chemin) tout en conservant ses champs de vérification serveur ; [live-sync-command.mjs:155](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/scripts/lib/live-sync-command.mjs:155>) peut ensuite les reprendre.

**Impact :** références et empreintes non vérifiées admises dans un dossier autoritaire. Les contrôles de publication supplémentaires empêchent de conclure ici à la publication publique d'un fichier arbitraire.

**Correction proposée :** compatibilité historique attestée côté serveur, identité vérifiée immuable ou nouvelle version vérifiée, et tests négatifs d'antidatation/substitution/original absent.

### F04 — L'accusé de sauvegarde peut nettoyer une version jamais envoyée

[cloudDraft.ts:232](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/persistence/cloudDraft.ts:232>) acquitte une clé sans identifier la version locale envoyée. [localVault.ts:503](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/persistence/localVault.ts:503>) relit la version actuelle et lui applique `dirty:false`.

**Reproduction réelle en mémoire :** version A capturée pour synchronisation ; saisie de B pendant l'envoi ; acquittement de A. Résultat : B existe, mais est marquée propre. Le prochain passage retourne un conflit au lieu de pousser B. Une révision distante ultérieure peut rendre B éligible à un remplacement par pull.

Les [pulls:521](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/persistence/localVault.ts:521>) et acquittements binaires ont le même besoin de contrôle de version locale. Les transactions Firestore protègent certains conflits distants, pas cette course dans le navigateur.

**Correction proposée :** révision locale immuable, comparaison atomique lors des acquittements et pulls, conservation des modifications plus récentes et rejeu. Tests déterministes avec réseau retardé.

### F05 — Les transferts interrompus ne retrouvent pas toujours un chemin vers le succès

**Côté client, P1.** [cloudDraft.ts:311](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/persistence/cloudDraft.ts:311>) écrit `pending_upload` avant le transfert. [syncModel.ts:46](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/persistence/syncModel.ts:46>) compare hash/taille/MIME mais ignore le statut du transfert. Un manifeste identique resté `pending_upload` produit `noop`, puis [cloudDraft.ts:295](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/persistence/cloudDraft.ts:295>) acquitte le binaire. Ce résultat est reproduit avec le décideur réel. L'original peut rester absent malgré un état local propre.

**Côté serveur, P2.** [private-upload-command.mjs:369](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/scripts/lib/private-upload-command.mjs:369>) inscrit `processing` avant traitement ; [firebase-functions.mjs:320](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/scripts/firebase-functions.mjs:320>) désactive le retry et le [backlog:646](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/scripts/lib/private-upload-command.mjs:646>) ignore un traitement portant déjà la version courante. Un arrêt brutal/OOM/timeout peut laisser cet état sans reprise. Un manifeste fictif `processing` ancien a produit `inspected:0` lors du test.

**Correction proposée :** distinguer transfert et validation, reprendre les interruptions de manière idempotente, utiliser un bail serveur expirant et n'afficher un succès final qu'après confirmation adaptée. Ne jamais invalider un fichier déjà accepté pour tenter une reprise.

### F06 — Un lot d'import échoué laisse des fichiers sans référence

[importMediaFiles.ts:38](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/cartulary/media/importMediaFiles.ts:38>) persiste les fichiers en parallèle dans `Promise.all`. [App.tsx:1675](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/App.tsx:1675>) n'ajoute les références que si tout réussit.

**Reproduction avec le coffre réel en mémoire :** JPEG valide + JPG de signature invalide → lot rejeté, zéro actif retourné, mais le JPEG reste stocké avec `dirty:true`, sans référence visible. La synchronisation peut ensuite l'envoyer. Les pièces d'état et rapports utilisent un schéma similaire.

Pour les médias et pièces d'état, le hachage de [fileDigest.ts:6](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/utils/fileDigest.ts:6>) lit le fichier entier avant le contrôle de taille du coffre ; les fichiers sont traités sans limite de concurrence. Une grosse sélection peut donc consommer beaucoup de mémoire avant même son refus. Les rapports valident déjà avant le hachage, mais restent concernés par l'échec partiel du lot.

**Correction proposée :** validation préalable, concurrence bornée et politique explicite de succès partiels ou de transaction de lot ; nettoyage limité aux écritures de l'import échoué et révocation des URL objet.

### F07 — La file durable des tâches n'est pas un mécanisme fiable de reprise

[followUp.ts:78](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/services/followUp.ts:78>) transmet les snapshots sans `hasPendingWrites`. [useCartularyFollowUp.ts:139](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/cartulary/state/useCartularyFollowUp.ts:139>) retire les opérations pending dès qu'il retrouve leur valeur dans un snapshot.

Or Firestore diffuse aussi les écritures locales avant l'accusé serveur. [Documentation Firebase](https://firebase.google.com/docs/firestore/query-data/listen#events_for_local_changes). Avec le cache Firestore mémoire configuré actuellement, fermer l'application avant cet accusé peut faire perdre la mutation. De plus, la [branche après migration:122](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/cartulary/state/useCartularyFollowUp.ts:122>) réaffiche les opérations conservées, sans les renvoyer.

**Preuve :** inspection du flux et du contrat SDK ; pas de parcours navigateur hors ligne exécuté pour ce constat.

**Correction proposée :** acquittement de la mutation exacte après confirmation serveur et rejeu durable à la reconnexion/réouverture, y compris suppressions et modifications successives.

### F08 — Une erreur des rappels devient « Aucune alerte »

[RegistryOverview.tsx:108](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/registry/RegistryOverview.tsx:108>) transforme une erreur de lecture en liste vide, puis [la ligne 220](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/registry/RegistryOverview.tsx:220>) peut annoncer « Aucune alerte opérationnelle en cours. ».

**Scénario :** une assurance arrive à échéance, mais le listener est refusé ou échoue ; le compteur de rappels revient à zéro. Les réponses partielles de plusieurs dossiers n'ont pas non plus de statut d'exhaustivité.

**Correction proposée :** états chargement/partiel/erreur/complet distincts ; ne conclure à l'absence d'alertes que sur des données complètes.

### F09 — La vue Preuves travaille trop et peut afficher une erreur devenue obsolète

[registryIntegrity.ts:82](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/services/registryIntegrity.ts:82>) recharge tous les dossiers actifs à chaque snapshot du Registre, et [la ligne 33](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/services/registryIntegrity.ts:33>) recharge chaque journal complet puis en recalcule la chaîne.

**Amplification :** 100 dossiers de 500 événements représentent 50 000 événements et 200 documents examinés à nouveau, même si un seul titre a changé. C'est un volume logique dérivé du code, pas une mesure de latence ou de facturation en production.

Le [catch:88](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/services/registryIntegrity.ts:88>) ignore la protection de génération appliquée aux succès. **Reproduction :** une requête récente réussit puis une ancienne échoue ; les callbacks produisent `ready:1` puis `error:obsolete read failed`. La page efface alors les résultats valides.

**Correction proposée :** ignorer succès et erreurs périmés, invalider les travaux après désabonnement, limiter les lectures concurrentes et réutiliser les vérifications uniquement pour une identité/tête/séquence inchangée. Garder une vérification complète explicite.

### F10 — La limite du backlog ne limite pas son coût de lecture

[private-upload-command.mjs:610](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/scripts/lib/private-upload-command.mjs:610>) et [la ligne 654](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/scripts/lib/private-upload-command.mjs:654>) inventorient tous les originaux puis lisent leur manifeste. Les compteurs bornent les traitements utiles, pas les fichiers inspectés.

**Reproduction par mocks :** historique de 250 fichiers déjà traités, limite 10 → deux inventaires et 500 lectures de manifeste, zéro traitement. L'historique fait croître le coût et la durée jusqu'à risquer un timeout avant les nouveaux fichiers.

**Correction proposée :** file ou requête d'éligibilité paginée, curseur durable, budget maximal de lectures et progression équitable.

### F11 — Le Coffre reste déchiffré jusqu'au verrouillage manuel

[PersonalVaultApp.tsx:48](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/PersonalVaultApp.tsx:48>) conserve le secret de session ; [la ligne 109](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/PersonalVaultApp.tsx:109>) restaure le contenu déchiffré. Seul [performLock:170](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/PersonalVaultApp.tsx:170>) nettoie ces états. Le composant ne réagit pas à la perte de session et n'a pas de délai d'inactivité.

**Impact :** protection insuffisante d'une session laissée ouverte. Ce n'est pas une rupture du chiffrement ni une exfiltration distante démontrée. AES-GCM, dérivation de clé, projet séparé et contrôle de concurrence de sauvegarde sont présents.

**Correction proposée :** verrouillage local cohérent avec la sensibilité du Coffre, retrait du contenu lors d'une perte d'authentification et traitement explicite des saisies non enregistrées, sans les persister en clair.

### F12 — Des dépendances nécessitent un traitement de sécurité ciblé

Audit npm effectué le 18/09/2026 :

| Ensemble | Total de paquets signalés | Critiques | Élevés | Modérés | Faibles |
| --- | ---: | ---: | ---: | ---: | ---: |
| Complet, outils inclus | 47 | 2 | 10 | 34 | 1 |
| Dépendances de production (`--omit=dev`) | 24 | 2 | 2 | 19 | 1 |

Ces nombres incluent la propagation d'un avis dans plusieurs dépendances ; ils ne représentent pas autant de failles indépendantes ou d'exploits démontrés.

**Sharp, mise à jour prioritaire.** Le verrou de dépendances résout `sharp@0.35.3` ([package.json:151](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/package.json:151>)). Le traitement d'uploads accepte HEIC/HEIF et passe des données utilisateur à [Sharp:144](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/scripts/lib/presentation-variants.mjs:144>). Le mainteneur signale des vulnérabilités libheif pour les versions antérieures à 0.35.4, avec exécution de code possible dans certaines configurations Linux. Le chemin d'entrée existe ; la configuration native exacte du serveur et son exploitabilité n'ont pas été vérifiées. [Avis Sharp](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c).

**PDF.js.** `pdfjs-dist@5.6.205` est concerné par un avis corrigé en 6.2.108, conditionné à l'exécution de scripts dans le viewer. Ici, l'usage observé est un worker serveur de rendu avec `isEvalSupported:false`, XFA désactivé et annotations désactivées ([worker:14](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/scripts/lib/pdf-presentation-worker.mjs:14>)). Ces protections ne suffisent pas à elles seules à clore le triage, mais aucun chemin de viewer avec scripting n'a été identifié : exploitation non établie. [Avis PDF.js](https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j).

**OpenTimestamps et transitives.** `opentimestamps@0.4.9` conserve `request@2.88.2` et `form-data@2.3.3`, signalés par l'audit. Aucun chemin multipart contrôlé par un attaquant n'a été démontré dans les appels d'ancrage inspectés. Les deux mentions « critical » de npm ne prouvent donc pas deux compromissions de Cartularia.

**Correction proposée :** mise à jour compatible de Sharp, triage de chaque avis réellement atteignable, migrations testées de PDF.js et des composants d'ancrage. Pas de `npm audit fix --force` aveugle.

### F13 — La chaîne de validation ne constitue pas actuellement une barrière complète

`npm run test:v7` passe lint et **556 tests UI dans 95 fichiers**, puis s'arrête sur **3 échecs parmi 182 tests Node** :

- [cartulary-presentation-contract.test.mjs:1046](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/tests/cartulary-presentation-contract.test.mjs:1046>) attend une ancienne déclaration littérale de `NEVER_INCOMPLETE` ; l'audit comprend maintenant une règle supplémentaire.
- [demo-account.test.mjs:151](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/tests/demo-account.test.mjs:151>) et [demo-account.test.mjs:319](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/tests/demo-account.test.mjs:319>) inspectent des déclarations/liens autrefois présents dans HomePage, déplacés dans les composants publics.

Ce sont des contrats de source devenus obsolètes ; ces échecs ne démontrent pas à eux seuls que les boutons visibles sont cassés. Ils bloquent néanmoins la chaîne de validation.

Le seul [workflow:23](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/.github/workflows/schema-integrity.yml:23>) exécute catalogue, schéma, lint et build, sans tests UI, métier ou règles Firebase. Il peut donc rester vert malgré ces échecs.

**Correction proposée :** tests de comportement ou contrats moins liés à l'emplacement textuel du code, puis jobs CI explicites UI/métier/règles. Ne pas supprimer les exigences testées pour obtenir du vert.

## Vérifications effectuées

- `npm run test:v7` : lint passe ; 556/556 tests UI ; premier lot Node 179/182, trois échecs décrits ci-dessus.
- Pour ne pas arrêter l'audit à ces contrats, les **39 fichiers des étapes suivantes V4–V7** et des scripts associés ont été lancés séparément : **232/232 tests passent**. La commande complète V7 reste en échec.
- Tests ciblés des revues : 23 côté persistance/session, 24 côté performances/Registre/validation fichiers, 13 côté administration/publication ; tous passent. Certains recoupent les autres lots : ne pas additionner comme des tests uniques.
- `validate:ai` : 85 identifiants valides ; `schema:check` passe ; `git diff --check` passe.
- Reproductions complémentaires : course d'acquittement, reprise binaire, import partiel, erreur d'intégrité périmée, backlog de vérification et coût de scan.
- Émulateur isolé `demo-backend-audit` : manifeste antidaté accepté et lecture conservée après suspension. Émulateur arrêté à la fin.
- Audit npm complet et production, sans installation ni mise à jour.
- Pas de nouveau build, benchmark de production, déploiement ou modification de données distantes.

Journaux locaux temporaires : [validation V7](</private/tmp/cartularia-assessment-test-v7.log>), [lots suivants](</private/tmp/cartularia-assessment-downstream-tests.log>), [audit npm](</private/tmp/cartularia-assessment-npm-audit.json>), [audit npm production](</private/tmp/cartularia-assessment-npm-audit-prod.json>).

## Prompts de correction proposés — non exécutés

Chaque prompt s'applique au checkout actif. Préserver les changements existants et les originaux probants. Ne pas déployer, pousser ni modifier des données de production. Livrer cause, modification, tests, limites et liste exacte des fichiers touchés. Respecter le lecteur générique commun à tous les Cartulaires et l'indépendance Registre/Coffre/bridge.

### Prompt 1 — Fermer les données privées lors d'une perte de session (F01, F11)

> Corrige F01 et F11 de cet assessment. Avant de rendre un Cartulaire privé, confirme l'identité et les droits ; retire immédiatement les données du rendu lors de déconnexion, refus d'accès ou changement de compte, et invalide les réponses asynchrones anciennes. Cloisonne le cache par identité et Cartulaire. Préserve les brouillons non synchronisés sans les exposer au compte suivant ; définis un déverrouillage explicite pour un éventuel mode hors ligne. Applique le verrouillage aux routes privées réelles. Pour le Coffre, observe sa propre session, traite inactivité/onglet masqué et sauvegarde en cours sans stockage en clair. Conserve la démo fictive publique. Teste propriétaire→déconnexion→URL directe, compte A→B, refus serveur, ancien callback, inactivité et brouillon non enregistré. Explique séparément la protection du rendu et celle des données au repos.

### Prompt 2 — Rendre la suspension effective sur les accès existants (F02)

> Corrige F02. Établis un contrôle cohérent de compte actif et de révocation dans les règles et commandes privilégiées. Un token déjà émis ne doit plus permettre les opérations interdites après suspension ; le claim administrateur seul ne suffit pas. Préserve les permissions fines et les exceptions explicites de démonstration. Ne relie pas les identités des trois projets pour simplifier la solution. Ajoute des tests émulateur avec session ouverte, ancien token admin, suspension/réactivation, lecture et écriture. Vérifie les chemins de récupération et les échecs partiels d'administration. Documente la portée et le délai effectif de suspension.

### Prompt 3 — Rétablir la confiance serveur sur les fichiers (F03)

> Corrige F03. Supprime toute acceptation historique fondée uniquement sur un timestamp ou un statut fourni par le client. Prévois une attestation ou migration serveur vérifiable pour les fichiers historiques légitimes, sans les supprimer ni modifier leurs originaux. Lie l'acceptation à l'identité exacte du fichier : propriétaire, Cartulaire, binaryId, chemin, empreinte et taille. Rends ces champs immuables après acceptation ou crée une nouvelle version obligatoirement vérifiée. Vérifie les consommateurs création/synchronisation/miroirs/publication. Ajoute des tests négatifs d'antidatation, original absent, substitution après acceptation et chemin incorrect, ainsi qu'un cas historique valide. Ne présente pas une migration comme exécutée en production.

### Prompt 4 — Fiabiliser la synchronisation et les reprises (F04, F05)

> Corrige F04 et F05. Introduis un identifiant local de version capturé avant chaque opération ; les acquittements et pulls doivent être conditionnels à cette version et ne jamais effacer une saisie plus récente. Rebase la révision cloud sans nettoyer à tort dirty. Distingue manifeste créé, transfert terminé, validation en cours, validation acceptée et rejet. Un manifeste identique pending/verifying/failed ne vaut pas succès. Ajoute une reprise idempotente côté client et un bail expirant côté serveur pour les vérifications interrompues, sans dégrader les fichiers acceptés. Teste avec promesses différées, coupure après chaque étape, réouverture, deux onglets et crash serveur avant/après génération des dérivés. Aucun écrasement silencieux ni succès fictif ne doit subsister.

### Prompt 5 — Rendre les imports cohérents et bornés (F06)

> Corrige F06 pour médias, pièces d'état et rapports. Contrôle taille et format avant le hachage intégral, limite la concurrence et choisis explicitement une politique de succès partiels ou d'atomicité du lot. Assure la cohérence entre références UI et binaires persistés. Lors d'un échec, ne laisse aucun fichier de ce lot sans référence ni URL objet oubliée, sans supprimer les fichiers préexistants. Teste lot valide/invalide, quota dépassé, refus d'écriture, fichier trop volumineux rejeté avant lecture intégrale et nouvelle tentative sans duplication. Mesure le nombre maximal de traitements simultanés.

### Prompt 6 — Rendre les tâches et alertes fiables hors ligne (F07, F08)

> Corrige F07 et F08. Conserve une file durable par identité/Cartulaire ; acquitte la mutation exacte uniquement après confirmation serveur, pas sur un écho local de snapshot. Rejoue les opérations à la réouverture et au retour du réseau, y compris les suppressions, avec idempotence. Distingue données complètes, partielles, en chargement et en erreur dans le tableau de bord. Une erreur ne doit jamais devenir « Aucune alerte ». Teste hors ligne→édition→fermeture→réouverture, refus de permission, édition pendant rejeu, réponses désordonnées et erreur sur un dossier parmi plusieurs.

### Prompt 7 — Borner les lectures et protéger la vue Preuves (F09, F10)

> Corrige F09 et F10. Ignore les succès et erreurs d'anciennes générations, et invalide les travaux au désabonnement. Réutilise une vérification d'intégrité uniquement quand son identité, sa tête et sa séquence sont inchangées ; observe les changements pertinents et garde un contrôle complet explicite. Borne la concurrence. Remplace le double inventaire intégral des originaux par une sélection paginée ou une file d'éligibilité avec curseur durable, budget de lectures et progression équitable. Ajoute des tests comptant lectures et hachages, une modification isolée dans 100 dossiers, erreur ancienne après succès récent et historique beaucoup plus grand que la taille de lot. Ne réduis pas la vérification cryptographique pour améliorer artificiellement les mesures.

### Prompt 8 — Traiter les dépendances vulnérables sans migration aveugle (F12)

> Reprends un audit npm actualisé et corrige F12. Mets en priorité Sharp à une version corrigée compatible, vérifie la version libheif réellement embarquée dans la cible de déploiement et les formats acceptés. Trie les avis PDF.js/OpenTimestamps/transitives selon les chemins réellement utilisés ; réalise les migrations nécessaires dans des changements séparables. N'utilise pas npm audit fix --force. Teste génération des dérivés, limites mémoire, refus de documents actifs, rendu PDF et création/vérification des preuves d'ancrage. Fournis l'avant/après des avis, les versions résolues et les alertes restantes avec justification de leur portée. Aucun exploit ne doit être testé sur la production.

### Prompt 9 — Restaurer une validation globale et une CI protectrice (F13)

> Corrige F13 sans affaiblir les exigences fonctionnelles. Remplace les contrats obsolètes des trois tests actuellement en échec par des tests vérifiant le comportement ou le contrat désormais porté par les bons modules. Fais passer la validation globale. Ajoute des jobs CI distincts pour UI, métier et règles Firestore/Storage/Coffre/bridge sur émulateurs isolés, en évitant de relancer plusieurs fois les mêmes suites. Utilise des données fictives et fais échouer un test qui exige un émulateur absent au lieu de le sauter. Vérifie qu'une régression volontaire dans une copie temporaire est détectée. Garde cette CI sans déploiement automatique.

## Ordre proposé

1. Traiter les frontières de sécurité : prompts 1, 2 et 3 ; mettre à jour Sharp via le prompt 8.
2. Fiabiliser les sauvegardes et transferts : prompt 4.
3. Compléter les parcours d'import, tâches et alertes : prompts 5 et 6.
4. Réduire le coût des lectures : prompt 7.
5. Utiliser le prompt 9 comme garde de chaque lot, puis refaire la recette globale.

Après correction locale, une validation distincte devra confirmer les versions effectivement déployées et les parcours authentifiés sur Firebase. Cette étape n'est ni exécutée ni autorisée par les prompts ci-dessus.
