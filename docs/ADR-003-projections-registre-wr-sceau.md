# ADR-003 — Projections Registre, W/R, Sceau et dérivés

Date : 14 août 2026
Statut : adopté et vérifié dans les émulateurs ; aucune publication distante déclenchée

## Décision

Le Cartulaire maître reste exclusivement sous `cartularies/{cartularyId}`. Le Registre, le Watch website, les rapports R et le Sceau lisent des projections physiquement séparées, produites par des commandes Admin transactionnelles.

Les emplacements sont :

- `registries/{registryId}/items/{cartularyId}` pour la carte privée du Registre ;
- `publications/{publicCode}` et `blocks/{blockId}` pour les quatre blocs W ;
- `cartularies/{cartularyId}/reportProjections/{reportId}` pour un rapport R privé ;
- `seals/{publicCode}` pour le Sceau public minimal ;
- `public/{publicCode}/{assetId}/{derivativeId}` pour un dérivé Storage publiable.

## Autorité et concurrence

- Seul un membership actif portant le rôle `legal_owner`, la permission `publication.manage` et le Registre dans sa portée peut approuver ou exécuter une projection.
- W et R exigent un document `publicationApprovals` marqué `decisionSource: human_confirmed`.
- Une approbation est liée à `sourceRevision` et devient inutilisable dès que la révision du Cartulaire évolue.
- Chaque commande porte `requestId` et `expectedRevision`, produit un reçu idempotent, incrémente la révision et ajoute un événement au journal chaîné.
- Le client ne peut écrire ni projection, ni approbation, ni Sceau, ni journal.

## Liste blanche publique

Le premier incrément exige exactement quatre blocs W. `cover-owner`, `cover-transmission`, `cover-storage`, `value-cost-basis` et `value-performance` ne figurent pas dans la liste blanche publique. Une inspection récursive rejette aussi les clés ou valeurs portant des marqueurs de série, identité, adresse, contact, acquisition, stockage, transmission, original privé ou URL de téléchargement.

Le document public contient uniquement les blocs sélectionnés, leur `sourceRevision`, `publicationStatus`, `generatedAt`, `contentHash` et les métadonnées minimales des dérivés. Il ne contient jamais de lien vers un original.

## Dérivés et révocation

Un dérivé n’est projetable que si sa métadonnée privée indique `visibility: public`, `processingState: ready`, le même `publicCode`, une empreinte réelle et un chemin `public/{publicCode}/...`. Storage n’autorise que la lecture de ce chemin lorsque la publication Firestore correspondante est `published` et que les métadonnées objet concordent.

Le client télécharge les octets avec le SDK (`getBlob`) et crée une URL objet éphémère dans le navigateur. Il ne demande ni ne persiste de jeton `getDownloadURL`, afin de ne pas créer un lien durable contournant la logique de révocation.

La révocation :

- passe la publication à `revoked` ;
- supprime les blocs publics ;
- passe le Sceau à `revoked` ;
- invalide immédiatement les lectures du dérivé par la règle Storage ;
- ajoute une révision et un événement canonique.

## Limites assumées

- Les 22 médias IWC importés restent `pending_binary_reingest`. Le test de dérivé utilise un objet contrôlé dans l’émulateur ; aucune image fictive du prototype n’est promue comme preuve.
- Le Cartulaire IWC réel reçoit automatiquement sa projection Registre, mais aucune sélection W/R réelle n’est fabriquée : l’import non vérifié ne vaut pas décision humaine.
- Les événements historiques `sorted-json-1` restent vérifiables ; la vague 6 applique désormais `jcs-1` à toute nouvelle commande.
