# Vague 4 — Noyau multi-actifs

## Résultat

La verticale `car@1.0.0` coexiste avec `watch@1.3.0` dans le même modèle Firestore. Elle comprend 40 champs répartis sur l’identité, la technique, l’usage, l’état, l’historique, les médias, la valeur et les sélections W/R.

Le Cartulaire automobile de démonstration porte l’identifiant `cart_car_demo_gt_1987`. Toutes ses valeurs sont Secrets, non publiées et marquées comme import non revu. Le VIN, l’immatriculation, l’inspection et la valeur réelle ne sont pas inventés.

## Exécution locale protégée

```bash
npm run schema:export
npm run seed:foundations
npm run import:car-demo
npm run project:car:wave4
```

Les scripts refusent un environnement distant sauf présence de l’argument explicite `--allow-remote`. Le workflow automatique de cette vague reste exécuté sur les émulateurs.

Le lecteur générique est disponible à :

```text
/cartulary-view?cartularyId=cart_car_demo_gt_1987
```

Il requiert une session authentifiée disposant de `cartulary.read` sur le Registre concerné.

## Contrôles de sortie

```bash
npm run test:wave4
npm run lint
npm run build
```

Les contrôles couvrent notamment :

- T-01 : enveloppe identique pour `watch` et `car`, sans root `cars` ;
- T-02 : lecture d’un champ inconnu par le fallback générique ;
- T-17 : filtre Registre par type et collection avec ordre de mise à jour ;
- isolation inter-tenant appliquée aux deux verticales ;
- import automobile idempotent et journalisé ;
- absence de projection publique ou de rapport automatique.

## Périmètre de déploiement

Aucun changement n’est déployé à distance par cette vague. Firebase Hosting et Cloud Firestore demeurent la cible décidée ; une mise en production devra appliquer les index et publier les profils de schéma dans un acte séparé et explicitement contrôlé.
