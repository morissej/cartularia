# Runbook — Monitoring, capacité et coûts

## Indicateurs

- disponibilité et taux d’erreur par route logique ;
- p50, p95 et p99 des lectures et commandes ;
- conflits de révision et replays idempotents ;
- jobs bloqués, âge du dernier backup et résultat du dernier restore drill ;
- lectures, écritures, suppressions, stockage indexé, objets Storage et egress ;
- refus Security Rules, révocations et anomalies inter-tenant ;
- échecs privacy et détection de credentials.

## Seuils initiaux

La policy fixe un p95 maximal de 1 000 ms et un taux d’erreur nul pour la sonde locale. Ces seuils ne valent pas SLO de production. Après choix de la région, exécuter un test non productif représentatif montre + voiture, puis fixer SLO, alertes et budgets par organisation.

## Coûts

Le calculateur accepte des prix par 100 000 lectures, écritures et suppressions, par Go-mois et par Go d’egress. Il refuse de produire un montant sans grille régionale. Ajouter séparément les index, fonctions, Auth, monitoring, sauvegardes, taxes et remises contractuelles.

Déclencher une alerte sur dérive de volume, boucle de trigger, hausse d’egress, accumulation de dérivés ou croissance anormale des sous-collections.
