# PF0 — Baseline de fluidité

Date : 18 août 2026.

## Résultat

PF0 établit une référence locale reproductible sans modifier le produit ni écrire en production. Le build de recette est isolé dans `/private/tmp/cartularia-pf0-dist` afin de ne pas partager `dist/` avec les travaux Hosting ou les autres recettes en cours.

Le parcours authentifié utilise uniquement les émulateurs définis dans `firebase.pf0-test.json`, avec les fixtures IWC et véhicule. Les identifiants émis par `seed:foundations` sont des identifiants locaux de démonstration et ne doivent jamais être présentés comme un accès de production.

## Mesures statiques du build isolé

Les budgets restent ceux de la vague UX 5.

| Artefact | Mesure | Budget | Résultat |
| --- | ---: | ---: | --- |
| Entrée | 197 010 o | 250 000 o | Conforme |
| Cartulaire `App` | 298 140 o | 320 000 o | Conforme |
| Shell `RegistryApp` | 36 109 o | 60 000 o | Conforme |
| Plus gros chunk, Firebase | 488 183 o | 500 000 o | Conforme |
| JavaScript total | 1 415 561 o, 418 707 o gzip | information | 38 fichiers |
| CSS total | 201 540 o, 28 456 o gzip | information | 2 fichiers |

Commande de verrouillage :

```bash
npm run measure:pf0 -- /private/tmp/cartularia-pf0-dist
```

## Lighthouse — ouverture du Cartulaire

Médiane de trois passages sur le build local de production. Le profil mobile applique la simulation Lighthouse ; les valeurs ne sont pas des données de terrain.

| Mesure | Mobile | Desktop |
| --- | ---: | ---: |
| Score Performance | 75 | 99 |
| FCP | 2 692 ms | 609 ms |
| LCP | 5 718 ms | 892 ms |
| Speed Index | 2 692 ms | 643 ms |
| Temps interactif | 5 747 ms | 896 ms |
| Total Blocking Time | 0 ms | 0 ms |
| CLS | 0,000298 | 0,000485 |
| Travail thread principal | 733 ms | 168 ms |
| Transfert total | 747 664 o | 697 056 o |
| Requêtes | 31 | 26 |

Constats Lighthouse prioritaires :

- le LCP est la photo de couverture IWC ; le fichier 1 200 × 800 est affiché autour de 578 × 385 et Lighthouse estime 96 144 octets évitables avec une image responsive ;
- la chaîne CSS → Google Fonts est bloquante, avec un gain de laboratoire estimé à environ 540 ms sur le FCP ;
- environ 203 Kio de JavaScript sont signalés comme inutilisés au premier affichage, dont environ 131 Kio dans le chunk Firebase ;
- aucune longue tâche bloquante n’augmente le TBT et le CLS reste quasi nul.

## Mesures navigateur locales

Les durées ci-dessous vont de la navigation ou du clic piloté jusqu’au premier état DOM vérifiable. Elles incluent le coût de l’automatisation et servent uniquement de référence de non-régression locale.

| Parcours | Desktop | Mobile | État vérifié |
| --- | ---: | ---: | --- |
| Cartulaire → couverture, médiane de 3 | 344 ms | 348 ms | 3 images visibles, 0 vidéo |
| Registre → Galerie, médiane de 3 | 759 ms | 758 ms | 2 cartes, 1 couverture, 1 repli explicite, 0 vidéo |
| Galerie → diaporama IWC | 311 ms | 292 ms | image principale visible, 6 commandes de vignettes, 0 vidéo |
| Couverture → page Médias | 3 090 ms | 3 087 ms | durée bout en bout de l’outil, non assimilable à un Web Vital |
| Médias → lecteur 360° | 400 ms | non répété | lecteur visible ; chargement complet indiqué après 1,6 s |

## Inventaire média observé

- La page Médias n’instancie pas le lecteur 360° avant le clic : le report d’activation est déjà en place.
- Après activation, `Spin360` lance néanmoins les 14 chargements avec une boucle `forEach`, sans limite de concurrence.
- La page Médias contient 27 images déclarées `loading="lazy"`.
- Trois balises vidéo de miniatures restent présentes avec `preload="metadata"`.
- La Galerie charge une seule couverture pour deux Cartulaires ; le véhicule reste accessible avec un état protégé « image indisponible ».
- Le diaporama IWC expose six vignettes et une image de scène, sans balise vidéo.

## Anomalies séparées des mesures

1. Le Cartulaire déclenche des lectures répétées de `cartularySyncRequests/{cartularyId}` refusées par les règles de l’émulateur. Treize avertissements ont été observés en environ 56 secondes, avec reprise progressive. Cette activité réseau parasite la baseline et doit être arbitrée avant d’interpréter finement les gains de PF1.
2. Un premier essai sur le `dist/` partagé a échoué au chargement dynamique de `Spin360` parce qu’un autre build avait remplacé les fichiers hashés. Le build isolé n’a pas reproduit cet échec ; il s’agissait d’un conflit d’artefacts de recette, pas d’un défaut établi du composant.
3. Le moteur du navigateur intégré n’expose pas directement `PerformanceObserver`. Les Core Web Vitals de laboratoire proviennent donc de Lighthouse ; INP devra être mesuré par une instrumentation de terrain ou un flow Lighthouse dédié.

## Protocole reproductible

1. Démarrer les émulateurs isolés :

```bash
JAVA_HOME=/chemin/vers/java-21 npx --yes firebase-tools emulators:start \
  --config firebase.pf0-test.json \
  --project studio-2614005370-a3e51 \
  --only auth,firestore,storage
```

2. Peupler uniquement les émulateurs avec `seed:foundations`, `import:iwc`, `project:iwc:wave3`, `import:car-demo` et `project:car:wave4`, en pointant les variables `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST` et `FIREBASE_STORAGE_EMULATOR_HOST` vers les ports PF0.

3. Construire hors du `dist/` partagé :

```bash
VITE_USE_FIREBASE_EMULATORS=true \
VITE_FIREBASE_EMULATOR_HOST=127.0.0.1 \
VITE_FIREBASE_AUTH_EMULATOR_PORT=19099 \
VITE_FIREBASE_FIRESTORE_EMULATOR_PORT=18081 \
VITE_FIREBASE_STORAGE_EMULATOR_PORT=19199 \
./node_modules/.bin/vite build --outDir /private/tmp/cartularia-pf0-dist
```

4. Servir ce build avec `vite preview --outDir /private/tmp/cartularia-pf0-dist`, puis répéter trois fois les profils mobile et desktop.

## Périmètre et limites

- aucune donnée, règle ou autorisation Firebase de production n’a été modifiée ;
- aucun déploiement Hosting ou Storage n’a été exécuté ;
- les valeurs réseau dépendent du poste local et de la simulation Lighthouse ;
- PF0 documente les causes candidates mais n’applique aucune optimisation produit ; celles-ci relèvent de PF1 et des vagues suivantes.
