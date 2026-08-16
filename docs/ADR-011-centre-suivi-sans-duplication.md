# ADR-011 — Centre de suivi sans duplication des rappels

Date : 15 août 2026
Statut : adopté et implémenté localement

## Décision

Le Centre de suivi du Registre agrège à la lecture les rappels Secrets des Cartulaires présents dans son Catalogue. Aucun rappel, compteur d’échéance ou décision d’accès n’est persisté sous le Registre.

Le chargement suit deux étapes :

1. lire `registries/{registryId}/items` selon le membership actif ;
2. lire `cartularies/{cartularyId}/reminders` uniquement pour les projections actives retournées à l’étape 1.

## Autorité

Le Cartulaire reste l’autorité du rappel, de son statut et de ses éventuelles preuves. Le Registre calcule seulement un horizon d’affichage — en retard, dans les trente jours, planifié ou terminé — à partir de la date et du statut qu’il vient de lire.

Ce classement n’est ni une preuve, ni un nouveau statut métier, ni une donnée durable. Le jour de référence est injectable dans les tests afin que le calcul reste déterministe.

## Sécurité

La lecture d’un rappel exige `cartulary.read`, un membership actif et le Registre du Cartulaire dans la portée du compte. Le simple droit `registry.read`, le rôle de payeur ou l’accès à un autre tenant ne suffisent pas.

Le navigateur ne modifie aucun rappel. Création, report et clôture devront passer par une commande transactionnelle du Cartulaire avec contrôle de révision, idempotence et journal d’audit.

## Évolutivité

Le chargement par Cartulaire convient au pilote. Lorsque le volume imposera une pagination serveur, une projection minimale dédiée pourra être produite par le Cartulaire. Elle devra rester versionnée, révocable et strictement bornée au membership ; elle ne pourra contenir aucun document ou média probant.
