# ADR-031 — Remontée de schéma des Cartulaires existants

- Statut : accepté
- Date : 2026-09-08
- Précise : ADR-005 (versionnement immuable), ADR-024 (convergence de preuve), ADR-030

## Contexte

Chaque Cartulaire épingle la version de schéma de sa création dans son enveloppe et dans chacune de
ses sections. Quand le catalogue publie une nouvelle version active, les nouveaux Cartulaires
partent de cette base (ADR-030) mais les Cartulaires existants restent sur l’ancienne : un champ
ajouté n’y apparaît jamais. Aucune commande ne permettait de les aligner. Le pilote IWC est ainsi
resté en `watch@1.3.0` alors que la création est en `1.6.0`.

## Décision

1. **Une commande serveur `upgradeCartularySchema`** (`scripts/lib/schema-upgrade-command.mjs`)
   remonte un Cartulaire vers la version cible : version active du catalogue, à défaut dernière
   publiée, ou version explicitement demandée. Elle refuse une rétrogradation et un changement de
   verticale.
2. **Aucune valeur n’est perdue.** Un champ que la cible ne connaît plus, ou qu’elle rattache à une
   autre section, est déplacé en extensions de sa section. Une section que la cible ne connaît
   plus devient `imported_unmapped` et porte `retiredFromSchema` ; une section hors schéma depuis
   l’origine (identité confidentielle) reste telle quelle, sans marque.
3. **La remontée est un acte d’audit.** Elle incrémente la révision, pose `previousSchemaVersion`,
   `schemaUpgradedAt` et la nouvelle empreinte de catalogue, et ajoute l’événement
   `cartulary.schema.upgraded` à la chaîne d’intégrité du Cartulaire, vérifiable par
   `verifyAuditChain`. Un second passage est sans effet.
4. **Les lecteurs n’affichent plus les sections retirées.** Les sections marquées
   `retiredFromSchema` (données personnelles déplacées vers le Coffre par l’ADR-025) ne sont plus
   rendues par le composant générique ; leurs valeurs restent dans le document.
5. **Un script opérateur** `npm run schema:upgrade -- --cartulary <id>` ou `--all --schema watch`,
   avec `--dry-run` et le garde-fou habituel `--allow-remote`.

## Conséquences

- La remontée n’est pas automatique : c’est une décision d’exploitation, par Cartulaire ou par
  verticale, tracée dans l’audit. La règle « la base change pour tous » se réalise en deux temps :
  publication de la version, puis remontée.
- Les projections publiques et rapports déjà émis conservent la version de schéma qu’ils citent.
- La commande a été vérifiée sans émulateur, sur un Firestore en mémoire
  (`tests/helpers/memory-firestore.mjs`) qui rejoue l’import IWC réel puis la remontée. Une
  vérification avec émulateur reste souhaitable avant tout usage en production.

## Contrôle

`npm run test:schema-upgrade` : plan IWC 1.3.0 → 1.6.0 sans perte de valeur, refus de
rétrogradation, remontée complète avec chaîne d’audit valide, idempotence, simulation sans écriture.
