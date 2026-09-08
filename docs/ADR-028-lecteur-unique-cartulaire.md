# ADR-028 — Lecteur unique de Cartulaire piloté par l’enveloppe et le schéma

- Statut : accepté
- Date : 2026-09-08
- Précise : ADR-004 (noyau multi-actifs), ADR-026 (gabarit universel)

## Contexte

L’audit du 2026-09-07 a constaté deux lecteurs de Cartulaire : `src/App.tsx` pour les montres,
IWC et Rolex (route `/cartulary`, données lues dans le brouillon privé) et
`GenericCartularyView` pour les autres verticales (route `/cartulary-view`, données lues dans
`cartularies/{id}` et le schéma épinglé). L’aiguillage se faisait par type d’objet dans
`buildCartularyHref`. Toute évolution de la base devait être faite deux fois, et une automobile
n’avait pas le même habillage qu’une montre.

## Décision

1. **`src/App.tsx` est le lecteur unique.** Tout objet non démo ouvre `/cartulary` ;
   `/cartulary-view` reste un alias de compatibilité rendant le même lecteur.
2. **L’enveloppe et le schéma autoritaires pilotent le lecteur.** Le hook
   `useAuthoritativeCartulary` (`src/features/cartulary/state/`) charge `cartularies/{id}`, ses
   sections, le schéma épinglé par l’enveloppe, les médias projetés et les droits du compte.
   L’identité affichée (marque, modèle, référence) vient de l’enveloppe dès qu’elle est chargée ;
   le brouillon privé reste la source des blocs spécialisés existants.
3. **Un bloc spécialisé ne s’affiche que si le schéma porte sa section** (`schemaHas`). La liste
   des sections couvertes par un bloc spécialisé est `SPECIALIZED_CARTULARY_SECTIONS` dans le
   contrat de présentation.
4. **Toute autre section du schéma est rendue par le composant générique** `GenericSchemaSection`,
   sur la page que `cartularyPageForSchemaSection` lui attribue, avec l’édition autoritaire
   (`saveGenericCartularyFields`). Le même composant et le même état d’édition
   (`useGenericSectionEdits`) servent `GenericCartularyView`, conservé pour ses tests et comme
   rendu de secours.

## Conséquences

- Un Cartulaire montre existant garde exactement sa présentation : ses sections sont toutes
  couvertes par un bloc spécialisé, et sans schéma chargé (démo, hors ligne) rien n’est masqué.
- Une automobile ouvre le Cartulaire complet : identité, médias, suivi, stockage, transmission,
  publication, puis ses sections propres (`technical.*`, `history.*`, `usage.*`) en rendu générique.
- Ajouter une verticale ne demande plus de lecteur : publier son schéma suffit.
- Reste à faire (étapes suivantes de l’audit) : sortir IWC et Rolex du code, dériver le bundle de
  création du catalogue, écrire la commande de remontée de schéma, retirer les 87 conditions par
  identité d’`App.tsx`.

## Contrôle

`tests/cartulary-presentation-contract.test.mjs` verrouille : le hook autoritaire dans `App.tsx`,
les sections génériques sur les six pages, l’absence d’aiguillage par type dans le Registre, le
conditionnement des blocs spécialisés, et l’appartenance des sections spécialisées au catalogue.
`tests/ui/generic-schema-page-sections.test.tsx` couvre le rendu et l’édition générique.
