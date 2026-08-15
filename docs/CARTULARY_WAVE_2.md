# Vague 2 — Cartulaire privé IWC

Cette vague crée le Cartulaire IWC dans l’environnement local Firebase, après les fondations de la vague 1. Elle ne déploie rien sur `studio-2614005370-a3e51`.

## Recette automatique

```bash
npm run test:wave2
npm run lint
npm run build
```

La recette vérifie successivement les fondations, les règles Firestore/Storage, le bootstrap Auth, le bundle IWC, la commande transactionnelle, l’idempotence, l’événement canonique et l’isolation inter-tenant.

## Construction manuelle dans les émulateurs

Terminal 1 :

```bash
npm run emulators
```

Terminal 2 :

```bash
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
export GCLOUD_PROJECT=cartularia-wave2-local

npm run schema:export
npm run seed:foundations
npm run import:iwc
```

Un second `npm run import:iwc` retourne le résultat initial et ne crée ni nouvelle révision, ni nouvel événement.

## État de sortie

- Cartulaire : `cart_iwc_flieger_utc_2002`
- Organisation : `org_demo`
- Registre : `reg_collection_privee`
- Schéma : `watch@1.3.0`
- Cycle de vie : `review`
- Visibilité : `secret`
- Publication : `none`
- Médias : 22 métadonnées en attente de réingestion binaire
- Intégrité : un événement `cartulary.created` et un reçu de commande idempotent

Le client peut charger l’enveloppe et les sections autorisées via `src/services/cartularies.ts`. Aucune méthode d’écriture navigateur n’est exposée.

## Étape suivante

La vague 3 est désormais implémentée dans [`PROJECTIONS_WAVE_3.md`](PROJECTIONS_WAVE_3.md). Elle génère des projections physiquement séparées pour le Registre et, après approbation humaine et liste blanche, pour les blocs W/R et le Sceau. Elle ne lit jamais publiquement le Cartulaire maître.
