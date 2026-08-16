# Registre — Vague 7

Date : 16 août 2026
Statut : implémenté localement

## Objectif

La Vague 7 active la comparaison transverse de deux à quatre Cartulaires. Elle rapproche uniquement les champs du noyau commun déjà présents dans les projections privées du Registre, sans ouvrir les dossiers maîtres et sans créer de nouvelle copie de données.

## Fonctions livrées

- nouvelle route privée `/registry/{registryId}/compare` et entrée `Comparer` dans la navigation ;
- sélection de deux à quatre Cartulaires directement dans le catalogue ;
- conservation de la sélection et du retour au catalogue dans l’URL ;
- déduplication et limite stricte à quatre identifiants ;
- revalidation de toute sélection URL contre les projections réellement lisibles ;
- retrait automatique des références absentes, retirées ou non autorisées ;
- ajout et retrait de Cartulaires depuis la page de comparaison ;
- matrice responsive et navigable au clavier, avec première colonne fixe ;
- signalement visuel des critères différents ;
- ouverture de chaque Cartulaire avec retour vers la comparaison ;
- compatibilité multi-actifs par utilisation du noyau commun.

## Liste blanche comparative

La matrice peut afficher uniquement :

- type d’actif ;
- collection ;
- maison ou fabricant ;
- modèle ;
- référence ;
- année ;
- situation de possession ;
- statut du dossier ;
- palier de complétude ;
- révision projetée ;
- date d’actualisation de la projection.

Elle exclut les identifiants d’organisation, les empreintes techniques, les références d’actifs média, les valeurs, les propriétaires, les lieux, les preuves, les documents, les archives, les originaux et tout champ absent de la projection Registre.

## Autorisation

La comparaison n’introduit aucune nouvelle collection Firestore ni aucune permission supplémentaire. Elle réutilise `registries/{registryId}/items`, déjà borné par :

- un membership actif ;
- `registry.read` ;
- le Registre dans la portée du membership.

Les identifiants présents dans l’URL ne valent jamais autorisation. La matrice est reconstruite uniquement à partir des documents effectivement retournés par les règles Firestore.

## État et persistance

La sélection est un état de navigation non patrimonial. Elle reste dans l’URL afin de permettre le retour depuis un Cartulaire et le partage d’une vue entre deux sessions du même compte. Aucun favori, vue enregistrée ou historique de comparaison n’est persisté dans Firestore ou dans le navigateur.

## Validation

```bash
npm run test:registry-wave7
npm run test:wave7
npm run lint
npm run build
```

La suite R7 contrôle la déduplication, la limite, l’ajout et le retrait, l’ordre demandé, l’exclusion des projections retirées, la liste blanche, l’absence de mutation et la sûreté des URL de retour.
