# Registre — Vague 1

Date : 15 août 2026
Statut : implémenté et vérifié localement

## Objectif

La Vague 1 rend accessible la première surface authentifiée du Registre. Elle couvre l'entrée dans le produit, la découverte des contextes autorisés et le cadre de navigation. Elle ne duplique pas le contenu patrimonial des Cartulaires.

## Parcours livré

- `/registry` affiche la connexion si aucune session Firebase n'est active ;
- après connexion, le client découvre les memberships actifs du compte ;
- aucun Registre autorisé produit un état neutre, sans révéler d'autre tenant ;
- un seul Registre autorisé ouvre directement sa vue d'ensemble ;
- plusieurs Registres autorisés déclenchent un sélecteur de contexte ;
- `/registry/{registryId}/overview` affiche la synthèse du contexte choisi ;
- une URL visant un Registre non autorisé produit le même état générique qu'un contexte introuvable.

Le sélecteur de contexte reste disponible depuis l'en-tête. La navigation responsive prépare quatre sections : Vue d'ensemble, Catalogue, Suivi et Administration.

## Données affichées

La vue d'ensemble utilise uniquement les fondations déjà autorisées :

- nom, description, statut et compteur du Registre ;
- organisation d'administration ;
- rôles issus du membership actif.

Le compteur est celui du document `registries/{registryId}`. Au moment de cette vague, le catalogue détaillé, les agrégats, le suivi et les commandes d'administration appartenaient encore aux vagues suivantes.

## Frontière patrimoniale

Le Registre est un index privé et une surface de pilotage. Il ne reprend ni les originaux média, ni les preuves, ni les archives. Ces actifs demeurent dans le Cartulaire maître. Une future liste du Registre devra lire la projection privée `registries/{registryId}/items/{cartularyId}` et n'exposer qu'une vignette ou un dérivé explicitement autorisé.

## Exécution locale

Le socle Firebase local et le seed sont documentés dans `FOUNDATIONS_WAVE_1.md`. Une fois les émulateurs et le seed démarrés, lancer :

```bash
npm run dev
```

Puis ouvrir `http://127.0.0.1:5173/registry`.

## Validation

```bash
npm run lint
npm run build
npm run test:wave1
```

La suite vérifie notamment l'isolation des tenants, la découverte bornée au compte authentifié, l'impossibilité pour le client de modifier les fondations autoritaires et la fermeture des originaux privés dans Storage.
