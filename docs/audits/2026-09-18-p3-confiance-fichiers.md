# Exécution du prompt 3 — Confiance serveur sur les fichiers

Date : 18 septembre 2026. Checkout `04_Application/Prototype Antigravity`, branche `feat/lecteur-unique-adr-028-031`. Changements préexistants de l’accueil, P1 et P2 conservés.

## Mandat et cause

Exécution du **prompt 3 / F03** de [l’assessment](2026-09-18-assessment-code.md). **Livraison locale uniquement : aucun commit, push, déploiement, changement IAM ni migration en production.**

Le prédicat serveur acceptait un manifeste `ready` sans contrôle des octets si sa date client précédait la transition d’août. Le client pouvait aussi modifier le chemin, l’empreinte ou la taille d’un manifeste déjà accepté. Les consommateurs pouvaient alors reprendre une ancienne acceptation pour une nouvelle identité. Deux contournements connexes ont été reproduits et corrigés : supprimer/recréer le manifeste avec le même identifiant, et réutiliser une préparation de publication correspondant à un ancien original.

## Contrat serveur

`privateBinaryIsVerified` exige maintenant `deleted: false`, `uploadStatus: ready`, `verificationStatus: accepted` et une `verificationIdentity` cohérente. Aucune date client ne confère d’acceptation. La constante historique reste informative uniquement.

L’attestation `private-binary-identity@1.0.0` lie exactement le propriétaire, le Cartulaire, le `binaryId`, le chemin canonique, le SHA-256, la taille, le bucket choisi par le serveur et la génération Storage. Elle est écrite après contrôle des métadonnées et inspection des octets de cette génération précise. Le pipeline utilise la version `private-upload@1.2.0`.

Les consommateurs contrôlent à nouveau l’existence de l’objet, sa génération et ses métadonnées. Ils ne retéléchargent pas chaque original pour le rehacher à chaque synchronisation : la génération lie le contrôle antérieur aux octets immuables, et un remplacement crée une autre génération. [Documentation des générations Cloud Storage](https://cloud.google.com/storage/docs/metadata#generation-number).

Le modèle suppose les écritures Admin de confiance. Les clients ne peuvent écrire ni l’attestation ni l’identifiant d’inspection serveur. Les règles limitent les champs modifiables ; après acceptation, elles interdisent toute substitution d’identité, y compris pour un ancien manifeste accepté sans attestation. [Contrôle des champs Firestore](https://firebase.google.com/docs/firestore/security/rules-fields#restricting_fields_on_update).

## Corrections

- **Inspection :** téléchargement de la génération sélectionnée, contrôle chemin/contexte/métadonnées/taille/empreinte/signature, puis relecture de la génération courante avant acceptation. Les alias MIME légitimes et les renommages restent compatibles.
- **Concurrence :** une transaction compare l’identité capturée et `verificationAttemptId` avant de finaliser. Un résultat ancien ne peut accepter un manifeste modifié ni dégrader une acceptation plus récente. Les écritures de dérivés utilisent également une précondition de génération pour éviter l’écrasement par un ancien traitement.
- **Règles :** chemin exact obligatoire ; identité, MIME et catégorie figés après acceptation. La suppression logique reste possible. La suppression physique du manifeste accepté est refusée au client, même après suppression logique, empêchant sa recréation avec le même identifiant. Les opérations de rétention Admin conservent leur propre circuit.
- **Création et synchronisation :** les nouvelles références et les nouveaux miroirs nécessitent une attestation et un original encore présent. Un autre binaire ne récupère plus le chemin d’un ancien. Une édition simple d’un import historique existant conserve ses références sans inventer une nouvelle validation.
- **Régénération et miroirs :** présence de variantes seule insuffisante ; contrôle de l’original avant génération ou propagation. Les transactions relisent le manifeste, le propriétaire et les documents ciblés. Une panne de production de dérivés ne dégrade pas l’original accepté.
- **Publication :** contrôle de l’original et du dérivé, y compris en reprise. Chaque préparation mémorise l’identité ayant produit sa copie ; identité différente, original absent, éligibilité retirée ou ancien cache sans attestation entraînent un refus. Ces métadonnées restent dans `websiteOperations` privé et sont retirées des références approuvées/publiées.
- **Scripts :** Storage est transmis aux consommateurs et aux commandes de régénération. Le script IWC vérifie les réutilisations et ne réécrit plus un original déjà présent pour le réattester ; une création utilise une précondition d’absence. Ces scripts n’ont pas été exécutés contre des données distantes.

## Reprise des fichiers historiques

Outil : `scripts/migrate-private-binary-verification.mjs`. Projet, bucket, UID, Cartulaire et liste de 1 à 100 identifiants binaires distincts sont obligatoires. Aucun inventaire global implicite ni cible récupérée dans l’environnement. Les émulateurs Firestore et Storage doivent être configurés ensemble.

Exemple de **simulation** — remplacer les paramètres :

```sh
node scripts/migrate-private-binary-verification.mjs \
  --project "<firebase-project-id>" --bucket "<bucket>" \
  --uid "<uid>" --cartulary "<cartulary-id>" \
  --binary "<binary-id>"
```

La simulation inspecte réellement les originaux sélectionnés, sans écriture distante. `--binary` peut être répété. Ajouter `--apply` dans une intervention autorisée exécute une nouvelle vérification serveur et produit l’attestation et les dérivés nécessaires. Les octets et la génération des originaux sont conservés. Un objet déjà attesté et cohérent reste inchangé ; original absent, chemin incorrect ou empreinte divergente sont signalés sans certification fictive. Le script retourne un code non nul lorsqu’un fichier reste bloqué.

**Aucune reprise historique réelle n’a été exécutée.** Le durcissement rend les anciennes acceptations sans attestation insuffisantes pour de nouvelles références ou publications. Leur reprise doit donc accompagner une future mise en service coordonnée des règles, commandes et traitements de fichiers. Les anciennes preuves de publication mises en cache sans identité doivent faire l’objet d’une nouvelle demande.

## Validation locale

Recette reproductible : `npm run test:private-binary-trust`, avec Java 21. `firebase.p3-test.json` utilise le projet fictif `demo-cartularia-p3`, Firestore `38620`, Storage `39622` et Auth `39621`. Les émulateurs lancés pour cette recette sont arrêtés ; aucun service utilisateur préexistant n’a été arrêté. Une configuration Firebase CLI temporaire via `XDG_CONFIG_HOME` a évité les écritures dans le cache utilisateur restreint.

- **124/124 tests unitaires de la recette P3**, incluant inspection, concurrence, migration, création de miroirs, publication et régressions P2 de création.
- **74/74 tests sur émulateurs** : règles Firestore (34), création/synchronisation (11), règles Storage (22), parcours d’inspection et d’attestation sur Firestore/Storage (7).
- **629/629 tests UI**, sur 102 fichiers ; builds Registre et Coffre, lint, catalogue IA (85 postes) et vérification du diff réussis.
- **434/437 tests Node V3–V7**, sur 51 fichiers distincts : seuls subsistent les trois échecs préexistants de F13 (contrat d’accessibilité obsolète et deux attentes de démonstration liées à l’accueil), réservés au prompt 9. Le contrat modifié par P3 exige désormais une attestation au lieu de l’ancienne tolérance historique.
- **68/68 tests complémentaires** des commandes Rolex et de publication de démonstration. Ces résultats recoupent en partie les autres suites ; ils ne représentent pas un total de tests uniques.

Les cas négatifs couvrent antidatation, original manquant, mauvais chemin/contexte, génération remplacée, métadonnées altérées, substitution après acceptation, suppression/recréation, réponse d’inspection périmée et reprise de publication périmée. Le cas historique valide vérifie l’absence de réécriture des octets et de la génération de l’original.

Journaux locaux : [recette intégrée](</private/tmp/cartularia-p3-final.log>), [dernière passe unitaire](</private/tmp/cartularia-p3-unit-final.log>), [régression Node V3–V7](</private/tmp/cartularia-p3-node-regression.log>), [UI](</private/tmp/cartularia-p3-ui.log>).

## Limites et mise en service

Firestore et Storage ne constituent pas une transaction distribuée : un contrôle porte sur la génération observée au moment de l’opération. Les préconditions et comparaisons protègent les écritures concurrentes, sans promettre qu’un original ne pourra jamais être supprimé après un contrôle réussi. Les copies déjà téléchargées ou effectivement publiées ne sont pas retirées par cette migration.

Les dossiers et références autoritaires historiques ne sont ni effacés ni certifiés rétroactivement par le simple déploiement du code. Les fichiers bloqués lors de la reprise doivent être examinés explicitement. Aucun contrôle IAM, déclenchement Cloud Storage de production ou parcours navigateur authentifié en production n’a été réalisé. La reprise des traitements interrompus par bail, les scans du backlog et les dépendances relèvent respectivement de P4, P7 et P8.

## Fichiers touchés par P3

Règles/configuration : `firestore.rules`, `firebase.p3-test.json`, `package.json`.

Noyau et consommateurs : `scripts/lib/presentation-variants.mjs`, `scripts/lib/private-upload-command.mjs`, `scripts/lib/create-cartulary-command.mjs`, `scripts/lib/live-sync-command.mjs`, `scripts/lib/generic-media-command.mjs`, `scripts/lib/presentation-regeneration-command.mjs`, `scripts/lib/website-publication-command.mjs`.

Migration/raccordements : `scripts/lib/private-binary-migration.mjs`, `scripts/migrate-private-binary-verification.mjs`, `scripts/firebase-functions.mjs`, `scripts/run-cartulary-create-worker.mjs`, `scripts/run-cartulary-sync-worker.mjs`, `scripts/import-rolex-cartulary.mjs`, `scripts/update-iwc-dossier.mjs`.

Tests : `tests/firestore.rules.test.mjs`, `tests/private-upload-command.test.mjs`, `tests/private-upload-emulator.test.mjs`, `tests/private-binary-migration.test.mjs`, `tests/presentation-variants.test.mjs`, `tests/presentation-regeneration-command.test.mjs`, `tests/cartulary-create.test.mjs`, `tests/live-sync.test.mjs`, `tests/registry-thumbnail.test.mjs`, `tests/generic-media-command.test.mjs`, `tests/cartulary-presentation-contract.test.mjs`, `tests/website-publication-command.test.mjs`, `tests/helpers/private-original-fixture.mjs`, `tests/helpers/verified-original-storage.mjs`.

Documentation : ce compte rendu. Les autres fichiers déjà modifiés avant P3 ne sont pas attribués à ce lot.
