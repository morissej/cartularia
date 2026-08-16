# Registre — Vague 6

Date : 15 août 2026
Statut : implémenté et vérifié localement

## Objectif

La Vague 6 active le Centre des accès du Registre. Il réunit les invitations actives, en attente, expirées et révoquées ainsi que leurs compteurs de consultation, sans reprendre le contenu partagé par les Cartulaires.

## Fonctions livrées

- nouvelle route privée `/registry/{registryId}/access` et entrée `Accès` dans la navigation du Registre ;
- synthèse des accès actifs, en attente, expirés et révoqués ;
- statut effectif tenant compte d’une échéance déjà atteinte, sans modifier le statut source ;
- recherche et filtres cumulables par statut, nature et consultation, conservés dans l’URL ;
- affichage des invitations nominatives, mandats temporaires et liens contrôlés ;
- références de destinataire masquées par la projection et à nouveau protégées à l’affichage ;
- compteurs et dernière date de consultation, sans journal détaillé ni contenu consulté ;
- retour vers le Cartulaire source pour toute gestion effective ;
- état vide honnête lorsqu’aucune projection autoritaire n’existe.

## Contrat de projection

Les métadonnées minimales sont stockées sous `registries/{registryId}/accesses/{accessId}`. Une projection contient l’identifiant du Cartulaire source, un libellé de dossier, une référence de destinataire déjà masquée, la nature de l’accès, son statut source, ses dates, ses compteurs, sa révision source et son empreinte.

Elle ne contient :

- aucun média, original, preuve, archive, rapport ou export ;
- aucune liste de champs ou de blocs autorisés ;
- aucune adresse électronique en clair requise par l’interface ;
- aucun secret permettant d’utiliser l’invitation ou le lien ;
- aucune copie du journal de consultation du Cartulaire.

## Autorisation et écriture

La lecture exige simultanément :

- un membership actif ;
- `registry.read` ;
- le Registre dans la portée du membership ;
- la permission dédiée `access.read`.

Le navigateur ne peut créer, modifier ni révoquer une projection. La révocation effective appartient à une commande transactionnelle du Cartulaire ; elle doit ensuite produire une projection mise à jour et un événement d’audit.

## Validation

```bash
npm run test:registry-wave6
npm run test:rules
npm run lint
npm run build
```

La suite R6 contrôle les statuts, l’expiration temporelle, la synthèse, les consultations, les filtres, le tri, le masquage et l’absence de mutation. Les règles Firebase contrôlent la permission dédiée, la portée du Registre, l’isolation inter-organisation et l’interdiction d’écriture directe.
