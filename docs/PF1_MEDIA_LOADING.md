# PF1 — Chargement progressif des médias

Date de validation locale : 18 août 2026.

## Cause traitée

Le carrousel instançait un élément `<video preload="metadata">` pour chaque
miniature vidéo. La page Médias pouvait donc ouvrir plusieurs flux lourds avant
toute intention de lecture. Le lecteur 360° lançait pour sa part tous les
préchargements simultanément une fois ouvert.

## Correction

- Les miniatures vidéo utilisent désormais leur poster ou leur vignette.
- En l'absence de poster, une surface neutre et l'icône de lecture sont
  affichées sans créer d'élément vidéo.
- Seule la vidéo active est instanciée, avec `preload="metadata"`.
- Le 360° reste déclenché explicitement par l'utilisateur.
- Après ouverture, ses images sont chargées dans l'ordre affiche, angle suivant,
  angle précédent, puis reste de la séquence, avec deux requêtes concurrentes au
  maximum.
- La file est annulée lors du démontage du lecteur.

## Verrous de non-régression

`tests/ui/media-preloading.test.tsx` vérifie :

- zéro élément vidéo dans la bande de miniatures ;
- l'usage du poster et du repli neutre ;
- une seule vidéo active et son niveau de préchargement ;
- l'ordre prioritaire des vues 360° ;
- un maximum de deux chargements 360° simultanés.

## Validation locale

- Tests UI : 22/22 réussis.
- Build Vite isolé : réussi, sans écrire dans `dist/`.
- Budgets PF0 : entrée 197 106 o, App 298 889 o, Registre 36 201 o,
  plus gros fragment 488 183 o — quatre budgets respectés.
- Navigateur desktop : 0 vidéo au repos, 0 vidéo dans les miniatures, 1 vidéo
  après sélection, 360° absent avant clic puis présent après clic.
- Navigateur 390 × 844 : même comportement, sans débordement horizontal de la
  page ni de la modale 360°.
- Contrôle TypeScript global : réussi.
