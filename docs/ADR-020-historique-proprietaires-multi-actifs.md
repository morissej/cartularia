# ADR-020 — Historique des propriétaires multi-actifs

- Statut : accepté
- Date : 2026-08-17

## Décision

Tout Cartulaire porte par défaut une section privée `cover.ownership_history`, quel que soit son type d’actif. Une période contient une année de début, une année de fin, une description et le marqueur exclusif `Premier propriétaire`.

Le marqueur ne produit aucune prime ni décote automatique. Il alimente une synthèse de provenance et une appréciation qualitative obligatoire dans la valorisation. Les lacunes de la chaîne de propriété restent explicitement signalées.

Les données sont `secret` par défaut. Le bloc est exclu du site W et du Cercle C ; il peut être sélectionné dans le rapport privé R après validation humaine.

## Versionnement

- `watch@1.5.0` ajoute le contrat d’historique aux 91 champs de `watch@1.4.0` ;
- `car@1.1.0` l’ajoute aux 40 champs de `car@1.0.0` ;
- les artefacts antérieurs restent immuables et lisibles.

Les futurs profils verticaux doivent reprendre les identifiants communs définis par `OWNERSHIP_HISTORY_FIELD_IDS`.
