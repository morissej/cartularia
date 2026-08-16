# Registre — Vague 8

Date : 16 août 2026
Statut : implémenté et validé localement

## Objectif

La Vague 8 clôt le MVP du Registre par une recette pilote reproductible. Elle ne crée aucune nouvelle donnée patrimoniale et ne transforme pas une validation locale en autorisation de mise en production.

Deux verdicts sont désormais calculés séparément :

- `pilotStatus=ready` signifie que le MVP peut entrer en recette avec des utilisateurs pilotes ;
- `goLiveAuthorization=authorized` exige en plus toutes les décisions de région, sécurité, conservation, coûts et déploiement distant.

## Durcissement livré

- contrat de routes extrait et testé pour les huit sections du Registre ;
- encodage des identifiants opaques et repli sûr des routes inconnues ;
- nom accessible conservé sur chaque destination lorsque la navigation compacte masque le texte ;
- lien d’évitement clavier vers le contenu principal ;
- styles de focus visibles pour les liens du Registre ;
- respect du réglage de réduction des animations ;
- matrice R8 vérifiant dix dimensions du pilote ;
- rapport empreinté et exportable sans inclure de donnée patrimoniale.

## Matrice de recette automatisée

Le préflight contrôle :

1. session authentifiée et choix du contexte ;
2. isolation des tenants et portée explicite ;
3. catalogue fondé sur les projections du Registre ;
4. présence des huit surfaces opérationnelles ;
5. maintien de l’autorité des Cartulaires ;
6. stabilité du contrat de routes ;
7. navigation clavier et noms accessibles ;
8. comportement responsive et comparaison défilable ;
9. présence des suites automatisées R1 à R8 ;
10. politique de production, conservation et runbooks opérationnels.

Cette matrice est un contrôle automatisé de préparation. Elle ne prétend pas remplacer la recette humaine sur appareils réels, lecteurs d’écran et niveaux de zoom du navigateur.

## Commandes

Recette ciblée :

```bash
npm run test:registry-wave8
npm run registry:pilot
```

Chaîne complète R1 à R8, contrôles correctifs, rétention, lint et build :

```bash
npm run test:wave8
```

Un rapport privé peut être produit dans un chemin neuf :

```bash
npm run registry:pilot -- --output=/private/tmp/cartularia-registry-wave8.json
```

## Verdict au 16 août 2026

- construction du Registre : complète ;
- préparation du pilote : prête ;
- mise en service distante : bloquée ;
- déploiement exécuté : aucun.

Les blocages de production restent ceux du fichier `config/production-policy.json` : région Firestore/Storage, évaluation du chiffrement applicatif, validation juridique de la conservation, grille de coûts régionale et autorisation explicite de déploiement distant.

## Périmètre du pilote

Le pilote peut vérifier les parcours authentifiés, le choix de contexte, la synthèse, le catalogue, le suivi, les accès, l’administration et la comparaison. Il ne doit utiliser que des données de démonstration ou des données autorisées dans l’environnement retenu.

Les originaux, médias, preuves, documents et archives restent dans leurs Cartulaires. Aucun de ces actifs n’est incorporé au rapport R8.
