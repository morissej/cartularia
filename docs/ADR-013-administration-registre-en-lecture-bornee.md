# ADR-013 — Administration du Registre en lecture bornée

Date : 15 août 2026
Statut : adopté et implémenté localement

## Décision

L’Administration R5 est une vue privée de gouvernance, pas une console d’exploitation. Elle lit les métadonnées de l’organisation, du Registre et des memberships selon les droits déjà présents dans les fondations Firebase.

Un membership peut toujours lire son propre document. La liste `organizations/{organizationId}/memberships` exige la permission `membership.read`. Aucun accès à `users/{uid}` d’un autre membre n’est ajouté pour enrichir l’affichage.

## Séparation des rôles

Les qualités de titulaire du compte, propriétaire légal, gestionnaire, payeur, prescripteur, bénéficiaire et assistance déléguée restent distinctes. L’écran signale trois situations à contrôler :

- un payeur qui porte aussi une permission patrimoniale ;
- un membership actif sans Registre explicite dans sa portée ;
- une assistance déléguée active qui doit être temporaire, motivée et auditée.

Ces signaux n’altèrent aucun droit et ne constituent pas une décision automatique. Ils rendent seulement visible la configuration déjà autoritaire.

## Continuité et données commerciales

R5 rappelle la politique de continuité : un défaut de paiement peut dégrader l’accès mais ne supprime ni preuves, ni versions, ni audit ; l’export du propriétaire et la révocation des accès partagés demeurent possibles.

Tant qu’aucune projection d’abonnement versionnée n’existe, la page n’invente aucun plan, quota, montant, échéance de paiement ou identité de payeur. La permission `billing.read` indique seulement que le compte pourrait lire une telle projection lorsqu’elle sera disponible.

## Écriture

Le navigateur ne peut créer, modifier ou révoquer un membership. Une évolution future devra utiliser une commande serveur transactionnelle avec contrôle de rôle, portée, idempotence, justification, expiration éventuelle et événement d’audit.
