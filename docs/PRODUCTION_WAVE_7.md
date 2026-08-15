# Vague 7 — Production et readiness

## Résultat

La dernière vague fournit le dispositif d’exploitation du pilote : charge, volumétrie, coûts paramétriques, sauvegarde/restauration, privacy, recherche de credentials, observabilité et runbooks.

Le scénario automatique sauvegarde l’intégralité de Firestore, ajoute un fichier binaire de contrôle, restaure l’ensemble dans un projet d’émulateur isolé, puis revalide les empreintes, les organisations, Registres, memberships et chaînes d’audit. La source n’est jamais effacée.

## Exécution locale

Après les vagues 1 à 6 :

```bash
npm run production:wave7
```

Pour écrire volontairement un rapport local non suivi par Git :

```bash
npm run production:wave7 -- --output=/private/tmp/cartularia-production-readiness.json
```

Le fichier est créé en mode `0600` et ne peut pas écraser un fichier existant. Une sauvegarde contient des données classées Secret et doit être chiffrée par le support de stockage avant toute conservation hors émulateur.

## Recette

```bash
npm run test:wave7
npm run lint
npm run build
```

La recette couvre :

- T-20, y compris un fichier binaire de contrôle ;
- altération négative d’un document de sauvegarde ;
- préservation des types Firestore et rejeu idempotent ;
- percentiles et taux d’erreur de la sonde de charge ;
- inventaire de volumétrie logique ;
- coût non calculé sans grille, puis reproductible avec une grille injectée ;
- absence physique de champs Secrets dans les projections et détection d’une fuite ;
- détection d’une clé privée de service injectée ;
- masquage des champs sensibles dans les logs ;
- séparation entre construction complète et autorisation de mise en service.

## État du gate

Le rapport courant doit afficher :

- `constructionStatus: complete` ;
- `goLiveAuthorization: blocked`.

Les blockers sont listés depuis `config/production-policy.json`. Les fermer exige des décisions réelles ; modifier artificiellement le rapport ou contourner le gate est interdit.

## Runbooks

- [`runbooks/BACKUP_RESTORE.md`](runbooks/BACKUP_RESTORE.md)
- [`runbooks/INCIDENT_RESPONSE.md`](runbooks/INCIDENT_RESPONSE.md)
- [`runbooks/RELEASE_ROLLBACK.md`](runbooks/RELEASE_ROLLBACK.md)
- [`runbooks/PRIVACY_RETENTION.md`](runbooks/PRIVACY_RETENTION.md)
- [`runbooks/MONITORING_COSTS.md`](runbooks/MONITORING_COSTS.md)
