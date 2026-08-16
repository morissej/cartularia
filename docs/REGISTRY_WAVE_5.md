# Registre — Vague 5

Date : 15 août 2026
Statut : implémenté et vérifié localement

## Objectif

La Vague 5 active l’Administration du Registre. Elle rend lisibles l’organisation, les memberships, les qualités, les permissions et les portées effectivement autorisés au compte courant, sans ouvrir le contenu des Cartulaires et sans introduire de mode superutilisateur.

## Fonctions livrées

- synthèse de l’organisation, des membres actifs, des Registres accessibles et des points de gouvernance ;
- fiche du Registre courant : statut, confidentialité, compteur projeté et version de modèle ;
- navigation entre les Registres de la même organisation présents dans la portée du compte ;
- détail des qualités et permissions effectives du compte courant ;
- liste des memberships réservée au droit `membership.read` ;
- recherche et filtres cumulables par statut et qualité, conservés dans l’URL ;
- identifiants des autres membres masqués dans l’interface ;
- contrôle des payeurs portant aussi un droit patrimonial, des memberships actifs sans portée et des mandats d’assistance déléguée ;
- rappel des principes de continuité du coffre ;
- absence explicite de plan, quota ou montant lorsque aucune projection commerciale versionnée n’existe.

## Frontière d’administration

La page lit `organizations/{organizationId}/memberships` uniquement lorsque le membership courant porte `membership.read`. Sans ce droit, elle ne montre que le membership déjà chargé pour la session.

Elle ne lit :

- aucun document utilisateur d’un autre membre ;
- aucun contenu, média, original, archive, valeur ou preuve d’un Cartulaire ;
- aucun abonnement, quota ou montant non projeté par une source commerciale autoritaire.

Les invitations, changements de rôle, révocations et mandats d’assistance ne sont pas des écritures directes du navigateur. Ils devront être exécutés par des commandes transactionnelles, motivées et auditées.

## Validation

```bash
npm run test:registry-wave5
npm run test:registry-wave4
npm run test:rules
npm run lint
npm run build
```

La suite R5 contrôle les statuts, les qualités, les cumuls sensibles, la recherche, les filtres, le masquage des identifiants et l’absence de mutation. Les règles Firebase vérifient que seule une personne portant `membership.read` peut lister les membres de son organisation, tandis qu’un payeur conserve la lecture de son propre membership sans voir la liste.
