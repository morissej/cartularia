# Vague corrective 5 — parcours, audiences et accessibilité

Date : 16 août 2026

## Résultat

Cette vague corrige les défauts de parcours qui pouvaient masquer une erreur ou donner une fausse impression de confidentialité :

- la navigation précédente/suivante est bornée et ne peut plus produire `#undefined` ;
- un fragment absent ou inconnu est normalisé vers `#cover` ;
- une route inconnue affiche une vraie page 404 au lieu de rendre silencieusement le Cartulaire privé ;
- un paramètre `publicCode` invalide affiche un état d'erreur sans retomber sur l'aperçu local ;
- le Cercle est accessible depuis la navigation et propose un retour explicite vers le Cartulaire ;
- le filtre `Secret / Communauté / Tous` est enfin visible, utilisable et persistant ;
- le changement d'audience ferme les éditeurs en cours et les vues non propriétaires restent non modifiables ;
- l'interface explique que ce filtre ne constitue jamais un acte de publication W, R ou C ;
- la page d'accueil expose un `h1`, un lien d'évitement mène au contenu et les liens rejoignent le même traitement de focus visible que les boutons et formulaires ;
- les commandes FR/EN restent disponibles à 390 px, sont annoncées comme boutons pressés et mettent à jour `<html lang>` ;
- les préférences de langue et d'audience sont normalisées avant restauration : une valeur locale inconnue revient respectivement à `FR` et `Secret`.

## Mise en page Valorisation

Le tableau des comparables a une structure d'en-tête cohérente avec ses lignes en lecture et en édition. Les deux champs techniques nécessaires au catalogue IA restent `hidden` sur mobile ; les libellés de carte utilisent désormais `data-column-label` au lieu de sélecteurs `nth-child` fragiles.

La recette à 390 px a également révélé deux causes de débordement en dehors du tableau :

- les cinq scénarios de sensibilité imposaient une largeur minimale à leur grille parente ;
- la règle desktop de la synthèse des comparables, plus spécifique, annulait la colonne mobile unique.

Les conteneurs peuvent maintenant rétrécir, les scénarios sont disposés sur deux colonnes et les grandes matrices restent défilables à l'intérieur de leur propre cadre. La mesure finale du document sur la page Valorisation est `clientWidth=390`, `scrollWidth=390`, `bodyScrollWidth=390`.

## Frontière confidentialité / publication

Le mode d'audience est un contrôle de consultation du Cartulaire courant. Il masque les sections selon leur niveau et désactive les commandes d'édition et de sélection W/R/C hors du mode `Secret`. Il ne crée, ne modifie et ne révoque aucune projection distante.

Le compteur Cercle ne compte que les sélections C validées pour la révision et l'empreinte source courantes. Ouvrir `/community` ne transmet pas ces blocs : une émission serveur reste un acte séparé.

## Langues

La sémantique du document, la navigation partagée, les commandes de sortie et le filtre d'audience suivent maintenant FR/EN et la préférence survit à un rechargement. Les textes saisis par l'utilisateur et le contenu documentaire du dossier ne sont volontairement jamais traduits automatiquement.

La traduction exhaustive des libellés métier encore écrits directement en français dans les grands formulaires n'est pas déclarée comme terminée dans cette vague. Elle reste un élément explicite de la vague 6 afin de ne pas présenter une traduction partielle comme une localisation complète.

## Recette

```bash
npm run test:corrective-wave5
npm run validate:ai
npm run lint
npm run build
git diff --check
```

La recette navigateur a vérifié : les trois audiences, leur retour au mode propriétaire, EN et `lang="en"` après rechargement, la normalisation d'un fragment inconnu, la page 404, le refus d'un `publicCode` invalide, l'accès au Cercle, le `h1` de l'accueil et l'absence de débordement global à 390 px.

## Limites reportées à la vague 6

- traduction exhaustive des formulaires et messages secondaires ;
- confirmation et possibilité d'annulation des suppressions unitaires ;
- piège de focus et restitution du focus pour toutes les modales et tiroirs ;
- traitement final des suppressions au clavier et des annonces dynamiques ;
- revue de cohérence complète des libellés et du rapport imprimé dans les deux langues.
