# PF2 — Redimensionnement ciblé des zones de texte

Date de validation locale : 18 août 2026.

## Cause traitée

`App` exécutait après chaque rendu un effet sans tableau de dépendances. Cet
effet lançait `document.querySelectorAll('textarea')`, remettait successivement
chaque hauteur à `auto`, lisait son `scrollHeight`, puis réécrivait sa hauteur.
Une modification d'état sans rapport avec un champ texte pouvait donc provoquer
un balayage du DOM et des lectures/écritures de layout pour tous les champs.

## Correction

- L'effet global et son écouteur `document` ont été supprimés.
- `AutoResizeTextarea` ne travaille que sur son propre élément.
- Le redimensionnement a lieu avant peinture au montage et lorsque `value` ou
  `defaultValue` change.
- La saisie déclenche uniquement le recalcul du champ concerné.
- Les gestionnaires `onInput`, `onChange`, les attributs IA, les valeurs
  contrôlées et les formulaires non contrôlés restent transmis sans modifier
  leurs contrats.
- Tous les champs du Cartulaire auparavant couverts par l'effet global utilisent
  le nouveau composant, y compris les paragraphes et comparables extraits de
  `App`.

## Verrous de non-régression

`tests/ui/auto-resize-textarea.test.tsx` vérifie :

- le calcul d'une hauteur correcte dès le montage avec plusieurs lignes ;
- le recalcul après chargement ou modification d'une valeur contrôlée ;
- le recalcul à la saisie et la conservation des gestionnaires existants ;
- l'absence de `querySelectorAll` global pendant une mise à jour ;
- l'absence de l'ancien effet global dans le code source de `App`.

## Validation locale

- Tests UI : 27/27 réussis.
- Tests UX complémentaires : 14/14 réussis.
- TypeScript : réussi.
- Lint : réussi sans avertissement après séparation des exports React.
- Build Vite isolé : réussi, sans écrire dans `dist/`.
- Budgets PF0 : entrée 197 106 o, App 298 847 o, Registre 36 201 o,
  plus gros fragment 488 183 o — quatre budgets respectés.
- Navigateur desktop : valeur hydratée de 151 caractères ajustée à 70 px ;
  vingt mises à jour successives aboutissent à vingt lignes et 486 px, égaux au
  `scrollHeight`, sans débordement horizontal.
- Trois cycles de fermeture/réouverture du mode édition restituent la valeur et
  la hauteur initiales ; trois cycles de la modale Preuves restent stables.
- Navigateur 390 × 844 : six lignes ajustées à 163 px dans un champ de 308 px,
  sans débordement horizontal.

La durée de 465 ms observée pour vingt opérations `fill` pilotées inclut le coût
de l'automatisation et ne constitue pas une mesure INP de terrain.

## Arbitrage de profilage

PF0 ne relevait aucune longue tâche et un Total Blocking Time nul. PF2 ne
mémoïse donc pas arbitrairement d'autres composants et ne refactorise pas le
reste de `App`. La suppression du balayage de layout mesuré est la seule
optimisation de rendu introduite dans cette vague.

## Périmètre

- aucune clé persistée, route, décision W/R/C ou donnée métier modifiée ;
- aucune règle Firebase ou autorisation modifiée ;
- aucune écriture Firebase de production et aucun déploiement Hosting.
