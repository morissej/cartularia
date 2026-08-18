# Vague UX 5 — performance et cycle de vie média

## Résultat

La vague réduit le JavaScript nécessaire avant interaction et borne les Object URLs privées sans changer les routes, les contrats de données ou la politique de publication.

Les frontières chargées à la demande sont désormais :

- le panneau d’intégrité et le lecteur 360° du Cartulaire ;
- les vues Catalogue, Création, Galerie, Comparaison, Suivi, Accès, Intégrité et Administration du Registre ;
- les services Firebase du démarrage, qui ne sont plus importés statiquement par `main.tsx` avant de connaître la route.

## Mesures avant / après

| Artefact | Référence vague 0 | Vague 5 | Évolution |
| --- | ---: | ---: | ---: |
| Chunk initial | 801 326 o | 197 010 o | −604 316 o · −75,4 % |
| Cartulaire `App` | 358 349 o | 297 313 o | −61 036 o · −17,0 % |
| Shell `RegistryApp` | 142 369 o | 36 109 o | −106 260 o · −74,6 % |
| Plus gros chunk | 801 326 o | 479 770 o | sous le seuil Vite de 500 ko |

Le nombre total de fichiers augmente volontairement : chaque parcours ne télécharge plus les vues qu’il n’ouvre pas. Les budgets sont contrôlés par `npm run measure:ux-wave5` après le build.

## Médias privés

`ObjectUrlLeaseCache` mutualise les chargements concurrents, compte les usages actifs et applique une éviction LRU aux URL inactives au-delà de 24 entrées. Une URL encore affichée n’est jamais révoquée. Les images différées libèrent leur bail au démontage ou lorsqu’elles quittent la zone de préchargement, et la Galerie restitue également ses URL au cache.

`PrivateMediaImage` accepte maintenant `sourceOverride`. Le carrousel transmet l’aperçu séparément au lieu de recréer un objet `Asset` à chaque rendu.

## Limites et invariants

- aucune règle Firebase, permission ou donnée de production n’est modifiée ;
- aucun `manualChunks` figé : le découpage découle des frontières fonctionnelles `React.lazy` ;
- les clés de persistance, événements cloud, routes SPA, W/R/C et schémas restent inchangés ;
- les mesures sont locales et comparatives, pas des Core Web Vitals de production.
