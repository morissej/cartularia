# ADR-007 — Readiness de production et autorisation calculée

- Statut : accepté pour la construction locale
- Date : 2026-08-15
- Vague : 7

## Décision

La fin de construction et l’autorisation de mise en service sont deux états différents. Le rapport de vague 7 porte toujours `constructionStatus=complete` lorsque les capacités techniques et leur recette sont livrées. Il ne porte `goLiveAuthorization=authorized` que si toutes les décisions de politique et tous les contrôles automatiques sont positifs.

Le fichier `config/production-policy.json` est l’autorité versionnée des décisions de région, publication de données personnelles, écriture serveur, chiffrement applicatif, conservation, prix régionaux et autorisation de déploiement distant. Un statut en attente bloque la mise en service ; le code ne fabrique aucune valeur pour franchir le gate.

## Capacités retenues

- sauvegarde complète et empreintée des documents Firestore et objets Storage via adaptateur ;
- restauration idempotente vers une cible isolée, avec préservation des types Firestore ;
- validation post-restauration des empreintes, fichiers, relations et chaînes d’audit ;
- sonde de charge bornée avec p50, p95, p99 et taux d’erreur ;
- inventaire des documents et octets JSON logiques ;
- calcul de coûts paramétrique, sans prix inventé lorsque la région n’est pas décidée ;
- scan des projections contre les champs personnels/Secrets interdits ;
- scan du dépôt contre les clés privées et credentials de service ;
- journaux opérationnels structurés avec masquage des données sensibles ;
- runbooks de sauvegarde/restauration, incident, rollback, privacy et monitoring.

## RTO, RPO et limites

Le pilote vise provisoirement un RPO de 24 heures et un RTO de 4 heures. Ces seuils servent au runbook et doivent être confirmés avant production. L’inventaire local ne mesure pas le poids des index Firestore, des fonctions, d’Auth ou des remises contractuelles. Une sonde d’émulateur vérifie la non-régression et le budget de requêtes, mais ne remplace pas un test de charge dans la région cible.

## Conséquence actuelle

La construction des sept vagues peut être complète tout en maintenant l’autorisation distante à `blocked`. La région Firestore/Storage, l’évaluation du chiffrement applicatif, la matrice juridique de conservation, la grille de prix régionale et l’autorisation explicite de déploiement sont actuellement des blockers déclarés.
