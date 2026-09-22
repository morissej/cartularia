# P7 — Lectures bornées et protection de la vue Preuves

Date : 2026-09-21

Périmètre : F09 et F10 de `2026-09-18-assessment-code.md`
État : correction locale validée, non déployée

## Causes confirmées

- Chaque snapshot des items du Registre relançait la lecture des racines, des projections d’intégrité et de tous les événements de tous les Cartulaires actifs.
- La garde de génération protégeait les succès, mais le `catch` pouvait encore publier l’erreur d’une ancienne génération après un succès plus récent.
- Aucun travail en vol n’était invalidé explicitement lors du désabonnement.
- Les deux passes du backlog Storage demandaient chacune l’inventaire intégral de `private-drafts/`, puis lisaient les manifestes jusqu’à trouver dix opérations utiles. La limite de traitement ne bornait donc ni l’inventaire ni les lectures.

## Correction appliquée

### Vue Preuves

- Un listener ciblé suit la racine et un second la projection d’intégrité de chaque Cartulaire actif.
- La vérification cryptographique est réutilisée uniquement si le triplet `(cartularyId, integrityHead, integritySequence)` est inchangé.
- Un changement de présentation de l’item ou d’état d’ancrage met à jour la vue sans relire ni rehacher le journal.
- Un changement de tête ou de séquence relit et vérifie uniquement le journal concerné.
- Les lectures et vérifications complètes sont limitées à quatre Cartulaires simultanés, y compris dans le chargement complet.
- Succès et erreurs sont associés à la génération exacte du Cartulaire. Une réponse périmée est ignorée.
- Le désabonnement invalide les générations en vol, retire les listeners et annule les travaux encore en attente dans la file.
- Le bouton « Vérification complète » recrée volontairement l’observation et recalcule tous les journaux.

### Backlog des originaux

- Chaque passe Storage utilise `autoPaginate: false`, `maxResults` et `startOffset`.
- Le budget par défaut est de 50 chemins examinés par passe ; la limite de traitement utile reste de 10.
- Deux curseurs indépendants, `verificationCursor` et `variantCursor`, sont conservés dans le document Admin `systemJobs/privateUploadBacklog`.
- Le curseur mémorise le dernier chemin réellement examiné et reprend après celui-ci au passage suivant.
- Après la fin de l’inventaire, le curseur revient au début afin que les nouveaux fichiers placés avant l’ancien curseur soient finalement examinés.
- Les contrôles cryptographiques des originaux et les règles d’attestation existantes ne sont pas réduits.

## Mesures déterministes

- Modification isolée parmi 100 Cartulaires : 1 nouvelle lecture de journal et 1 nouvelle vérification de chaîne, au lieu de 100.
- Concurrence maximale observée dans le test : 4 vérifications, égale à la borne configurée.
- Historique de 250 originaux, taille de lot 10, budget de lecture 20 : 2 pages Storage et 40 lectures de manifeste au total, soit 20 par passe ; le passage suivant commence sur les chemins 21 à 40.
- Une erreur de l’ancienne génération après le succès de la nouvelle ne produit aucun callback d’erreur.

Ces nombres proviennent de doubles déterministes instrumentés. Ils démontrent les bornes logiques, pas une latence ni une facturation Firebase en production.

## Vérifications exécutées

- `npm run test:p7-integrity-cost` : 28 tests réussis.
- `npm run test:ui` : 110 fichiers, 712 tests réussis.
- `npm run test:private-binary-trust:unit` : 131 tests réussis.
- `npm run lint` : réussi.
- `npm run build` : réussi. Avertissement Vite préexistant sur un chunk supérieur à 500 kB ; aucune erreur.
- `git diff --check` : réussi.

## Limites et état externe

- Les courses, compteurs et pages sont testés avec des doubles Firestore/Storage ; aucun parcours navigateur authentifié, émulateur ou environnement Firebase distant n’a été exécuté pour P7.
- L’observation incrémentale maintient deux listeners documentaires par Cartulaire actif, plus le listener des items. Ce choix remplace les relectures globales par des mises à jour ciblées ; son coût réel doit encore être mesuré sur un Registre authentifié.
- Le document de curseur n’a pas été créé en production. Il sera créé par l’Admin SDK au premier passage seulement après un déploiement autorisé.
- Aucun déploiement, push, modification de données de production ou changement de droits n’a été effectué.

## Fichiers du lot P7

- `src/services/registryIntegrity.ts`
- `src/features/registry/RegistryIntegrity.tsx`
- `scripts/lib/private-upload-command.mjs`
- `tests/ui/registry-integrity-observer.test.ts`
- `tests/private-upload-backlog-pagination.test.mjs`
- `tests/private-upload-command.test.mjs`
- `tests/presentation-variants.test.mjs`
- `tests/integrity-convergence.test.mjs`
- `package.json`
