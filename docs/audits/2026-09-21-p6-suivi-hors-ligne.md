# P6 — Tâches hors ligne et exhaustivité des alertes

Date : 2026-09-21

Périmètre : F07 et F08 de `2026-09-18-assessment-code.md`
État : correction locale validée, non déployée

## Causes confirmées

- Le contrôleur des tâches retirait une mutation en attente lorsqu'une valeur identique apparaissait dans un snapshot. Firestore pouvant produire ce snapshot depuis son cache avec des écritures locales non confirmées, cette condition ne prouvait pas l'acquittement serveur.
- Les opérations conservées après fermeture étaient réaffichées, mais aucune reprise durable et systématique n'était déclenchée à l'ouverture ou au retour du réseau.
- Une suppression en erreur était retirée de la file puis annulée dans l'interface, au lieu de rester une intention locale rejouable.
- Le tableau de bord remplaçait les rappels par une liste vide en cas d'erreur. Il pouvait donc afficher « Aucune alerte » alors que la lecture était incomplète ou refusée.
- L'agrégation de plusieurs Cartulaires ne portait aucun état d'exhaustivité par dossier.

## Correction appliquée

### File durable

- Chaque mutation reçoit un `operationId`, le `cartularyId`, le type `upsert` ou `delete`, et sa valeur finale quand elle existe.
- La file `cartularia-todos-operations-v2` est écrite dans le coffre local déjà isolé par identité et Cartulaire avant l'appel Firestore.
- La reprise est déclenchée à l'ouverture et sur l'événement navigateur `online`.
- Les opérations sont envoyées dans l'ordre. Une modification créée pendant un envoi est ajoutée après l'opération en cours.
- Seule la résolution de la promesse d'écriture Firestore retire l'`operationId` exact. Un snapshot ne retire jamais une opération.
- Les suppressions restent dans la file après une coupure ou un refus. Leur rejeu est idempotent.
- Un ancien `cartularia-todos-pending-v1` est converti vers la nouvelle file. La migration des tâches locales devient elle-même durable avant synchronisation.
- Le rejeu d'un upsert lit d'abord le rappel : il crée le document absent ou met à jour le document existant sans réécrire ses champs d'audit de création.

### États des alertes

- Les listeners transmettent désormais `fromCache` et `hasPendingWrites` avec `includeMetadataChanges`.
- L'agrégateur suit chaque Cartulaire avec quatre états : `loading`, `partial`, `ready`, `error`.
- Une erreur sur un Cartulaire conserve les rappels déjà connus des autres Cartulaires et produit un état global `partial`.
- Le tableau de bord conserve les alertes connues et affiche explicitement chargement, résultat partiel ou erreur.
- « Aucune alerte opérationnelle en cours » n'est rendu que lorsque la couverture est `ready`.

## Vérifications exécutées

- `npm run test:follow-up-reliability` : 19 tests UI ciblés et 10 contrats Node réussis.
- `npm run test:ui` : 109 fichiers, 709 tests réussis.
- `npm run lint` : réussi.
- `npm run build` : réussi. Avertissement Vite préexistant sur un chunk supérieur à 500 kB ; aucune erreur de compilation.
- `git diff --check` : réussi.

Les tests ciblés couvrent : écho local non acquittant, édition hors ligne, fermeture/réouverture, retour du réseau, suppression rejouée, refus de permission, édition pendant un envoi, réponse ancienne après ajout d'une opération plus récente, résultat partiel et erreur sur un dossier parmi plusieurs.

## Limites et état externe

- Les scénarios hors ligne sont déterministes avec services Firestore simulés ; aucun parcours navigateur authentifié avec coupure réseau réelle n'a été exécuté dans ce lot.
- Les règles Firestore n'ont pas été modifiées. Le contrat d'autorisation existant reste couvert par les suites émulateur déjà présentes, mais aucune suite émulateur n'a été relancée pour P6.
- Aucun déploiement, push, modification de données de production ou changement de droits n'a été effectué.

## Fichiers du lot

- `src/features/cartulary/state/useCartularyFollowUp.ts`
- `src/features/registry/RegistryOverview.tsx`
- `src/services/followUp.ts`
- `tests/follow-up-coordination.test.mjs`
- `tests/ui/demo-follow-up-isolation.test.tsx`
- `tests/ui/follow-up-shared-controller.test.tsx`
- `tests/ui/watch-website-follow-up.test.tsx`
- `tests/ui/follow-up-coverage-service.test.ts`
- `tests/ui/follow-up-offline-replay.test.tsx`
- `tests/ui/registry-overview-follow-up-state.test.tsx`
- `package.json`
