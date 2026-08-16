# Vague corrective 1 — Intégrité du Cartulaire local

## Résultat

Cette vague reconnecte l’interface React à une preuve portant sur le contenu réellement affiché et modifiable. Elle remplace le journal local historique par un journal `cartularia-integrity-v2` :

- instantané canonique `jcs-1` de l’identité, des métadonnées média, de la référence, de l’état, de la valeur et des sélections W/R/C ;
- empreinte SHA-256 du contenu et empreintes par section ;
- révision monotone à chaque changement d’état canonique ;
- événements chaînés par `previousHash`, séquencés et idempotents ;
- sérialisation des écritures entre instances et onglets avec Web Locks lorsqu’il est disponible ;
- racine de Merkle réelle calculée sur les empreintes d’événements ;
- export JSON portable incluant l’instantané, la chaîne et les reçus ;
- vérificateur Node indépendant du code navigateur ;
- conservation des anciens journaux, avec classement `legacy_valid`, `legacy_broken` ou `legacy_unverifiable`.

Une chaîne historique rompue n’est jamais effacée ni recalculée pour paraître valide. La commande de migration l’archive avec son empreinte et son statut, démarre une nouvelle chaîne, puis y enregistre l’état courant.

## Portée de l’instantané

L’instantané couvre les données métier actuellement pilotées par `App.tsx`. Pour les médias et documents, il couvre les métadonnées présentes dans l’état React — identifiant, nom, type, empreinte déclarée, statut, visibilité, tags, taille et horodatages disponibles — mais pas les octets des blobs locaux. Les sélections de publication W, rapport R et communauté C sont incluses et triées avant canonisation.

Les consultations, impressions et exports sont journalisés comme événements sans créer artificiellement une nouvelle révision de contenu. Plusieurs changements effectués dans la fenêtre de 450 ms peuvent être regroupés dans une seule révision : la preuve porte alors sur l’état final du groupe.

## Vérification

Tests de concurrence, rejeu, retour à un ancien contenu, altération, migration et export :

```bash
npm run test:corrective-wave1
```

Après avoir téléchargé un export depuis le panneau Intégrité :

```bash
npm run integrity:verify-local -- --input=/chemin/preuve-integrite.json
```

La commande retourne `valid: true` seulement si la chaîne, la révision, l’empreinte du contenu, la racine de Merkle, les archives historiques et les reçus locaux sont cohérents. Elle retourne un code de sortie non nul après toute altération détectée.

## Limites explicites

Cette vague apporte la détection cryptographique d’incohérence, pas encore une preuve d’existence opposable :

- `localStorage` reste modifiable par une personne ayant accès au navigateur ; sans copie externe d’une ancienne tête, elle peut remplacer simultanément contenu et chaîne ;
- le reçu `local-timestamp-fixture-v2` est un reçu de test, porte `qualified=false` et n’est ni RFC 3161 qualifié, ni eIDAS ;
- aucune racine n’est encore ancrée sur une blockchain publique ;
- aucune signature d’utilisateur ou d’organisation ne lie juridiquement l’événement à une identité ;
- une empreinte prouve la stabilité des données enregistrées, pas la vérité, l’authenticité ou la propriété de l’objet décrit ;
- les octets des médias devront être réingérés et empreintés côté cloud pour que leur contenu binaire entre dans la preuve.

L’horodatage qualifié, l’ancrage externe et le lien avec la chaîne Firebase autoritaire appartiennent aux vagues suivantes. L’interface doit conserver ces limites tant qu’ils ne sont pas effectivement activés.
