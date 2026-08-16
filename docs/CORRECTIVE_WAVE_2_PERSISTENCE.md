# Vague corrective 2 — Persistance hybride et originaux durables

## Résultat

Le prototype ne dépend plus uniquement de `localStorage`. Au démarrage, les états Cartularia sont restaurés depuis un coffre IndexedDB, puis les formulaires continuent d’écrire un cache synchrone doublé par ce coffre. Les médias, pièces propriétaire et pièces jointes d’état sont conservés comme `Blob` avec leur empreinte SHA-256 et réhydratés avec une nouvelle URL locale après rechargement.

Une session Firebase existante active une copie privée dans `privateDrafts/{uid}/cartularies/{cartularyId}` et Storage sous `private-drafts/{uid}/…`. Cette copie n’est ni le Cartulaire autoritaire, ni une projection publique, ni une publication Cercle/Rapport.

## Garanties

- Aucun original privé n’est lisible anonymement ou par un autre uid.
- Une modification concurrente produit un conflit visible ; aucune stratégie « dernier arrivé gagne » n’écrase silencieusement une version.
- Les suppressions de fichiers deviennent des tombstones synchronisables.
- Le chemin Storage contient l’empreinte de l’original et les métadonnées d’écriture doivent la répéter.
- Un brouillon cloud supprimé ne peut pas être recréé par un navigateur ancien.
- Les vidéos importées disposent d’un lecteur `<video controls>` ; l’original reste dans le coffre. La génération automatique d’un dérivé optimisé reste à réaliser côté serveur.

## Suppression et conservation

Le panneau Intégrité expose une confirmation à deux étapes. Il efface le coffre local et, si l’utilisateur est authentifié, sa copie privée cloud. Une trace serveur minimale `deleted` empêche la résurrection accidentelle. La politique technique fixe la purge planifiée à deux années calendaires après le passage explicite du compte à `inactive`.

La commande de conservation est volontairement sûre : dry-run par défaut, double confirmation pour une exécution distante. Cette vague ne déduit pas qu’un Cartulaire autoritaire détenu par une organisation ou qu’un acte W/C/R doit être supprimé avec un uid ; cet arbitrage doit précéder une cascade globale.

## Vérification

```text
npm run test:corrective-wave2
npm run test:retention
npm run test:rules
npm run test:storage
npm run validate:ai
npm run lint
npm run build
```

La recette navigateur doit confirmer l’import d’un média et d’un document, leur disponibilité après rechargement, la lecture vidéo et l’état du coffre dans le panneau. La suppression finale ne doit être exécutée que sur une origine locale isolée contenant des fichiers de recette, jamais sur le dossier de démonstration à conserver.
