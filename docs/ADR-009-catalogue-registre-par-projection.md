# ADR-009 — Catalogue du Registre alimenté par projection privée

Date : 15 août 2026
Statut : adopté et implémenté localement

## Décision

Le catalogue du Registre lit la sous-collection privée `registries/{registryId}/items`. Il ne requête pas directement tous les Cartulaires du tenant et ne reconstitue pas une visibilité à partir du dossier maître.

Chaque item est une projection minimale, versionnée par `sourceRevision`, générée par la commande autoritaire `projectRegistryItem`. Le Registre peut ainsi rechercher, filtrer et trier son inventaire sans dupliquer les données probantes du Cartulaire.

## Modèle multi-actifs

Le même composant traite toutes les verticales grâce à `assetType`, `collectionId` et aux champs communs du noyau. Les libellés connus améliorent la présentation des premières verticales, tandis qu’un libellé générique garde le catalogue compatible avec un nouveau type d’actif.

La Vague 2 n’ajoute aucune collection Firestore propre aux montres, voitures ou autres verticales.

## Recherche et filtres

Le volume pilote est chargé par une requête ordonnée sur `updatedAt`, déjà couverte par les règles et index existants. La recherche et les facettes sont appliquées en mémoire sur les seules projections que Firestore a autorisées.

Cette décision convient au premier volume produit. Une recherche serveur paginée ou un index spécialisé devra remplacer ce mécanisme lorsque le nombre d’items d’un Registre justifiera une limite de page explicite.

## Ouverture du Cartulaire

Le catalogue transmet uniquement `cartularyId` au lecteur privé. Le chemin de retour est limité à une URL interne commençant par `/registry/`, afin de conserver les critères du catalogue sans introduire de redirection externe.

Le lecteur charge ensuite séparément le Cartulaire et son schéma sous la permission `cartulary.read`. Cette navigation n’élargit donc pas les droits obtenus au niveau du Registre.
