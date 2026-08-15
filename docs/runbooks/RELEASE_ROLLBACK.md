# Runbook — Mise en production et rollback

## Préconditions

- `goLiveAuthorization=authorized` dans un rapport fraîchement généré ;
- région, conservation, chiffrement et prix confirmés dans la policy ;
- aucune clé durable dans le client ou le dépôt ;
- sauvegarde vérifiée et exercice de restauration réussi ;
- tests vagues 1 à 7, lint et build au vert ;
- cible Firebase, identité CLI et artefact `dist` contrôlés.

## Release

1. Créer une sauvegarde et conserver son empreinte.
2. Déployer d’abord règles et index dans un environnement non productif.
3. Exécuter les tests d’isolation et de publication/révocation.
4. Construire l’artefact depuis la révision approuvée.
5. Déployer par composant avec journal de commande et opérateur.
6. Vérifier les endpoints, une ressource statique, Auth, Registre privé et projection publique.
7. Surveiller erreurs, latence, lectures, écritures, Storage et coûts.

## Rollback

1. Stopper les déploiements et suspendre les nouvelles publications.
2. Revenir à la version Hosting connue ; ne jamais restaurer une base par simple remplacement non vérifié.
3. Pour Rules/Index, appliquer la version précédente validée puis rejouer les tests négatifs.
4. Pour données, restaurer d’abord vers une cible isolée et basculer seulement après T-20.
5. Documenter la divergence et préserver les événements append-only.
