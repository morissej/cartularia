# ADR-029 — IWC et Rolex sortent du code : les Cartulaires pilotes sont des données

- Statut : accepté
- Date : 2026-09-08
- Précise : ADR-026 (gabarit universel), ADR-028 (lecteur unique)

## Contexte

L’audit du 2026-09-07 comptait 87 conditions par identité dans `src/App.tsx`, dont une trentaine
sur `isIwcCartulary` et `isRolexCartulary` : contenus par défaut (points à contrôler, documentation,
spécifications, copie éditoriale, analyse de comparables, grille de sensibilité, titre d’origine),
profil de secours Rolex et comparables Rolex codés dans `src/data/activeCartulary.ts`, cas particulier
IWC dans la Galerie du Registre. Le dossier IWC était pourtant déjà seedé comme données du brouillon
privé par `scripts/update-iwc-dossier.mjs` ; le code ne faisait que le dupliquer. Rolex n’existait
qu’en code.

## Décision

1. **Aucune branche par marque dans l’application.** `App.tsx`, `activeCartulary.ts` et
   `registryGallery.ts` ne testent plus l’identité IWC ou Rolex. Les valeurs par défaut sont
   neutres ; le contenu d’un Cartulaire vient de son brouillon privé et de son enveloppe.
2. **IWC est complété comme données.** `update-iwc-dossier.mjs` écrit désormais aussi
   `cartularia-creation-profile`, `cartularia-public-code`, `cartularia-sensitivity-prices` et le
   titre d’origine (`editableCopy.originTitle`), pour que le Cartulaire complet n’ait plus besoin
   d’aucun repli codé.
3. **Rolex devient une fixture de seed.** `src/migrations/rolexImport.ts` porte le bundle
   autoritaire (mêmes sections et champs que la création depuis le Registre) et l’état du brouillon
   privé ; `scripts/import-rolex-cartulary.mjs` (`npm run import:rolex`) importe, projette et
   synchronise, de façon idempotente. L’application n’importe jamais ce module.
4. **Le titre d’origine est une donnée éditoriale** : `originTitle` s’ajoute à la copie éditable,
   avec le repli neutre « Histoire de la référence … ».
5. **La grille de sensibilité par défaut** se dérive de la profondeur de marché enregistrée.
6. **Les spécifications enregistrées sont fusionnées** dans la structure par défaut pour tout
   Cartulaire, sans exception IWC.

## Ce qui reste, et pourquoi

- `src/data/mockData.ts` reste la fixture du seed IWC (`iwcImport.ts`) et alimente la carte des
  aperçus déjà présents dans le bundle Hosting, indexée par Cartulaire et non par marque.
- `applicationBootstrap.ts` conserve l’hydratation autoritaire datée du dossier IWC
  (`iwc-source-dossier-2026-08-29-v1`) et `localVault.ts` ses migrations de stockage : ce sont des
  migrations à date fixe, pas des branches de présentation.
- `cartularyIds.ts` garde l’identifiant par défaut de `/cartulary` et la correspondance des codes
  publics du pilote ; les déplacer en données relève d’une décision de routage séparée.

## Conséquences

- En production, le Cartulaire IWC lit son contenu depuis le brouillon privé déjà seedé ; les trois
  clés ajoutées ne s’y trouvent que si `update:iwc-dossier` est rejoué avec `--allow-remote`. Sans
  elles, l’identité et le code public viennent de l’enveloppe (ADR-028) et la sensibilité de la
  profondeur de marché enregistrée.
- En production, le Cartulaire Rolex existe déjà (créé depuis le Registre) ; son contenu éditorial
  n’apparaît qu’après `import:rolex --allow-remote` avec `CARTULARIA_OWNER_UID` du propriétaire.
- En local, ajouter `npm run import:rolex` à la séquence de seed.

## Contrôle

`tests/rolex-import.test.mjs` : bundle Secret et conforme au catalogue, sections identiques à la
création depuis le Registre, couverture des clés lues par le lecteur, absence de branche par marque
dans `App.tsx`, `activeCartulary.ts` et `registryGallery.ts`. `tests/corrective-wave7.test.mjs`
interdit désormais `isIwcCartulary` et `isRolexCartulary`.
