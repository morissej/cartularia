# ADR-008 — Registre comme surface authentifiée distincte

Date : 15 août 2026
Statut : adopté et implémenté localement

## Décision

Le Registre dispose d'une surface dédiée sous `/registry`. Il n'est ni un portefeuille financier, ni un Cartulaire agrégé. Il permet à un compte authentifié de choisir un contexte autorisé et de piloter les Cartulaires qui lui sont rattachés.

La route racine découvre les Registres exclusivement à partir des memberships actifs du compte. Un contexte unique est ouvert automatiquement ; plusieurs contextes sont présentés dans un sélecteur. Le Registre actif est toujours encodé dans l'URL afin de rendre le contexte explicite et partageable sans affaiblir le contrôle d'accès.

## Registre personnel et Registre d'organisation

Il n'existe pas deux produits distincts. Le même modèle de Registre s'applique dans les deux cas :

- un Registre dit personnel est administré par une organisation de compte représentant une personne ou un foyer ;
- un Registre d'organisation est administré par une entité ayant plusieurs membres, rôles ou périmètres.

La différence relève donc du contexte d'administration et des memberships, pas de l'architecture de données ni de l'interface principale.

## Frontière avec le Cartulaire

Le Cartulaire demeure l'autorité pour les données détaillées, les originaux média, les preuves et les archives. Le Registre ne stocke et n'affiche que des métadonnées transverses et des projections privées explicitement prévues à cet effet.

Cette frontière évite :

- la duplication d'actifs sensibles ;
- des règles de visibilité concurrentes ;
- la confusion entre index de collection et dossier patrimonial probant.

## Contrôle d'accès

Le client ne charge que les memberships actifs dont le champ `uid` correspond à la session Firebase. Il ne peut pas énumérer les Registres d'autres tenants. Une URL introuvable et une URL non autorisée renvoient le même état générique.

Les écritures autoritaires restent interdites au client pendant cette vague. Les futures actions d'administration devront passer par les commandes contrôlées prévues par les fondations Firebase.

## Conséquences

La Vague 1 livre la connexion, la sélection de contexte, la vue d'ensemble et le shell responsive. Les sections Catalogue, Suivi et Administration sont visibles comme destinations préparées, mais leur contenu transactionnel reste volontairement différé.

Le code du Registre est chargé à la demande afin de ne pas alourdir l'ouverture du Cartulaire existant. Le paquet Firebase partagé reste le principal chunk du build et pourra être découpé davantage lors d'une optimisation transverse.
