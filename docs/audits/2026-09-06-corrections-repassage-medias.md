# Repassage — corrections médias C08, C09, C10

Exécution locale du 6 septembre 2026. Aucun déploiement, seed, compte ou document distant modifié par ce lot. Le journal global reste l’autorité sur la livraison.

## Corrections

- **C08** : les métadonnées, textes et pages du mini-site sont retournés sans téléchargement Storage. Les photos sont chargées à leur apparition ; la vidéo publique exige « Charger la vidéo » ; les PDF et téléchargements ne sont résolus qu’à la demande. Le lecteur 360° charge l’angle courant et attend sa résolution avant de poursuivre la lecture automatique.
- **C09** : une photo privée en échec offre une nouvelle tentative. Une vignette déjà ouvrable ne contient pas de bouton imbriqué : son ouverture relance le chargement dans le lecteur. Réseau, session absente, droit refusé, fichier absent et défaut d’intégrité ont des messages distincts.
- **C10** : une référence publique non encore chargée n’est plus présentée comme une copie absente. Les erreurs Storage sont conservées dans les composants et permettent un nouvel essai par fichier.
- **Retour arrière/avant** : les caches ne révoquent pas les URL d’une page conservée dans le bfcache ; ils les libèrent au vrai départ. Une réponse terminée après destruction du cache est également révoquée.
- **Confort** : suppression des listes exhaustives répétées sous chaque bloc ; fichier direct au bon endroit, bibliothèque dédupliquée, vues 360° dans une liste repliable. Les blocs interactifs utilisent la pleine largeur et les reprises possèdent des cibles tactiles de 44 px.

## Transport et limites

Le nouveau résolveur public utilise `getBlob` du SDK Firebase Storage : chaque chargement non mis en cache reste contrôlé par les Rules. Aucune URL bearer, URL signée ni permission Storage supplémentaire n’est créée. Les chemins acceptés sont exclusivement des dérivés publics canoniques ; les URL arbitraires et chemins privés sont refusés.

Les téléchargements publics sont mutualisés par chemin et empreinte, avec deux requêtes simultanées. Les URL sont retenues par baux pendant leur usage ; le cache inactif est limité à huit entrées et 48 Mio. Les gros fichiers encore affichés ne sont pas révoqués pour satisfaire un budget de cache ; le plafond serveur de publication reste distinct. Les empreintes SHA-256 valides fournies sont vérifiées avant création de l’URL locale.

La préparation de l’impression est intégrée séparément dans `App.tsx` par le lot principal. `PrivateMediaImage` expose `data-media-state=loading|ready|error`, avec `ready` après le vrai événement de chargement de l’image. Sa propriété `eager` permet une préparation explicite dans un rapport masqué. Un contrôle DOM/test ne remplace pas une inspection d’un PDF réellement enregistré.

## Invités : limitation explicitée, non clôturée

Le chargeur reconnaît un invité consultant un dossier tiers et explique qu’aucune copie média autorisée pour les invités n’est raccordée dans ce parcours. Il ne lit jamais le manifeste ni l’original sous l’UID du propriétaire et ne transforme pas une invitation en droit sur ses originaux.

**Reste à réaliser** : chaîne de dérivés privés autorisés par la portée réelle de l’invitation, retrait de ces accès, fichiers historiques et recette sur deux appareils sans cache. Ce lot n’a ni créé cette chaîne ni rendu le parcours invité média complet.

## Vérifications

- 50 tests ciblés d’interface/services/cache réussis dans 12 fichiers au point de consolidation du lot.
- Couverture nouvelle : texte immédiatement disponible sans Storage ; vidéo sans téléchargement automatique ; téléchargement explicite avec nom ; refus des chemins privés/arbitraires ; concurrence limitée à deux et mutualisation ; erreur suivie d’une reprise ; intégrité ; bfcache et destruction ; refus invité sans lecture de l’original ; photo en échec puis rétablie ; absence de boutons imbriqués ; déduplication.
- TypeScript et `git diff --check` réussis. Aucun avertissement lint propre au lot.
- Les appels Firebase des nouveaux tests sont simulés. Aucune recette nouvelle d’autorisation Storage distante, d’invitation réelle, de mobile ou de bfcache dans Chrome/Safari n’est revendiquée.

Fichiers principaux : `src/services/projections.ts`, `publicMedia.ts`, `privateMedia.ts`, `src/hooks/useMediaSource.ts`, `src/components/PrivateMediaImage.tsx`, `MediaVideo.tsx`, `MediaDownloadLink.tsx`, `ProjectedPublicBlock.tsx`, `Spin360.tsx`, helpers de cache/erreurs et tests sous `tests/ui`.
