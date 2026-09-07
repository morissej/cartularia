# Nouvel audit — Registre, Collections et Cartulaire générique

Date : 6 septembre 2026. Audit du code présent dans le worktree au moment de cette passe, sans reprendre les statuts des rapports précédents comme preuve.

Périmètre : lecture seule des sources, tests locaux et tests du seul projet fictif `cartularia-audit-collections-test` sur Firestore Emulator `127.0.0.1:38480`. Aucun navigateur, compte réel, publication réelle, seed distant, déploiement ou changement IAM utilisé. Aucun code applicatif modifié. Les reproductions supplémentaires sont dans un répertoire temporaire hors dépôt ; ce rapport est le seul fichier du dépôt ajouté par cette passe.

## Synthèse

Les parcours nominaux ciblés et les protections de suppression serveur passent leurs tests frais. Cela n’élimine pas cinq défauts reproduits dans l’interface : formulaire de Collection périmé, formulaire conservé après suppression, reprise de création ignorant les nouvelles saisies, choix de publication non protégés et Collections secondaires absentes des invitations.

La gravité la plus forte concerne la concurrence sur une Collection : une ancienne sélection publique peut être renvoyée après une décision de retrait plus récente. L’envoi client est reproduit ; son effet persistant est établi par lecture du service sans précondition de version, **pas par une publication distante**.

## N-R01 — P1 : un formulaire de Collection ancien peut annuler une décision plus récente

- **Scénario :** ouvrir en édition une Collection publiée avec l’objet A sélectionné. Une autre session retire sa publication et corrige sa description ; l’abonnement reçoit bien ce nouvel état. Dans le premier formulaire, changer seulement le nom et enregistrer.
- **Résultat reproduit :** le formulaire conserve `publicationConsent: true`, la sélection `[A]` et l’ancienne description. Il soumet encore « Enregistrer et publier », sans conflit ni avertissement indiquant le changement intervenu ailleurs.
- **Impact :** perte de la dernière correction et risque de remettre en ligne une sélection qu’une autre session vient de retirer. Ce n’est pas un contournement des droits : cela concerne deux actions autorisées concurrentes.
- **Cause :** le formulaire copie le document uniquement à l’ouverture (`src/features/registry/RegistryCollections.tsx:58-73`) puis soumet cette copie (`:84-105`). Le service relit l’existence, mais ne compare aucune révision/horodatage du formulaire ; il effectue un `batch.set(..., { merge: true })` (`src/services/collections.ts:69-111`) et réécrit la projection publique (`:113-136`). Les Rules d’update ne demandent pas de version attendue (`firestore.rules:189-205`).
- **Preuve :** test DOM temporaire « une décision de dépublication reçue pendant édition est écrasée par le formulaire ancien » : requête soumise vérifiée. Persistance et effet public non exécutés dans cette recette.
- **Amélioration :** envoyer une version de départ, refuser l’écrasement concurrent, présenter les différences et demander une nouvelle décision explicite pour la publication.

## N-R02 — P2 : une Collection supprimée reste ouverte en édition

- **Scénario :** modifier une Collection vide, saisir un nom, cliquer sur son bouton Supprimer, confirmer, puis attendre sa disparition de l’inventaire. Le formulaire demeure ; cliquer sur Enregistrer.
- **Résultat reproduit :** l’ancien identifiant est encore envoyé à `saveRegistryCollection`, avec la saisie antérieure à la suppression.
- **Impact :** la suppression paraît ne pas tenir ; l’éditeur peut recréer la Collection supprimée. Le nouveau nettoyage serveur empêche la résurrection des anciens enfants publics dans les scénarios couverts : **aucune réapparition de ces enfants n’a été constatée ici**.
- **Cause :** la suppression ne ferme/invalide pas `editingId` et n’utilise pas la garde du formulaire (`src/features/registry/RegistryCollections.tsx:150-157`, bouton `:293`). Le formulaire est conditionné seulement par `editingId !== null` (`:172-174`). Le service accepte indifféremment création et modification : l’absence du document conduit à l’upsert et à un nouveau `createdAt` (`src/services/collections.ts:69-71`, `:95-111`).
- **Preuve :** test DOM temporaire « une Collection supprimée reste éditable… » ; suppression simulée réussie, nouvel inventaire vide, ancien formulaire puis appel de sauvegarde vérifiés. Recréation Firestore non exécutée par ce test.
- **Amélioration :** fermer le formulaire après suppression de sa cible et refuser une modification d’un document disparu ; distinguer création et mise à jour côté service.

## N-R03 — P2 : une reprise de création ignore les corrections et affiche un faux intitulé de succès

- **Scénario :** demander la création d’un objet « Modèle initial ». La demande est créée mais sa confirmation dépasse le délai. Corriger le modèle dans le formulaire, puis cliquer de nouveau sur « Créer le Cartulaire ».
- **Résultat reproduit :** aucune seconde création n’est appelée : la reprise réutilise correctement le premier identifiant, mais les corrections visibles ne sont jamais transmises. Le succès affiche pourtant « Modèle corrigé ignoré », calculé depuis le formulaire actuel, pour le Cartulaire demandé avec « Modèle initial ».
- **Impact :** l’utilisateur croit avoir corrigé son dossier alors qu’il ouvre ensuite un objet aux anciennes caractéristiques. Le problème existe aussi pour une modification pendant l’attente, car la plupart des champs restent actifs.
- **Cause :** `resumeOrCreateCartulary` renvoie la demande en attente sans exécuter la nouvelle création (`src/domain/cartularyCreation.ts:66-69`). Le formulaire demeure modifiable (`src/features/registry/NewCartularyPage.tsx:216-225`, `:234-240`, `:250-258`), contrairement au seul type d’objet (`:208`). Le titre de succès provient de `form` (`:180-188`) et le bouton ne distingue pas une reprise (`:273-275`).
- **Preuve :** test DOM temporaire après délai, correction puis reprise : un appel `createCartulary` seulement, son profil initial contrôlé, deux attentes sur le même identifiant, titre de succès incorrect contrôlé.
- **Amélioration :** figer/afficher le contenu de la demande en cours, nommer clairement l’action « Vérifier la création en cours », puis proposer l’édition du Cartulaire réellement créé. Ne pas générer un doublon pour résoudre ce défaut.

## N-R04 — P2 : les choix de publication du Cartulaire générique se perdent sans avertissement

- **Scénario :** sur Publication d’un Cartulaire générique, cocher une image déjà autorisée « Tous », puis recharger/quitter et revenir avant d’avoir publié.
- **Résultat reproduit :** le choix est coché, mais `beforeunload` n’est pas bloqué et aucune confirmation n’est demandée ; le remontage de la vue remet toutes les sélections à vide.
- **Impact :** perte d’une sélection préparée ; l’utilisateur doit recomposer la liste. La sélection ne retire pas la publication courante : aucune dépublication implicite n’est imputée à ce défaut.
- **Cause :** `publicationSelection` et `selectedMediaIds` sont des états locaux initialisés vides (`src/components/GenericCartularyView.tsx:60-61`), exclus de la garde qui ne surveille que sauvegarde, autorisation et édition de champs (`:63`). Le panneau ne réhydrate pas cette sélection depuis l’état publié (`src/components/PublicWebsitePublicationPanel.tsx:23`, `:40`).
- **Preuve :** test DOM temporaire « les choix de médias de publication disparaissent… », avec média déjà autorisé pour ne pas confondre l’autorisation persistée et le choix non sauvegardé.
- **Amélioration :** protéger le brouillon de sélection ou permettre sa sauvegarde explicite ; distinguer visuellement choix en préparation et sélection actuellement publiée.

## N-R05 — P2 : impossible de choisir une Collection secondaire comme portée d’invitation

- **Scénario :** un objet a `collectionId = Principale` et `collectionIds = [Principale, Secondaire]`. Les deux Collections existent. Ouvrir Nouvelle invitation et sélectionner « Une Collection ».
- **Résultat reproduit :** seule Principale est proposée ; Secondaire manque malgré son contenu.
- **Impact :** le partage d’une Collection thématique/secondaire est bloqué depuis le Centre des accès. Le Catalogue et la liste des Collections savent pourtant traiter les rattachements secondaires.
- **Cause :** la liste des portées est construite exclusivement depuis `registryItems.map(item => item.collectionId)` (`src/features/registry/RegistryAccessCenter.tsx:166-171`), sans `registryItemCollectionIds` ni inventaire des Collections.
- **Preuve :** test DOM temporaire avec deux Collections et un objet à double rattachement ; présence de l’option Principale et absence de Secondaire vérifiées. Aucune invitation émise.
- **Amélioration :** construire les portées depuis les Collections autorisées, ou au minimum utiliser l’ensemble des rattachements canoniques. Vérifier ensuite la portée réellement accordée côté serveur.

## Compléments moins prioritaires

### N-R06 — P2, chemin alternatif : certaines listes du schéma montre sont éditables mais impossibles à enregistrer

Le lecteur générique est accessible via `/cartulary-view?cartularyId=…` pour un objet non démo (`src/RootPage.tsx:49-50`), même si le chemin nominal d’une montre utilise `/cartulary` (`src/features/registry/registryCatalog.ts:81-84`).

Dans `watch@1.6.0`, le formulaire exclut les fichiers et montants répétables de ses groupes éditables (`src/components/GenericCartularyView.tsx:192-193`, `:224` ; `scripts/lib/generic-editing-policy.mjs:3-7`). Le serveur exige néanmoins **tous** les frères de la liste (`scripts/lib/generic-sections-command.mjs:16-24`). Une ligne de contrôle avec date, titre et note est donc refusée pour absence de `condition.reports[].documents`, qui n’a pas de champ éditable. Les groupes de valorisations, comparables et frais contenant un montant répétable ont la même incompatibilité à la lecture.

**Preuve pure exécutée :** construction d’une ligne avec les trois champs réellement éditables de `condition.reports[]` puis appel de `buildGenericSectionPatches` : rejet `invalid_generic_edit`, « Une liste doit être enregistrée avec tous ses champs alignés. » Aucune sauvegarde distante. Ce résultat ne concerne pas les listes d’entretien/incidents du profil automobile testées positivement.

**Amélioration :** ne pas proposer l’édition d’un groupe partiellement pris en charge, ou définir un contrat serveur préservant explicitement ses champs non éditables.

### N-R07 — P3, contenu : message contradictoire sur les valeurs du Registre

Le pied du formulaire de création promet une projection « sans numéro de série, valeur ni chemin de fichier » (`src/features/registry/NewCartularyPage.tsx:272`), alors que la section Acquisition annonce correctement que les montants alimentent les vues privées du Registre (`:247-248`). La commande projette effectivement `purchasePrice`, `costBasis` et `grossValuation` (`scripts/lib/live-sync-command.mjs:381-386`). À harmoniser : privé dans le Registre n’est pas absent du Registre. Constat de lecture, pas fuite de valeur publique démontrée.

## Tests frais et résultats

- **29 tests UI existants, 6 fichiers :** `generic-editing`, `generic-repassage-corrections`, `generic-followup-errors`, `registry-audit-corrections`, `website-publication-panel`, `invitation-community-corrections`. Tous passent.
- **38 tests Node existants, 7 fichiers :** édition générique, commande média, Collections, accès, catalogue, validation Nouvelle création, commande de publication. Tous passent.
- **14 tests émulateur Collections :** suppression atomique, orphelins, recréation sans anciens enfants publics, limites, droits, nouvelles affectations et course suppression/affectation. Tous passent. Fixtures nommées par exécution, nettoyées par le test ; aucun autre projet modifié.
- **5 tests DOM supplémentaires hors dépôt :** chacun affirme le comportement défectueux N-R01 à N-R05 pour le reproduire, et non sa correction. Tous passent dans leur dernière exécution.
- **1 reproduction Node pure supplémentaire :** rejet du groupe `condition.reports[]` décrit en N-R06.
- `git diff --check` passe. Pas de build global ni de suite complète annoncés pour cette passe.

Commandes principales rejouables depuis le dépôt :

```sh
node node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/ui/generic-editing.test.tsx tests/ui/generic-repassage-corrections.test.tsx tests/ui/generic-followup-errors.test.tsx tests/ui/registry-audit-corrections.test.tsx tests/ui/website-publication-panel.test.tsx tests/ui/invitation-community-corrections.test.tsx
node --test tests/generic-editing.test.mjs tests/generic-media-command.test.mjs tests/registry-collections.test.mjs tests/registry-access.test.mjs tests/registry-catalog.test.mjs tests/new-cartulary-validation.test.mjs tests/website-publication-command.test.mjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:38480 GCE_METADATA_HOST=127.0.0.1:9 node --test tests/audit-collections-emulator.test.mjs
node node_modules/vitest/vitest.mjs run --config /private/tmp/cartularia-nouvel-audit-registre.nbg9n0/vitest.config.mts
```

Le dernier harnais et ses cinq scénarios sont conservés dans `/private/tmp/cartularia-nouvel-audit-registre.nbg9n0/repro.test.tsx`. Le répertoire temporaire peut disparaître au nettoyage système.

## Limites et points non imputés comme anomalies

- Les scénarios DOM emploient les composants actuels et des services simulés ; ils prouvent les états et requêtes de l’interface, pas un transfert Storage, une publication ou une session distante réels.
- Le verrouillage lecture seule est couvert par les tests UI de non-présentation des actions et les tests serveur de refus. Aucune capacité d’écriture non autorisée n’a été démontrée dans cette passe ; cela n’équivaut pas à un audit exhaustif des Rules.
- Les erreurs de Suivi et les reprises ciblées passent les tests ; aucune régression supplémentaire prouvée sur ce point.
- Les modifications génériques refusent une révision périmée dans leurs tests. Le problème de concurrence N-R01 est propre au chemin de sauvegarde des Collections.
- Les médias Secret ne sont pas devenus publics par un simple choix non persisté : les tests de confirmation et d’autorisation explicite passent. Les limites des dérivés PDF/vidéo et le fonctionnement distant des workers ne sont pas validés ici.
- Aucun défaut visuel Chrome/mobile n’est conclu depuis ces tests DOM. Le parcours navigateur indépendant du responsable d’audit reste nécessaire.
