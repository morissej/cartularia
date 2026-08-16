# Registre — Vague 4

Date : 15 août 2026
Statut : implémenté et vérifié localement

## Objectif

La Vague 4 active le Centre de suivi du Registre. Il réunit les échéances des Cartulaires que le compte courant a le droit de lire, sans créer une seconde copie des rappels.

## Fonctions livrées

- synthèse des échéances en retard, à trente jours, planifiées et terminées ;
- recherche insensible aux accents sur l’action et le Cartulaire ;
- filtres cumulables par horizon, nature et collection ;
- classement déterministe des urgences avant les échéances futures et les éléments terminés ;
- catégories explicites : assurance, preuves visuelles, entretien et action personnalisée ;
- conservation des critères dans l’URL ;
- accès au Cartulaire d’origine avec retour au même Centre de suivi filtré ;
- remontée des retards et échéances proches dans les points d’attention du tableau de bord ;
- états de chargement, erreur, absence de rappel, absence de résultat et droit insuffisant.

## Source de vérité

Les rappels restent dans `cartularies/{cartularyId}/reminders/{reminderId}`. Le Centre de suivi commence par lire les seules projections actives de `registries/{registryId}/items`, puis charge les rappels de ces Cartulaires autorisés.

Cette lecture bornée évite :

- une collection transverse contenant une copie des rappels ;
- une requête qui traverserait des Registres hors de la portée du membership ;
- une modification directe d’un objet dont le Cartulaire reste l’autorité.

Le Registre ne lit que le titre, la date, la catégorie et le statut du rappel, complétés par les métadonnées minimales de la projection Catalogue. Il ne charge ni preuve, ni archive, ni média, ni document source.

## Écriture

Le prototype conserve la règle adoptée pour le Cartulaire : aucune écriture directe du navigateur dans les sous-collections autoritaires. Le Centre de suivi renvoie donc vers le Cartulaire pour gérer le rappel. Une future commande transactionnelle pourra traiter création, report et clôture avec idempotence, révision et événement d’audit, sans changer le contrat de lecture R4.

## Validation

```bash
npm run test:registry-wave4
npm run test:registry-wave3
npm run test:rules
npm run lint
npm run build
```

La suite R4 contrôle les horizons temporels, les deux formats de date hérités, les agrégats, la recherche, les filtres, le tri et l’absence de mutation. Les règles Firebase vérifient qu’un propriétaire autorisé lit les rappels et qu’un autre tenant ou un payeur sans droit patrimonial ne les lit pas.
