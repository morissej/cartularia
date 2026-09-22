# P4 — Synchronisation et reprises après interruption

Date : 18 septembre 2026. Périmètre : prompt 4 de `2026-09-18-assessment-code.md`, constats F04 et F05. Changements locaux ; aucun commit, push, déploiement, migration ni accès aux données de production.

## Causes et comportement corrigé

### F04 — Acquittements et pulls conditionnés à une version locale

L'ancien acquittement relisait une entrée puis la marquait propre, sans vérifier qu'elle était celle envoyée. La saisie B pouvait donc être nettoyée par la réponse à l'envoi A. Les pulls, les téléchargements de cache et les résolutions de conflit avaient une course comparable.

Chaque mutation de contenu reçoit désormais un `localVersion` UUID ; une `localLineage` durable distingue aussi une entrée supprimée puis recréée d'une ancienne entrée. Ces informations restent locales. Les anciennes entrées reçoivent ces identifiants atomiquement avant exposition aux synchroniseurs.

Une intention de saisie conserve immédiatement son payload sous un UUID distinct dans le stockage local du compte. Un compteur par clé et un reçu enregistré atomiquement dans IndexedDB permettent de rejouer une saisie après fermeture de son onglet, sans rejouer une ancienne intention déjà consommée. Après commit, le payload temporaire est remplacé par un checkpoint compact. Les projections cloud ne modifient jamais les intentions. Le miroir brut ne réimporte pas une ancienne valeur d’une entrée déjà versionnée ; le journal d’intégrité passe lui aussi par les écritures versionnées.

Les acquittements, pulls, insertions et résolutions utilisent le snapshot capturé avant l'opération réseau. Le backend IndexedDB compare puis écrit dans une même transaction `readwrite`, commune aux connexions de plusieurs onglets. Le backend mémoire suit la même sémantique. Une réponse obsolète peut avancer la révision cloud de sa propre lignée, mais conserve les modifications plus récentes en `dirty`. Elle ne peut pas diminuer une révision déjà dépassée ni rattacher un ancien chemin à un nouveau binaire. Un pull rejeté ne produit pas de notification prétendant qu'il a été appliqué.

La réhydratation initiale et le cache des originaux emploient les mêmes conditions. Une résolution explicite peut remplacer la version locale capturée ; elle est refusée si une autre saisie est intervenue pendant l'attente. La réhydratation dite autoritaire ne remplace plus un état local déjà modifié.

Les remplacements et suppressions de fichiers portent également une intention ordonnée et un reçu local atomique, sans copier le Blob dans localStorage. Une ancienne opération retardée puis verrouillée ne peut ni remplacer ni supprimer le fichier plus récent d’un autre onglet. Une suppression devenue obsolète est refusée explicitement.

Le résultat `pending` conserve un compteur d'entrées à envoyer et déclenche un nouveau passage du hook. L'interface garde « synchronisation en cours », sans afficher une nouvelle date de sauvegarde réussie. Le rapport rejoue aussi les intentions laissées par un autre onglet fermé et relit les modifications locales après les dernières attentes distantes.

### F05 — Transfert et validation sont deux étapes distinctes

Le décideur distingue le manifeste à reprendre (`pending_upload`), la validation à attendre (`verifying`/`processing`), l'acceptation attestée et le refus. Un manifeste identique ne suffit plus à acquitter le binaire.

La reprise lit les métadonnées Storage. Si l'original existe, elle le réutilise ; si l'objet manque, elle exige la copie locale pour reprendre son envoi. Une réponse d'upload perdue ou un autre onglet ayant déjà terminé l'envoi provoque une relecture de l'objet, jamais un écrasement ou une suppression de l'original pour réessayer.

L'acquittement final exige une attestation P3 correspondant au propriétaire, au Cartulaire, au binaire, au chemin, au hash, à la taille, au bucket et à la génération observée. Une disparition, substitution, erreur, attente expirée ou absence d'original local nécessaire reste un échec explicite. Un refus de sécurité n'est pas remis en attente automatiquement. Un nom de fichier modifié pendant une reprise reste à envoyer jusqu'à l'écriture effective de ce nom dans le cloud.

### Vérification serveur récupérable

Le serveur attribue un bail de dix minutes, supérieur au timeout de 540 secondes du worker. Les champs `verificationLeaseExpiresAt`, `verificationRetryAfter` et `verificationRetryCount` sont réservés au serveur, avec le jeton de tentative P3. Le traitement vérifie son bail et son identité avant les dérivés et avant l'acceptation transactionnelle.

Un worker arrêté peut être remplacé après expiration. Un ancien worker qui reprend ne peut pas écraser le résultat de son successeur ; les écritures Storage gardent leurs préconditions de génération. Un événement rejoué sur un fichier accepté ne dégrade pas son acceptation.

Les erreurs techniques de stockage, réseau ou traitement sont récupérables, avec un délai exponentiel de 30 secondes à 15 minutes. Elles ne deviennent ni un succès ni un rejet de sécurité par dépassement arbitraire d'un nombre de tentatives. Les erreurs déterministes de signature, identité ou contenu restent des refus définitifs. Le déclencheur de finalisation active le retry et relaie les tentatives différées. Le rattrapage quotidien sait reprendre les traitements expirés, y compris ceux de l'ancienne version dépourvus de bail.

### Deux intégrations de suppression vérifiées

Les règles P3 interdisent la suppression physique des manifestes acceptés. Le chemin « supprimer tout » écrit désormais leurs tombstones autorisés avant de supprimer les objets, puis marque le brouillon supprimé. Les états ordinaires restent supprimables.

Après une interruption entre tombstone et suppression Storage, les deux chemins de suppression retrouvent le chemin canonique à partir du hash, même si l'upload initial n'avait pas encore été acquitté localement. La suppression n'est donc pas marquée réussie alors que l'original reste présent. Cela concerne uniquement une suppression demandée par l'utilisateur ; les reprises de transfert/vérification préservent toujours l'original. Ces scénarios ont été exécutés sur des données synthétiques uniquement.

## Validation

- Tests unitaires ciblés : **125/125**, coffre local, versions, décideur, vérification serveur, migration P3 et dérivés.
- Tests client ciblés : **58/58**, dont promesses différées, saisies pendant envoi/pull/résolution, réouverture, timeouts, réponse perdue après transfert, renommage et suppressions interrompues.
- Émulateurs réels : **68/68**, règles Firestore, règles Storage et vérification privée. Cinq scénarios supplémentaires comprennent deux arrêts réels par `SIGKILL` avant lecture de l'original et après création des dérivés, le remplacement d'un worker et son retour tardif, le rattrapage et la protection des champs serveur.
- IndexedDB dans Chrome isolé : **15/15 tests, aucun ignoré** (14 scénarios et leur test parent). Deux vrais onglets et des points d’arrêt déterministes reproduisent les projections retardées, les pulls concurrents, la saisie entre contrôle et projection, la fermeture avant commit, le miroir obsolète et la reprise d’une écriture après verrouillage à horloge identique. Les courses supplémentaires révélées par ces scénarios sont corrigées, y compris le remplacement et la suppression de fichiers après verrouillage.
- Suite UI complète : **659/659**, 104 fichiers.
- Régression Node V3 à V7 : **441/444**, 51 fichiers. Les trois échecs sont les mêmes qu'avant P4 : un ancien contrat structurel d'accessibilité dans `cartulary-presentation-contract.test.mjs` et deux assertions sur l'ancienne organisation de la page d'accueil dans `demo-account.test.mjs` (F13/P9).
- Builds Registre et Coffre, TypeScript, lint et catalogue IA de 85 postes : réussis. Les avertissements existants de bundle supérieur à 500 kB restent présents.

Les suites ciblées sont partiellement incluses dans les suites globales ; leurs nombres ne doivent pas être additionnés comme des cas uniques.

Commandes reproductibles :

```sh
npm run test:sync-recovery:unit
npm run test:sync-recovery:client
npm run test:sync-recovery:browser
npm run test:sync-recovery:emulator
```

La recette navigateur utilise un profil Chrome temporaire, deux onglets locaux et aucun compte utilisateur. `CARTULARIA_CHROME` permet de préciser son exécutable ; en son absence, cette recette indique explicitement un test ignoré. La recette émulateur requiert Java 21 et utilise `firebase.p3-test.json`, projet synthétique `demo-cartularia-p3`. Sur ce poste, Java 21 a été sélectionné explicitement et le cache de configuration Firebase CLI placé dans un répertoire temporaire. Tous les émulateurs de la validation sont arrêtés en fin de commande.

## Limites et mise en service

- Le journal de saisie temporaire demande de l’espace local supplémentaire jusqu’au commit ; son checkpoint est ensuite compacté. Le test de quota vérifie qu’un refus avant journalisation conserve la valeur et le checkpoint précédents.
- Rien n'a été déployé : les nouveaux retries et baux ne sont pas actifs sur Firebase tant que les Functions et règles correspondantes ne sont pas publiées.
- Le retry des nouveaux événements et le rattrapage des anciennes interruptions sont deux chemins différents. Les anciens événements perdus restent tributaires du rattrapage quotidien, de sa limite de dix éléments et de son scan existant. L'optimisation de ce scan relève de F10/P7 et n'a pas été réalisée ici.
- Aucun test de compte réel, trigger déployé, facturation ou comportement réseau de production. Les tests du worker emploient les véritables émulateurs et des processus isolés, sans simuler un résultat de production.
- L'attestation et les contrôles de génération P3 restent obligatoires ; cette correction ne migre pas les fichiers historiques. Une référence ancienne non attestée peut donc nécessiter la migration P3.
- Aucun système de fichiers distribué n'est créé entre IndexedDB, Firestore et Storage. Les versions, reprises et états intermédiaires explicites protègent les étapes vérifiées ; une indisponibilité persistante reste visible et récupérable, sans garantie de délai de succès.

## Fichiers touchés par P4

Les modifications antérieures de l'accueil et de P1/P2/P3 ont été préservées. P4 intervient dans les fichiers suivants seulement :

- `src/persistence/localVault.ts`
- `src/persistence/cloudDraft.ts`
- `src/persistence/syncModel.ts`
- `src/persistence/useHybridPersistence.ts`
- `src/persistence/cartularyJournal.ts`
- `src/services/privateUploadVerification.ts`
- `src/services/privateMedia.ts`
- `scripts/lib/private-upload-command.mjs`
- `scripts/firebase-functions.mjs`
- `firestore.rules`
- `package.json`
- `tests/local-vault.test.mjs`
- `tests/local-vault-versions.test.mjs` (nouveau)
- `tests/local-vault-indexeddb.test.mjs` (nouveau)
- `tests/hybrid-sync.test.mjs`
- `tests/private-upload-command.test.mjs`
- `tests/private-upload-emulator.test.mjs`
- `tests/helpers/private-upload-interrupted-worker.mjs` (nouveau)
- `tests/ui/cloud-draft-recovery.test.ts` (nouveau)
- `tests/ui/cartulary-journal-persistence.test.ts` (nouveau)
- `tests/ui/hybrid-persistence-loading.test.tsx`
- `tests/ui/private-upload-verification.test.ts`
- `docs/audits/2026-09-18-p4-synchronisation-reprises.md` (ce rapport)

## Preuves et références consultées

- `/private/tmp/cartularia-p4-node-final.log`
- `/private/tmp/cartularia-p4-client-final.log`
- `/private/tmp/cartularia-p4-upload-rules-emulator.log`
- `/private/tmp/cartularia-p4-idb-browser.log`
- `/private/tmp/cartularia-p4-ui-final.log`
- `/private/tmp/cartularia-p4-node-regression.log`
- `/private/tmp/cartularia-p4-build-final.log`
- `/private/tmp/cartularia-p4-build-personal-final.log`
- `/private/tmp/cartularia-p4-lint-final.log`
- `/private/tmp/cartularia-p4-ai.log`

La reprise utilise les métadonnées exposées par [Firebase Storage](https://firebase.google.com/docs/storage/web/file-metadata). Le comportement de redélivrance après activation des retries est décrit dans la [documentation Functions](https://firebase.google.com/docs/functions/retries). La comparaison/écriture locale repose sur une transaction `readwrite` IndexedDB ([documentation de l'API](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction)).
