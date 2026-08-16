# ADR-014 — Centre des accès par projection minimale

Date : 15 août 2026
Statut : adopté et implémenté localement

## Décision

Le Centre des accès du Registre lit une projection privée minimale sous `registries/{registryId}/accesses`. Cette surface sert au pilotage transverse des invitations et des consultations. Elle n’est ni une copie du contenu partagé, ni le moteur qui décide si une personne peut ouvrir un élément du Cartulaire.

Le Cartulaire source reste l’autorité pour la portée du contenu, la validité effective, l’utilisation du jeton, la révocation et l’audit détaillé. Le Registre peut dériver l’état `expired` d’une date déjà atteinte pour l’affichage, mais cette dérivation ne crée, ne prolonge et ne révoque aucun droit.

## Pourquoi une projection au niveau du Registre

Le Registre doit réunir les accès de plusieurs Cartulaires dans une seule vue. Une projection minimale évite une lecture en éventail de sous-collections hétérogènes et permet d’appliquer une permission distincte de la lecture du contenu patrimonial.

Cette duplication contrôlée porte uniquement sur des métadonnées de pilotage. Elle exclut explicitement les actifs média, les preuves, les archives, les documents, les rapports, les exports, les secrets d’accès et la liste détaillée des contenus autorisés.

## Confidentialité

Le contrat transporte une référence de destinataire déjà masquée. L’interface applique en plus un masquage défensif aux adresses électroniques ou identifiants techniques qui auraient été projetés par erreur. Les consultations sont réduites à un compteur et une dernière date ; le journal complet reste dans le domaine d’audit du Cartulaire.

## Autorisation

La lecture exige `registry.read`, la portée explicite du Registre et `access.read`. `access.read` est considéré comme un droit patrimonial dans les contrôles de gouvernance R5. Un payeur ne l’obtient jamais du seul fait qu’il paie.

Toutes les écritures navigateur sont refusées. Une future commande de création ou de révocation devra contrôler le rôle, la portée, l’état source, l’expiration, l’idempotence et la justification, puis journaliser l’opération avant d’actualiser la projection.
