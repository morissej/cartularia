# ADR-001 — Fondations Firebase de la vague 1

Date : 14 août 2026
Statut : adopté pour la construction locale ; déploiement distant non autorisé par cet ADR

## Décision

La vague 1 utilise le projet Firebase existant et une base Cloud Firestore unique. Les quatre domaines restent séparés dans le modèle et les règles : identité/comptes, Cartulaires maîtres privés, projections et communauté.

Le premier socle implémente :

- Firebase Authentication pour l’identité de session ;
- `users`, `organizations`, `organizations/{organizationId}/memberships` et `registries` ;
- un profil `watch@1.3.0` dérivé des 78 identifiants stables du catalogue IA ;
- des règles Firestore deny-by-default, sans écriture métier directe depuis le client ;
- des règles Storage entièrement fermées jusqu’au pipeline média de la vague 2 ;
- un bootstrap local idempotent et une suite de tests d’émulateur.

## Contrats retenus

- Les Custom Claims sont réservées aux rôles globaux rares. Les droits d’organisation et de Registre résident dans les memberships Firestore.
- Un membership porte explicitement `uid`, `organizationId`, `roles`, `status`, `scopes.registryIds` et `permissions`.
- Le client découvre uniquement ses propres memberships, puis ouvre les Registres dont les identifiants sont présents dans sa portée.
- Tous les contenus sont `secret` par défaut. Un champ `secret` du schéma `watch` ne possède aucune cible de publication.
- Les documents de fondation, le catalogue de schéma et les futures données patrimoniales sont écrits par un contexte Admin ou une commande serveur, jamais directement par le navigateur.

## Décisions encore ouvertes

- La région Firestore/Storage et la politique de reprise doivent être confirmées avant toute donnée réelle.
- La matrice juridique de conservation et l’éventuel chiffrement applicatif de champs très sensibles restent hors de cette vague.
- Le déploiement distant des règles, index et données de bootstrap doit être déclenché séparément après validation des tests et de la cible Firebase.

## Preuves attendues

- `npm run test:schema` confirme 78 postes uniques et l’absence de projection d’un champ Secret.
- `npm run test:rules` confirme l’accès du propriétaire, l’isolation inter-tenant, l’absence de droit patrimonial du payeur, l’interdiction d’écriture directe et le refus des requêtes non bornées.
- `npm run test:storage` confirme qu’aucun utilisateur, même authentifié, ne peut lire ou écrire un objet pendant cette vague.
- `npm run build` et `npm run lint` restent au vert.
