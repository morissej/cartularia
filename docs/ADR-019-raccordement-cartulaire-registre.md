# ADR-019 — Raccordement autoritaire Cartulaire → Registre

- Statut : accepté pour le pilote local
- Date : 2026-08-16

## Décision

Le Cartulaire demeure l'autorité métier. Le navigateur synchronise d'abord son coffre local vers `privateDrafts/{uid}/cartularies/{cartularyId}` et les originaux vers Firebase Storage. Une écriture minimale sous `cartularySyncRequests/{cartularyId}` déclenche ensuite une commande Admin ; le navigateur ne peut toujours écrire ni le Cartulaire canonique, ni la projection Registre, ni le journal d'intégrité.

La commande valide le propriétaire, le droit `cartulary.edit`, le périmètre du Registre, la révision et la chaîne d'audit. Si l'empreinte du brouillon a changé, elle met à jour atomiquement :

- les champs communs et la révision du Cartulaire ;
- ses états privés sous `liveState` ;
- les métadonnées et chemins Storage de ses médias ;
- la projection `registries/{registryId}/items/{cartularyId}` ;
- un événement `cartulary.live_state.synced` dans le journal chaîné.

Un rejeu sans changement n'ajoute ni révision ni événement. Les vues Registre s'abonnent à la projection Firestore ; Galerie et Intégrité relisent ensuite les ressources autorisées du Cartulaire. Aucune preuve, archive ou copie média n'est créée sous le Registre.

## Exploitation

Le pilote exécute `npm run sync:worker` contre les émulateurs. Cette commande refuse un environnement distant sans `--allow-remote`. Le passage en production exigera une commande serveur managée équivalente, les décisions d'infrastructure ouvertes et une autorisation explicite de déploiement ; cette ADR n'autorise aucun déploiement distant.
