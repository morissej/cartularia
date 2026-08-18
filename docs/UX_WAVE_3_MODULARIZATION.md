# Vague UX 3 — découpage modulaire additif

La vague transforme progressivement `App.tsx` en orchestrateur sans changer les routes, les clés de persistance, les schémas, les marqueurs W/R/C ni les projections.

## Frontières ajoutées

```text
src/features/cartulary/
├── components/
│   └── CartularyPresentation.tsx
├── modals/
│   └── CartularyModals.tsx
└── pages/
    └── CartularyPages.tsx
```

- `components` possède désormais les titres, paragraphes éditables, marqueurs W/R/C, affichage vidéo et tableaux de comparables.
- `modals` possède la visionneuse média, la revue 360°, l’éditeur de valorisation, la confirmation destructive et la notification d’annulation.
- `pages` définit cinq frontières nommées : `CoverPage`, `MediaPage`, `ReferencePage`, `ConditionPage` et `ValuePage`.
- `src/utils/formatting.ts` distingue date locale, date-heure locale, date-heure UTC, montant, pourcentage et taille de fichier. Les alias historiques restent disponibles pendant la migration.

## Contrats de compatibilité

- les composants gardent les classes CSS et attributs ARIA historiques ;
- les propriétés TypeScript sont explicites ;
- `App.tsx` reste la façade publique importée par `RootPage.tsx` ;
- les callbacks d’état et de persistance restent propriétaires de l’orchestrateur ;
- aucun état métier n’est déplacé dans un Context global ; ce travail relève de la vague 4.

## Suite progressive

Les pages sont maintenant des frontières stables et testables. Leur contenu peut être déplacé section par section vers des fichiers dédiés, avec une comparaison visuelle après chaque extraction, sans imposer une réécriture globale du Cartulaire.
