# Vague corrective 3 — acte de publication W/R/C

Date : 16 août 2026

## Objectif

La sélection d'un bloc W, R ou C n'est plus une bascule silencieuse. Elle devient une décision humaine explicite, liée à l'empreinte du contenu source et enregistrée dans le journal d'intégrité local.

## Règles appliquées

- Une activation ou revalidation exige une marque, un modèle et une photo principale archivée.
- La photo doit être visible par `Tous` pour W, par `Communauté` ou `Tous` pour C ; R accepte la photo privée.
- W respecte la même liste blanche de blocs que `projection-command.mjs`.
- C refuse les blocs propriétaire, transmission, stockage, coût d'acquisition et performance de détention.
- R reste une projection privée, mais exige les mêmes informations minimales et la même confirmation humaine.
- Une modification du contenu source incrémente une révision de source persistée et invalide automatiquement la décision précédente : le bloc reste sélectionné mais repasse en état « à valider ». Restaurer ensuite les mêmes valeurs ne ressuscite pas l'ancienne autorisation.
- Les paramètres historiques `?blocks=` sont intersectés avec les blocs W effectivement validés. Une URL forgée ne peut plus rendre un bloc privé ou non approuvé.

## Migration

Les tableaux existants `cartularia-published-blocks`, `cartularia-report-blocks` et `cartularia-community-blocks` sont conservés. Faute de preuve d'une confirmation antérieure, leurs blocs sont marqués « sélection historique à valider » et ne sont plus émis dans l'aperçu W ou le rapport R avant validation.

Les nouvelles décisions sont persistées sous `cartularia-publication-decisions-v1`, la liaison révision/empreinte sous `cartularia-publication-source-v1`, et l'ensemble est inclus dans l'instantané d'intégrité. Aucun contenu privé n'est recopié dans la décision : seuls la destination, le bloc, le résultat des prérequis, la révision et l'empreinte source sont conservés.

## Limite volontaire

Cette vague sécurise l'interface locale et prépare les commandes autoritaires. Elle ne déclenche aucune écriture Firebase et ne transforme pas une sélection C en publication communautaire distante. W reste un aperçu local avec `?blocks=` ; la publication autoritaire demeure `?publicCode=` et les commandes Admin transactionnelles.

## Recette

```bash
npm run test:corrective-wave3
npm run lint
npm run build
```
