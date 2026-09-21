# P5 — Imports cohérents, atomiques et bornés

Date d’achèvement : 21 septembre 2026. Travail commencé le 18 septembre puis repris après interruption. Périmètre : prompt 5 de `2026-09-18-assessment-code.md`, constat F06. Changements locaux uniquement ; aucun commit, push, déploiement Firebase ni accès aux données de production.

## Cause et politique retenue

Les médias, pièces d’état et rapports étaient enregistrés fichier par fichier avant l’ajout de leurs références dans l’état du Cartulaire. L’échec d’un autre fichier du même lot pouvait donc laisser un original local `dirty` sans référence visible. Les médias et pièces d’état étaient en outre hachés avant le contrôle complet du format et de la taille, sans limite commune de concurrence.

P5 retient une politique explicite d’**atomicité du lot** : tous les fichiers sélectionnés réussissent ensemble, ou aucun original ni aucune référence de ce lot n’est ajouté. Les fichiers et références préexistants ne sont jamais supprimés par l’échec d’un nouveau lot.

## Correction

### Préparation bornée avant toute écriture

- Les trois portes d’entrée utilisent le même pipeline : médias, pièces d’état et rapports de référence.
- Chaque fichier est d’abord inspecté sur un préfixe de 4 096 octets : taille, signature, extension, MIME canonique et catégorie autorisée.
- Aucun fichier du lot n’est lu intégralement ni haché tant que toutes les inspections du lot n’ont pas réussi.
- Le hachage et la préparation sont limités à **deux fichiers simultanés**, plafond partagé entre les trois portes d’entrée.
- Les tâches déjà commencées sont attendues après un échec afin de révoquer également les URL objet qu’elles auraient créées tardivement. Les tâches encore en attente ne démarrent pas leur lecture intégrale.

### Commit local atomique

- La préparation ne persiste rien. Elle produit des références, des originaux validés et des URL d’aperçu temporaires.
- `CartulariaLocalVault.commitImport` écrit les blobs et la liste de références dans une unique transaction IndexedDB `readwrite` couvrant les deux magasins.
- Les originaux emploient `add`, et non `put` : une collision d’identité annule le lot au lieu de remplacer un fichier existant.
- Le backend mémoire applique la même sémantique pour les tests.
- Un refus de quota, un refus d’écriture, une fermeture de session, une collision ou une erreur de fusion laisse l’état et les fichiers antérieurs inchangés.
- Une reprise après échec ne duplique rien, car l’échec ne laisse aucune écriture du lot. Un lot déjà commis avec les mêmes identifiants est refusé.

### Cohérence React, onglets et aperçus

- Les références sérialisées ne contiennent aucune URL `blob:` ; l’interface restaure les aperçus en mémoire après le commit.
- Les URL créées par un lot refusé, une préparation tardive, un démontage ou un verrouillage sont révoquées. Les URL importées ou distantes que le hook n’a pas créées ne le sont jamais.
- Une URL retirée pendant la fenêtre d’annulation reste vivante jusqu’à restauration ou expiration de cette fenêtre.
- Une seule soumission de formulaire est admise à la fois, y compris deux soumissions dans le même tour d’événement.
- Les modifications React reçues pendant le commit sont rejouées après celui-ci.
- Un marqueur `localImportVersion` empêche un ancien rendu ou un autre onglet de réécrire une liste antérieure par-dessus un import. La saisie refusée est conservée dans la quarantaine locale pour reprise manuelle.

## Validation

- `npm run test:imports:unit` : **30/30**.
- `npm run test:imports:client` : **55/55**, 4 fichiers.
- `npm run test:imports:browser` : **19/19** dans une vraie instance Chrome isolée, avec deux connexions IndexedDB. Le premier lancement dans le bac à sable n’a pas pu ouvrir le port DevTools ; le même test autorisé hors bac à sable a réussi intégralement.
- Suite UI complète : **699/699**, 106 fichiers.
- Régression synchronisation/reprises : **125/125**.
- Régression Node V3 à V7 : **426/429**, 50 fichiers. Les trois échecs sont antérieurs à P5 : le contrat `NEVER_INCOMPLETE` de l’audit d’accessibilité et deux assertions de `demo-account.test.mjs` sur l’ancienne organisation de l’accueil.
- TypeScript, lint, build Registre, build Coffre, catalogue IA de 85 postes et `git diff --check` : réussis.
- La mesure de concurrence observe un maximum de **2** traitements, dans un lot comme entre trois imports simultanés.

Commandes reproductibles :

```sh
npm run test:imports
npm run test:ui
npm run test:sync-recovery:unit
npm run lint
npm run build
npm run build:personal
npm run validate:ai
git diff --check
```

## Limites

- Après validation, le SHA-256 lit encore chaque fichier entier en mémoire. Le plafond de deux borne cette consommation, mais P5 n’introduit pas de hachage par flux.
- L’atomicité couvre le coffre local IndexedDB et ses références locales. La synchronisation ultérieure vers Firestore et Storage reste le processus récupérable de P4 ; il ne s’agit pas d’une transaction distribuée.
- Le mécanisme empêche les doublons après l’échec d’un lot. Il ne déduplique pas volontairement deux imports réussis distincts ayant le même contenu mais des identifiants différents.
- Aucun compte réel, donnée métier, émulateur Firebase ou environnement de production n’a été utilisé pour P5.
- Les builds signalent encore les avertissements existants de chunks supérieurs à 500 kB.

## Fichiers touchés par P5

Les modifications antérieures de l’accueil et de P1 à P4 ont été préservées. P5 intervient dans les fichiers suivants seulement :

- `package.json`
- `src/App.tsx`
- `src/features/cartulary/media/importMediaFiles.ts`
- `src/features/cartulary/media/useAtomicFileImport.ts` (nouveau)
- `src/features/cartulary/media/useLocalMediaHydration.ts` (nouveau)
- `src/features/cartulary/state/useCartularyConditionState.ts`
- `src/features/cartulary/state/useCartularyMediaState.ts`
- `src/features/cartulary/state/usePersistentCartularyState.ts`
- `src/persistence/localVault.ts`
- `tests/local-vault-import.test.mjs` (nouveau)
- `tests/local-vault-indexeddb.test.mjs`
- `tests/ui/cartulary-import-transaction.test.tsx` (nouveau)
- `tests/ui/cartulary-state-hooks.test.tsx`
- `tests/ui/import-media-files.test.ts`
- `tests/ui/local-media-hydration.test.tsx` (nouveau)
- `docs/audits/2026-09-21-p5-imports-atomiques.md` (ce rapport)
