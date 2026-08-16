# Registre — Vague 3

Date : 15 août 2026
Statut : implémenté et vérifié localement

## Objectif

La Vague 3 transforme la vue d’ensemble du Registre en tableau de bord transverse. Les indicateurs sont calculés à la lecture sur les seules projections privées déjà autorisées au compte connecté.

## Indicateurs livrés

- nombre de Cartulaires projetés ;
- nombre de collections et de types d’actifs ;
- nombre de dossiers ou imports à revoir ;
- composition du Registre par type d’actif ;
- répartition par collection ;
- états du cycle de vie ;
- paliers explicites de complétude documentaire ;
- points d’attention issus des statuts et situations de possession ;
- quatre projections récemment mises à jour.

Chaque élément permet de rejoindre le Catalogue. Les critères transmis dans l’URL restent limités à des métadonnées de projection.

## Frontière du tableau de bord

Le tableau de bord ne charge pas les sections des Cartulaires. Il n’agrège donc :

- aucune preuve ni archive ;
- aucun original ou dérivé média ;
- aucune identité de propriétaire ;
- aucune valeur déclarée, estimée ou historique.

Une valeur patrimoniale ne pourra apparaître que lorsqu’un Cartulaire produira une projection privée dédiée, explicitement autorisée et versionnée. Le Registre ne recalculera jamais lui-même cette autorisation.

Les rappels et échéances appartiennent au Centre de suivi livré en Vague 4. La Vague 3 affiche seulement les signaux déjà présents dans la projection du Catalogue ; R4 complète désormais ses points d’attention avec les échéances autorisées.

## Validation

```bash
npm run test:registry-wave3
npm run test:registry-wave2
npm run test:cartulary
npm run test:import
npm run lint
npm run build
```

La suite R3 vérifie les agrégats multi-actifs, le filtrage des projections actives, le dédoublonnage du KPI de revue, l’ordre des mises à jour et l’absence de mutation des données sources.
