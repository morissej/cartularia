# Exécution du prompt 2 — Suspension et révocation des accès

Date : 18 septembre 2026. Checkout actif `04_Application/Prototype Antigravity`, branche `feat/lecteur-unique-adr-028-031`, base Git `d79851d` et changements locaux préexistants conservés.

## Mandat et cause

Exécution du deuxième prompt de [l’assessment](2026-09-18-assessment-code.md), constat **F02**. P1 a fermé les données dans le navigateur ; P2 ajoute les contrôles serveur pour qu’un ancien jeton et un membership encore actif ne suffisent plus après suspension.

Le défaut avait deux causes : des règles fondées sur le membership sans statut actuel du compte, et des commandes privilégiées acceptant les claims d’un jeton sans relire son état actuel. La désactivation Firebase Auth seule ne remplace pas les contrôles des jetons ID déjà émis. La solution suit le principe Firebase d’une date de révocation serveur contrôlée à chaque accès protégé. [Documentation Firebase](https://firebase.google.com/docs/auth/admin/manage-sessions).

**Livraison locale uniquement. Aucun commit, push, déploiement, changement IAM ou compte de production modifié.** Les autres prompts de l’assessment restent hors de ce lot.

## Contrat d’accès

Chaque projet possède son document serveur `accountAccess/{uid}`. L’UID est celui du projet concerné ; aucune table reliant les identités du Registre, du Coffre et du pont n’est créée. Les clients ne peuvent ni lire directement ni modifier ce document.

Le document contient `status` (`active` ou `suspended`) et `validAfter` (secondes UTC entières). Lorsqu’il existe, l’accès exige un compte actif et une authentification **strictement postérieure** au seuil. Le renouvellement d’un ancien jeton conserve `auth_time` et ne suffit donc pas. La réactivation conserve le seuil au lieu de rendre de nouveau utilisables les anciennes sessions.

Les jetons de récupération portent aussi `cartulariaRecoveryIssuedAt`. Une session issue d’un custom token créé avant le seuil reste refusée même si son échange se produit après réactivation. Un ancien custom token sans ce claim est également refusé lorsqu’une barrière existe. Une authentification par mot de passe ou un nouveau parcours de récupération peut rétablir l’accès. La seconde entière de révocation est fermée ; une connexion dans cette même seconde doit être réessayée ensuite.

Pour préserver les comptes déjà créés, l’absence de barrière n’interdit pas à elle seule l’accès. Dans le Registre, le profil `users/{uid}` doit néanmoins être actif. **Les suspensions/révocations antérieures à cette livraison doivent être reprises par l’outil de réconciliation avant de revendiquer la protection complète du parc existant.**

## Corrections réalisées

- **Firestore Registre :** contrôle du compte actif et de la révocation sur les lectures et écritures privées, memberships, dossiers, communauté, brouillons, demandes et profils isolés historiques. La lecture de son propre profil de compte reste permise pour afficher son état et fermer l’interface. Les lectures publiques restent publiques ; les permissions fines et la démo en lecture seule restent en place.
- **Firestore Coffre et pont :** contrôle dans chaque projet de sa propre identité et de sa propre barrière, sans dépendance au profil `users` du Registre.
- **Storage :** même suspension/cutoff via des miroirs serveur `{status, validAfter}` dans `users` et `communityMemberships`. Ces miroirs sont écrits atomiquement avec la barrière. Les règles Storage disposent d’un maximum de deux documents Firestore par évaluation ; le miroir évite de dépasser cette limite et de bloquer les accès légitimes. [Documentation Storage](https://firebase.google.com/docs/storage/security/rules-conditions#enhance_with_cloud_firestore).
- **Création des profils et admissions :** activation d’un compte, acceptation d’invitation et admission communautaire lisent la barrière dans leur transaction, refusent les comptes fermés et transmettent le miroir. Un profil créé après suspension/réactivation ne perd donc pas son seuil Storage. Les reprises d’activation/invitation réparent un miroir absent ou obsolète.
- **Commandes privilégiées :** relecture Auth (`disabled`, révocation native, claims actuels), profil et barrière avant activation, collections, invitations, publications et administration. L’administration exige aussi le claim dans le jeton et dans le compte actuel, ainsi qu’une authentification récente. Les deux projets secondaires configurés avec le même identifiant sont refusés.
- **Demandes différées :** transfert, horodatage, création et synchronisation recontrôlent le demandeur avant traitement. Une demande dont `requestedAt` appartient à la seconde de révocation ou la précède ne reprend pas après réactivation ; l’utilisateur doit en soumettre une nouvelle. Pour la création, où une reprise conserve le même `requestId`, le marquage d’échec compare aussi le propriétaire et la date exacte de tentative dans sa transaction. Un ancien événement livré tardivement ne peut donc pas mettre en échec une nouvelle tentative valide.
- **Récupération :** contrôles pour enrôlement, lecture, révocation, défis, émission des sessions et rotation. Les défis préparés avant suspension sont refusés après réactivation. Les écritures locales de récupération relisent les contrôles dans leur transaction ; les deux espaces secondaires sont contrôlés séparément.

## Suspension, réactivation et erreurs partielles

La première transaction ferme l’accès et écrit le seuil, le profil Registre et les miroirs existants. La commande applique ensuite l’état Auth, révoque les sessions renouvelables et écrit l’audit. La transaction finale confirme la suspension ou, pour une réactivation, ouvre seulement après réussite des étapes précédentes. Le seuil est monotone et un identifiant d’opération protège des résultats concurrents.

Un échec de désactivation, réactivation, révocation ou audit ne déclenche jamais de compensation qui rouvre silencieusement le compte. L’accès reste fermé ; l’état `failed` permet de réessayer. L’échec de la première transaction, avant tout changement confirmé, est retourné comme un échec : aucune suspension réussie n’est annoncée.

Un processus interrompu entre les étapes peut laisser `operationStatus: pending`. Aucune expiration automatique ne réactive le compte. Une réconciliation explicite et contrôlée est nécessaire avant une nouvelle tentative. La console présente l’état d’accès effectif, y compris lorsque l’état Auth seul n’explique pas la fermeture. Elle distingue une opération en cours d’un échec réessayable.

L’outil de réconciliation dispose d’un mode ciblé pour une opération interrompue depuis **plus de dix minutes**. Il vérifie l’UID, l’identifiant attendu et l’ancienneté dans une transaction, conserve la suspension et le seuil, passe seulement `pending` à `failed` et écrit un audit atomique dans `accountAccessReconciliations`. Il ne modifie pas Auth et ne réactive personne. Exemple de préparation, sans écriture :

```sh
node scripts/reconcile-account-access.mjs \
  --project "<firebase-project-id>" --database "<registry|personal|bridge>" \
  --resolve-pending --uid "<uid>" --operation-id "<expected-operation-id>" \
  --reason "Opération interrompue vérifiée" --operator "<référence-opérateur>"
```

Remplacer les paramètres avant emploi. Après examen du résultat et dans le cadre d’une intervention autorisée, `--apply` applique cette fermeture auditée. Une nouvelle action explicite dans la console peut ensuite reprendre la suspension ou la réactivation. Un identifiant différent, une date invérifiable ou une opération trop récente restent signalés pour examen manuel ; aucun délai ne suffit à rouvrir automatiquement l’accès.

## Vérification locale

Recette dédiée avec `firebase.p2-test.json` : Auth `39621`, Firestore `38620`, Storage `39622`, projet de démonstration `demo-cartularia-p2`. Aucun émulateur existant ni port utilisateur n’a été arrêté pour lancer cette recette. Les comptes et clés de signature utilisés sont fictifs et limités aux émulateurs.

- **76/76 tests de règles, communauté et invitation**, dont 19 nouveaux cas P2 dans les suites de règles : compte déjà connecté, suspension, réactivation, cutoff strict, ancien custom token, refus des modifications de la barrière, droits fins, démo et chemins publics.
- **4/4 parcours avec de vrais jetons Auth Emulator** : lectures et écritures refusées après suspension ; ancienne session toujours refusée après réactivation ; ancien claim administrateur retiré ; ancien custom token réellement échangé après réactivation refusé, claim d’émission vérifié dans le jeton ID obtenu ; session fraîche admise ; demande différée ancienne refusée ; admission communautaire et miroir.
- **77/77 tests unitaires P2** : administration (22), récupération (17), activation/provisionnement (12), réconciliation (18), version des tentatives de création (8). Ils couvrent aussi les refus avant transaction, les échecs Auth/audit, la concurrence, la reprise contrôlée des opérations interrompues et les comptes des trois projets indépendants.
- **629/629 tests UI**, sur 102 fichiers, après adaptation d’un faux jeton de test à `auth_time` entier. La console distingue notamment Auth désactivé, accès fermé après échec et opération en attente.
- **244/244 tests Node complémentaires**, sur 39 fichiers des étapes V4–V7 et des sous-suites publication de démonstration et performance, exécutés séparément.
- TypeScript, lint, builds Registre et Coffre, catalogue IA (85 postes) et `git diff --check` réussissent.

La commande globale `npm run test:v7` reste arrêtée par **trois échecs préexistants** dans son étape Node V3 : un contrat de présentation obsolète et deux attentes de démonstration visant les anciens emplacements du contenu de l’accueil (**179/182**). Ils sont déjà décrits par F13 et relèvent du prompt 9. Les étapes suivantes ont été exécutées séparément, sans affaiblir ces tests.

La recette dédiée se lance avec `npm run test:account-suspension` : **157 tests** au total (77 unitaires et 80 sur émulateurs). Elle exige Java 21 disponible pour Firestore. Dans cet environnement restreint, une configuration Firebase CLI temporaire via `XDG_CONFIG_HOME` évite une erreur d’écriture du cache utilisateur lors de l’arrêt ; aucun changement des droits du répertoire utilisateur n’est nécessaire.

Les lectures Storage sur émulateur sont exécutées avec `CARTULARIA_STORAGE_TEST_PROJECT_ID=demo-cartularia-p2`, identique au projet de démarrage, pour que la lecture Firestore depuis Storage atteigne les bonnes fixtures. Les assertions n’ont pas été assouplies pour contourner cette différence d’environnement.

## Portée et délai effectif

Après confirmation de la première transaction de suspension, la prochaine requête privée évaluée par les règles est refusée. Les commandes serveur contrôlent l’état à leur entrée ; les demandes en attente sont recontrôlées au début de leur traitement. Le test d’écoute déjà ouverte vérifie qu’un nouvel événement protégé n’est pas transmis après suspension. L’émulateur n’a pas immédiatement interrompu une écoute inactive au seul changement de sa dépendance ; aucune promesse de délai universel pour ce signal push n’est faite.

Une opération déjà autorisée ou un transfert déjà en cours peut terminer. Il n’existe pas de transaction atomique entre Firebase Auth, Firestore, Storage et les trois projets séparés. Les règles n’effacent pas des données déjà reçues ou téléchargées ; P1 assure la fermeture du rendu et conserve ses limites documentées. Les publications effectivement publiques ne sont pas dépubliées par la suspension d’un compte.

La protection Storage testée porte sur les requêtes authentifiées évaluées par les règles. Ce lot ne révoque pas les URL de téléchargement porteuses d’un token déjà délivrées par `getDownloadURL`, encore employé par les services médias existants. Il ne faut donc pas assimiler la suspension d’Authentication à l’invalidation de ces liens copiés antérieurement. Leur retrait ou le passage systématique à des téléchargements authentifiés relève d’un traitement supplémentaire des liens médias, avec vérification CORS ; Firebase distingue précisément les téléchargements par URL de ceux soumis directement aux contrôles SDK. [Documentation des téléchargements](https://firebase.google.com/docs/storage/web/download-files#download_data_directly_from_the_sdk).

Les requêtes couvertes par ces contrôles serveur sont bloquées indépendamment du délai de détection visuelle du client. P1 observe le profil Registre et les refus, et contrôle également les tokens au retour au premier plan et périodiquement. Le Coffre conserve sa session indépendante ; sa fermeture visuelle n’est pas présentée comme une notification serveur instantanée.

Une désactivation faite directement dans une console Auth externe, sans mise à jour des barrières, n’est pas magiquement répercutée dans les règles Firestore. Les commandes privilégiées relisent Auth et la détectent ; le circuit de suspension Cartularia ou la réconciliation doit publier la barrière pour les accès directs des anciens jetons. Aucun paramétrage ni délai de propagation de production n’a été mesuré ici.

## Préparation d’une future mise en service

1. Relire le plan de `scripts/reconcile-account-access.mjs` séparément pour chaque projet, avec `--project` et `--database` explicites. Le mode par défaut n’écrit rien. Le script ne change pas Auth, ne déchiffre rien et ne rapproche aucune identité entre projets.
2. Vérifier les droits du runtime et de l’opérateur : les seuls droits de lecture Firestore documentés historiquement sur les projets secondaires ne suffisent pas pour y écrire les barrières. **Aucun élargissement IAM n’a été effectué ici.**
3. Dans un déploiement distinct et autorisé, coordonner commandes, règles des trois projets, règles Storage et reprise des métadonnées existantes. L’absence de barrière est une compatibilité transitoire, pas une preuve qu’un compte historiquement désactivé est correctement migré.
4. Inspecter les comptes signalés `manual`, en particulier un état mal formé ou une opération interrompue. La réconciliation normale ne les rouvre pas et ne diminue jamais un cutoff existant.
5. Refaire une recette authentifiée sur chaque environnement effectivement déployé. Aucun résultat de cette intervention n’est une certification de l’IAM, des règles ou des Functions actuellement en production.

## Fichiers P2

Règles et exécution : `firestore.rules`, `storage.rules`, `personal-firestore.rules`, `bridge-firestore.rules`, `scripts/firebase-functions.mjs`, `scripts/lib/account-access-command.mjs`, `scripts/lib/queued-account-access.mjs`, `scripts/lib/administration-command.mjs`, `scripts/lib/account-command.mjs`, `scripts/lib/invitation-command.mjs`, `scripts/lib/community-command.mjs`, `scripts/lib/create-cartulary-command.mjs`, `scripts/lib/personal-recovery-command.mjs`, `scripts/lib/registry-recovery-command.mjs`.

Reprise : `scripts/reconcile-account-access.mjs`, `scripts/lib/account-access-reconciliation.mjs`. Console : `src/services/administration.ts`, `src/features/administration/AdministrationApp.tsx`, `src/features/administration/AdministrationUserDashboard.tsx`.

Tests : `tests/account-suspension-emulator.test.mjs`, `tests/account-access-provisioning.test.mjs`, `tests/account-access-reconciliation.test.mjs`, `tests/cartulary-create-failure-version.test.mjs`, `tests/account-command.test.mjs`, `tests/administration-command.test.mjs`, `tests/personal-recovery.test.mjs`, `tests/audit-access-recovery-emulator.test.mjs`, `tests/firestore.rules.test.mjs`, `tests/storage.rules.test.mjs`, `tests/personal-firestore.rules.test.mjs`, `tests/bridge-firestore.rules.test.mjs`, `tests/community.test.mjs`, `tests/ui/administration-access-corrections.test.tsx`, `tests/ui/registry-kit-session-generation.test.tsx`, `tests/ui/registry-recovery-roundtrip.test.tsx`, `tests/ui/vault-rotation-version.test.tsx`. Configuration : `firebase.p2-test.json`, `package.json`.

Documentation : ce compte rendu et `docs/ADR-027-console-administration-trois-bases.md`.

Le câblage de `tests/audit-access-recovery-emulator.test.mjs` a été adapté au client pont distinct ; cette ancienne recette complète n’a pas été relancée sur ses ports historiques. La recette P2, les tests unitaires de récupération et les tests UI constituent les validations exécutées pour ce lot. Aucun parcours administrateur authentifié en production n’a été exécuté.

Les changements P1 et ceux de l’accueil déjà présents sont conservés ; ils ne sont pas présentés comme des modifications P2.
