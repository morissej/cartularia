# ADR-002 — Cartulaire privé IWC de la vague 2

Date : 14 août 2026
Statut : adopté pour la construction locale ; import distant non autorisé par cet ADR

## Décision

Le premier Cartulaire montre est créé à la racine `cartularies/{cartularyId}` avec une enveloppe commune limitée aux champs de classement, d’autorisation, de cycle de vie et de concurrence. Les données sensibles, répétables ou croissantes résident dans des sous-collections.

La migration du prototype IWC suit les règles suivantes :

- l’enveloppe ne contient ni numéro de série, ni prix d’acquisition, ni adresse, ni tableau de médias ;
- toutes les sections, observations, valeurs, relations et métadonnées de médias restent `secret` ;
- les affirmations importées sont déclassées en `unverified` et attendent une revue humaine ;
- les hashes et URL fictifs du prototype ne sont pas importés comme preuves ; les 22 médias portent l’état `pending_binary_reingest` ;
- le SpinSet reste non publiable tant que les binaires et son manifeste n’ont pas été recalculés ;
- la création est une commande Admin transactionnelle, avec `requestId`, révision attendue, reçu d’idempotence et événement canonique chaîné ;
- le navigateur conserve un accès en lecture selon membership, mais aucune écriture directe.

## Collections créées

- `cartularies/{id}`
- `sections`, `sources`, `assets`, `spinSets`, `observations`, `valuations`, `comparables`
- `reports`, `reminders`, `ownerRelations`, `events`, `auditEvents`, `commandReceipts`

## Limites assumées

- L’identifiant de série n’existe pas dans les 78 champs `watch@1.3.0`. Il est conservé comme extension legacy secrète et explicitement non mappée, sans modifier silencieusement la baseline.
- Aucun fichier n’est téléversé dans Storage pendant cette vague.
- Aucune projection Registre, W/R ou publique n’est produite ; elle appartient à la vague 3.
- Les événements initiaux `sorted-json-1` restent lisibles ; la vague 6 les vérifie et applique `jcs-1` à toute nouvelle commande.

## Preuves attendues

- Le bundle IWC ne fuit aucun champ interdit dans l’enveloppe.
- L’import crée une seule révision et un seul événement pour un même `requestId`.
- Un second `requestId` ne peut pas écraser un Cartulaire existant.
- Seul le propriétaire autorisé lit le Cartulaire et ses sections.
- Les 22 médias restent Secrets, sans URL ni empreinte fictive.
