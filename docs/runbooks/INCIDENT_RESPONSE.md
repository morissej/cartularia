# Runbook — Réponse à incident

## Priorités

1. Protéger les personnes et limiter l’exposition des données.
2. Préserver les preuves et le journal chaîné.
3. Révoquer les projections, accès et dérivés concernés.
4. Restaurer un service sûr, puis analyser la cause.

## Sévérités

- SEV-1 : lecture inter-tenant, credential de service exposé, altération confirmée ou original privé rendu public.
- SEV-2 : publication non autorisée, restauration échouée, perte de disponibilité durable.
- SEV-3 : dégradation de performance, coût anormal ou job bloqué sans fuite.

## Procédure

1. Ouvrir un identifiant d’incident et horodater chaque action.
2. Pour SEV-1, suspendre les publications et dérivés, désactiver le principal compromis et geler les déploiements.
3. Capturer les logs structurés, empreintes, révisions et configurations sans copier les contenus patrimoniaux dans le canal incident.
4. Vérifier les Security Rules, IAM, App Check, journaux Admin et dernières commandes.
5. Restaurer vers une cible isolée si l’intégrité de la base est en doute.
6. Tester la révocation, l’isolation inter-tenant et la cohérence du journal avant réouverture.
7. Documenter cause, périmètre, personnes concernées, notification éventuelle et actions correctives.

Les obligations de notification et délais légaux doivent être validés par le conseil juridique selon les pays concernés.
