# Runbook — Sauvegarde et restauration

## Objectif de service

- RPO provisoire : 24 heures.
- RTO provisoire : 4 heures.
- Classification : Secret.
- Autorité : opérateur de service distinct du client web.

## Sauvegarde

1. Confirmer la cible Firebase et la fenêtre d’exécution.
2. Bloquer toute sortie vers un support non chiffré.
3. Exécuter l’export Firestore géré et la copie versionnée du bucket Storage dans la région confirmée.
4. Produire le manifeste `cartularia-backup-1` et vérifier toutes les empreintes.
5. Conserver le journal d’exécution sans identité, numéro de série, valeur ou adresse.
6. Enregistrer la date, le projet, le nombre de documents, le nombre d’objets et l’empreinte du manifeste.

Le module de vague 7 est une preuve locale du codec et de la restauration. En production, l’export managé Firestore et le versioning/lifecycle du bucket restent la première couche de reprise.

## Restauration

1. Restaurer d’abord vers un projet isolé, jamais directement sur la source.
2. Vérifier le manifeste avant toute écriture.
3. Restaurer les documents par lots bornés et les objets avec leurs métadonnées.
4. Recalculer les empreintes document et fichier.
5. Vérifier organisations, Registres, memberships, projections et chaînes d’audit.
6. Exécuter les tests T-03, T-07, T-10, T-15, T-19 et T-20.
7. Autoriser une bascule seulement après revue du rapport de validation.

## Échec

En cas d’empreinte incohérente, arrêter la restauration, préserver la cible isolée pour analyse et ne jamais recalculer le manifeste pour masquer l’écart.
