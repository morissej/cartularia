# Registre — Vague 2

Date : 15 août 2026
Statut : implémenté et vérifié localement

## Objectif

La Vague 2 transforme la destination Catalogue du Registre en inventaire privé multi-actifs. Elle permet de retrouver et d’ouvrir les Cartulaires autorisés sans charger leur dossier maître dans la vue transverse.

## Source de données

Le catalogue lit exclusivement `registries/{registryId}/items/{cartularyId}`. Chaque carte est une projection minimale produite par une commande Admin et contient notamment :

- l’identifiant et le titre d’affichage du Cartulaire ;
- le type d’actif et la collection ;
- la marque, le modèle, la référence et l’année ;
- les statuts de cycle de vie, de possession et de complétude ;
- la révision source et l’empreinte de la projection.

Le catalogue ne lit ni les sections détaillées, ni les médias, ni les preuves, ni les archives du Cartulaire.

## Fonctions livrées

- chargement et actualisation du catalogue autorisé ;
- recherche multi-termes sur les métadonnées de la projection, insensible aux accents ;
- filtres cumulables par type d’actif, collection et statut ;
- tris par mise à jour, titre ou année ;
- vues grille et liste ;
- compteur de résultats et états chargement, erreur, Registre vide et recherche sans résultat ;
- persistance des critères dans l’URL ;
- ouverture du lecteur privé du Cartulaire avec retour au même catalogue filtré.

## Frontière de sécurité

Le client continue de dépendre des règles Firestore et du membership actif pour lire le Registre. Une projection ne contient aucun original et aucun lien Storage. L’ouverture du Cartulaire déclenche une lecture privée distincte, elle-même contrôlée par la portée `cartulary.read`.

## Validation

```bash
npm run test:registry-wave2
npm run test:cartulary
npm run lint
npm run build
```

`test:registry-wave2` vérifie la recherche, la combinaison des filtres, les tris, l’absence de mutation et la sûreté du chemin de retour. `test:cartulary` vérifie notamment la projection privée, l’isolation du tenant et la requête indexée type + collection.
