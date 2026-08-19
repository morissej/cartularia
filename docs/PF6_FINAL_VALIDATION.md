# PF6 — Validation finale et livraison locale

Date de validation : 18 août 2026.

## Verdict

Les vagues PF0 à PF6 sont validées localement. Le gain mobile est net sur la
méthode de laboratoire PF0, les parcours chauds restent stables ou plus rapides
et les contrats fonctionnels contrôlés n'ont pas régressé.

Cette validation ne constitue ni un déploiement Hosting, ni une certification
de production, ni une mesure de Web Vitals terrain.

## PF0 versus PF6 — Lighthouse cache froid

Médiane de trois audits par profil sur le même build PF6 isolé. Le profil mobile
utilise 390 × 844 à DPR 3 ; le profil desktop utilise le preset Lighthouse
desktop à 1 440 × 900.

### Mobile

| Indicateur | PF0 | PF6 | Évolution |
| --- | ---: | ---: | ---: |
| Score Performance | 75 | 86 | +11 points |
| FCP | 2 692 ms | 1 810 ms | -882 ms · -32,8 % |
| LCP | 5 718 ms | 4 025 ms | -1 693 ms · -29,6 % |
| Speed Index | 2 692 ms | 1 879 ms | -813 ms · -30,2 % |
| Temps interactif | 5 747 ms | 4 040 ms | -1 707 ms · -29,7 % |
| Total Blocking Time | 0 ms | 0 ms | stable |
| CLS | 0,000298 | 0,000111 | -62,9 % |
| Travail du thread principal | 733 ms | 633 ms | -100 ms · -13,6 % |
| Transfert total | 747 664 o | 403 687 o | -343 977 o · -46,0 % |
| Requêtes | 31 | 24 | -7 · -22,6 % |

Les trois audits PF6 donnent le même score 86, zéro TBT, 24 requêtes et zéro
fragment ou appel Firebase sur le parcours IWC local.

### Desktop

| Indicateur | PF0 | PF6 | Évolution |
| --- | ---: | ---: | ---: |
| Score Performance | 99 | 99 | stable |
| FCP | 609 ms | 454 ms | -155 ms · -25,5 % |
| LCP | 892 ms | 943 ms | +51 ms · +5,7 % |
| Speed Index | 643 ms | 628 ms | -15 ms · -2,3 % |
| Temps interactif | 896 ms | 945 ms | +49 ms · +5,5 % |
| Total Blocking Time | 0 ms | 0 ms | stable |
| CLS | 0,000485 | 0,000084 | -82,7 % |
| Travail du thread principal | 168 ms | 148 ms | -20 ms · -12,0 % |
| Transfert total | 697 056 o | 403 687 o | -293 369 o · -42,1 % |
| Requêtes | 26 | 24 | -2 · -7,7 % |

Le léger écart desktop de LCP et de temps interactif, environ 50 ms, est
explicitement conservé dans le rapport. Il ne change pas le score 99 et reste
dans une amplitude faible de laboratoire ; il n'est pas masqué comme un gain.

## Parcours chauds dans le navigateur

Les durées vont de la navigation ou du clic piloté au premier état DOM
vérifiable. Elles incluent le coût de l'outil et ne sont pas des INP terrain.

| Parcours | PF0 | PF6 | Résultat |
| --- | ---: | ---: | --- |
| Ouverture IWC, médiane de 3 | 344–348 ms | 365 ms | stable, +17 à +21 ms |
| Couverture → Médias, médiane de 3 | 3 090 ms | 3 041 ms | -49 ms |
| Médias → lecteur 360°, médiane de 3 | 400 ms | 271 ms | -129 ms · -32,3 % |
| Ouverture directe Galerie authentifiée, médiane de 3 | 759 ms | 769 ms | stable, +10 ms |
| Galerie → diaporama IWC, médiane de 3 | 292–311 ms | 265 ms | -27 à -46 ms |

Les ressources étaient déjà en cache pour ces répétitions. La référence froide
reste donc Lighthouse ; la série navigateur sert au contrôle des transitions
chaudes et des états fonctionnels.

## Causes, corrections et verrous

| Vague | Cause | Correction | Verrou principal |
| --- | --- | --- | --- |
| PF1 | miniatures vidéo et préchargement 360° concurrents | posters sans `<video>`, activation explicite, file bornée à deux | zéro vidéo au repos et concurrence maximale testée |
| PF2 | balayage global des textareas et layout forcé | `AutoResizeTextarea` local à chaque champ | montage, valeur hydratée, saisie et absence de `querySelectorAll` |
| PF3 | aucun pixel avant restauration privée | shell immédiat puis hydratation locale → Auth → cloud | ordre, délais, hors-ligne et absence d'écriture par défaut |
| PF4 | JPEG surdimensionnés et découverte tardive des polices | dérivés AVIF/WebP responsive, originaux intacts, liens de polices dans le `head` | 19 empreintes sources et 152 dérivés vérifiés |
| PF5 | Firebase chargé sur le Cartulaire IWC local | Auth, cloud, projections et médias privés importés à la demande | zéro requête Firebase initiale et parcours distant conservé |
| PF6 | recette dispersée et deux cas d'accessibilité non verrouillés | build/mesure isolés, commande `test:pf6`, tests clavier et mouvement réduit | replay global et rapport PF0→PF6 reproductible |

## Recette fonctionnelle

- Cartulaire IWC : titre, couverture, W/R/C, champs privés et navigation rendus.
- Cartulaire Rolex hors ligne : identité Rolex et dossier privé rendus ; photo
  absente signalée explicitement, sans reprendre de contenu IWC.
- Médias : zéro vidéo au repos et dans les miniatures ; lecteur 360° absent
  avant activation puis rendu avec 14 vues et contrôles.
- Clavier : fermeture des modales 360° et Galerie avec `Escape` vérifiée dans le
  navigateur ; rotation gauche/droite verrouillée par test DOM.
- Mouvement réduit : rotation automatique retirée lorsque
  `prefers-reduced-motion: reduce` est actif, directions manuelles conservées.
- Registre authentifié sur émulateurs : deux projections autorisées, une montre
  et un véhicule, sans agrégation de données patrimoniales supplémentaires.
- Galerie : deux cartes, repli véhicule explicite, couverture IWC, diaporama de
  six vues et zéro vidéo.
- Mobile 390 px : audits froids exécutés avec CLS 0,000111 et TBT nul ; les
  comportements responsive PF1 à PF5 restent couverts par leurs tests et
  recettes précédentes.

## Build et tests

Le build a été écrit dans `/private/tmp/cartularia-pf6.u5zO9c`, jamais dans le
`dist/` partagé.

| Artefact | PF6 | Budget |
| --- | ---: | ---: |
| Entrée | 199 805 o | 250 000 o |
| Cartulaire `App` | 302 972 o | 320 000 o |
| Shell `RegistryApp` | 36 321 o | 60 000 o |
| Plus gros fragment Firebase | 488 183 o | 500 000 o |
| JavaScript total | 1 432 320 o · 425 214 o gzip | information |

Commandes réussies :

- `npm run test:pf6` ;
- `npm run test:ux-wave5` ;
- `npm run measure:ux-wave5 -- /private/tmp/cartularia-pf6.u5zO9c` ;
- `npm run measure:pf0 -- /private/tmp/cartularia-pf6.u5zO9c` ;
- `npm run validate:ai` ;
- `npm run lint` ;
- `npm run schema:check` ;
- `npm run build -- --outDir /private/tmp/cartularia-pf6.u5zO9c` ;
- `git diff --check`.

## Limites et suite

- Les parcours Registre/Galerie authentifiés ont été validés uniquement avec
  Auth, Firestore et Storage émulés et des fixtures locales.
- Le mouvement réduit est verrouillé par test injecté ; la surface navigateur
  disponible ne permettait pas de basculer la préférence système réelle.
- Aucun INP terrain, Safari, Firefox, impression système ou session Firebase de
  production n'a été certifié par PF6.
- Google Fonts demeure une dépendance tierce. L'auto-hébergement requiert des
  fichiers WOFF2 licenciés, versionnés et correctement sous-ensemblés.
- Aucun déploiement Hosting, aucune écriture Storage/Firebase de production,
  aucune règle, autorisation, route, clé persistée, décision W/R/C ou schéma
  métier n'a été modifié.
