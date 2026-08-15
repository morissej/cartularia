# Vague 5 — Communauté isolée

## Résultat

La surface `/community` affiche un feed issu exclusivement de `communityPublications`, `communityPosts`, `communityProfiles` et des commentaires autorisés. Elle n’effectue aucune lecture de `cartularies`.

Le pilote comprend :

- une admission communautaire pseudonyme pour `wave1-owner` ;
- une projection IWC de trois blocs contenant uniquement des champs `public` ou `community` ;
- un post, un commentaire sans valeur de preuve et une réaction agrégée ;
- une commande de suspension qui invalide immédiatement la projection sociale et ses dérivés Storage.

## Exécution locale protégée

Après les fondations, l’import IWC et sa projection Registre :

```bash
npm run community:wave5
npm run community:moderate:wave5
```

Chaque commande refuse un environnement distant en l’absence de l’argument explicite `--allow-remote`. Le workflow de recette s’exécute sur les émulateurs Firebase.

## Modèle d’accès

Un utilisateur doit être authentifié, porter un document `communityMemberships/{uid}` actif et posséder la permission correspondant à l’action. Une admission communautaire n’accorde aucun droit sur une organisation, un Registre ou un Cartulaire.

Les écritures du navigateur sont interdites. Les commandes serveur couvrent l’admission, le profil, la publication, le post, le commentaire, la réaction et la modération avec `requestId` idempotent.

## Contrôles de sortie

```bash
npm run test:wave5
npm run lint
npm run build
```

La recette couvre notamment :

- T-18 : un commentaire ne modifie ni la révision, ni l’empreinte, ni le journal du Cartulaire ;
- T-19 : un champ Secret est rejeté et reste physiquement absent de la projection ;
- lecture réservée aux membres admis ;
- séparation profil pseudonyme / compte privé ;
- réactions stockées séparément et compteur agrégé ;
- suspension immédiate de Firestore et Storage sans mutation du maître ;
- requêtes du feed bornées à une publication active ;
- refus de toutes les écritures client ;
- rejeu idempotent de toute la séquence pilote.

## Périmètre de mise en service

Aucune donnée patrimoniale réelle et aucun original média ne doivent être introduits par ce pilote. La mise en production reste subordonnée aux décisions de région, privacy, conservation et modération, ainsi qu’aux gates de la vague 7.
