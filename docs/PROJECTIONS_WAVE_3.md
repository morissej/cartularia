# Vague 3 — Projections Registre, W/R, Sceau et dérivés

La vague 3 implémente localement la séparation entre le Cartulaire privé et ses surfaces de lecture. Elle ne déploie rien sur `studio-2614005370-a3e51`.

## Recette automatique

```bash
npm run test:wave3
npm run lint
npm run build
```

La recette couvre notamment :

- projection Registre privée et isolation inter-tenant ;
- refus des blocs owner, transmission et storage ;
- refus physique d’un champ Secret dans une projection publique ;
- publication de quatre blocs W et d’un dérivé public séparé ;
- lecture anonyme du Watch website, des blocs et du Sceau ;
- rapport R privé ;
- rejeu idempotent ;
- révocation Firestore et Storage ;
- séquence des révisions et chaînage des événements.

## Construction locale du pilote IWC

Après le démarrage des émulateurs et l’import de la vague 2 :

```bash
npm run project:iwc:wave3
```

Cette commande crée uniquement `registries/reg_collection_privee/items/cart_iwc_flieger_utc_2002`. Elle est idempotente. Elle ne publie aucun contenu W/R, car les valeurs IWC importées restent `unverified` et les binaires attendent leur réingestion.

## Watch website Firestore

Le client charge une publication autoritaire avec :

```text
/watch-website?publicCode={publicCode}
```

Dans ce mode, la liste des blocs, leur contenu, les dérivés et le Sceau proviennent exclusivement de Firestore et Storage. Une publication absente ou révoquée affiche un état vide ; le client ne retombe pas sur `mockData` ou `localStorage`.

Le paramètre historique `?blocks=...` reste un aperçu local du prototype et n’est pas une publication.

## Commandes serveur disponibles

Le module `scripts/lib/projection-command.mjs` expose :

- `projectRegistryItem` ;
- `recordProjectionApproval` ;
- `publishPublicBlocks` ;
- `createReportProjection` ;
- `revokePublicPublication`.

Ces fonctions doivent être appelées depuis une surface serveur vérifiant ID token et App Check lors de l’intégration distante. Les SDK Admin contournant les Security Rules, l’IAM minimal et les journaux de service restent des gates de production.

## État de sortie

- Le Registre IWC est projetable en révision 2 dans les émulateurs.
- Quatre blocs W sûrs, un dérivé public et un Sceau sont publiables puis révocables en recette.
- Les rapports R sont projetés sous le Cartulaire et restent privés.
- Le Watch website sait lire Firestore par `publicCode` sans accès au maître.
- Les originaux et dérivés privés restent inaccessibles.
- L’activation W/R sur les données IWC réelles attend une décision humaine et la réingestion binaire réelle.
