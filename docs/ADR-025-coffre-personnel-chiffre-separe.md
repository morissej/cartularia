# ADR-025 — Coffre personnel chiffré et séparé du Registre

## Décision

Les données personnelles directes sortent du projet Firebase du Registre et du Cartulaire. Elles sont gérées par un second site, un second projet Firebase, une authentification distincte et un mot de passe propre au Coffre personnel.

Le Registre et le Cartulaire ne conservent que :

- un nom d’utilisateur pseudonyme ;
- un code objet ;
- des codes de correspondance attribués par les mécanismes dédiés, jamais des identités civiles ;
- les données documentaires propres à l’objet, dont son histoire de provenance.

Le Coffre personnel conserve, dans un référentiel patrimonial unique et chiffré par compte :

- le nom utilisateur du compte et les identités et coordonnées des différents propriétaires ;
- un numéro client généré pour chaque propriétaire, un seul propriétaire étant lié au nom utilisateur ;
- la liste en lecture seule des codes objets rattachés à chaque numéro client ;
- les plans de transmission, leur code généré et leurs bénéficiaires, sans champ de pourcentage ;
- les lieux réels de stockage, leur nom de code, leur contenu et leurs conditions ;
- les gestionnaires autorisés à intervenir pour le propriétaire et leur code généré.

Les codes objets ne sont jamais saisis par le propriétaire dans le Coffre. Ils sont créés par la mécanique de création du Cartulaire, puis rapprochés du numéro client dans la base de correspondance.

## Frontière technique

Le site du Coffre est compilé par `vite.personal.config.ts` dans `dist-personal`. Il importe uniquement `src/personalVault/firebase.ts`, qui utilise les variables `VITE_PERSONAL_FIREBASE_*`. Il n’importe pas `src/firebase.ts`. Le déploiement utilise `firebase.personal.json` et doit cibler un projet Firebase différent de `studio-2614005370-a3e51`.

L’identifiant du document de Coffre est dérivé par SHA-256 du nom utilisateur. Aucun code objet n’est nécessaire pour entrer dans le site ou ouvrir le référentiel patrimonial.

Une troisième base Firebase, distincte du Registre et du Coffre, contient exclusivement les correspondances codées :

- numéro client (`CLI-…`) vers codes objets ;
- codes plans de transmission (`TRN-…`) ;
- codes lieux (`LIE-…`) ;
- codes gestionnaires (`GES-…`).

Elle ne reçoit ni nom utilisateur en clair, ni identité, ni adresse, ni email, ni instruction de transmission. Ses règles refusent tout champ étranger au contrat de codes et isolent chaque compte technique.

## Chiffrement

Le payload est sérialisé localement, puis chiffré par AES-GCM 256 bits. La clé est dérivée du mot de passe dédié et du pseudonyme avec PBKDF2-HMAC-SHA-256, un sel aléatoire de 128 bits et 600 000 itérations. Un IV aléatoire de 96 bits est créé à chaque enregistrement. Le contexte du compte patrimonial est authentifié comme donnée additionnelle AES-GCM.

Firestore reçoit uniquement l’enveloppe chiffrée, ses paramètres cryptographiques, l’UID technique et l’identifiant opaque du compte. Les règles refusent tout champ supplémentaire et tout accès ne correspondant pas à l’UID authentifié.

Ce dispositif protège les données contre une lecture directe de Firestore et évite leur présence dans le projet Registre. Il ne doit pas être présenté comme une garantie absolue « zero knowledge » contre une compromission du code JavaScript servi au navigateur ou du poste utilisateur.

## Authentification

Le pseudonyme n’est pas stocké comme email Firebase. Le client le transforme en adresse technique par SHA-256 avant l’appel Firebase Auth. L’entrée dans le Coffre exige uniquement ce pseudonyme et le mot de passe dédié ; aucune sélection d’objet n’existe dans le parcours d’accès. Le mot de passe du Coffre doit être distinct de celui du Registre et comporter au moins 12 caractères. La persistance Auth est limitée à la session du navigateur ; la clé de chiffrement reste uniquement en mémoire et est effacée au verrouillage ou au rechargement.

## Compatibilité et migration

Les identifiants historiques de blocs (`cover-owner`, `cover-transmission`, `cover-storage`, `cover-ownership-history`) sont conservés pour ne pas casser les anciens contrats. La politique de publication v2 interdit désormais propriétaire, transmission et stockage pour toutes les projections. Dans le Cartulaire privé, le bloc stockage ne rend plus que les noms de code.

Les anciennes clés détaillées sont bloquées par les Rules et ignorées par la synchronisation :

- `cartularia-owner-fields` ;
- `cartularia-owner-type` ;
- `cartularia-owner-documents` ;
- `cartularia-transmission-recipients` ;
- `cartularia-storage-locations` ;
- `cartularia-storage-description` ;
- les binaires de type `owner_document`.

Elles ne sont pas supprimées automatiquement : avant purge de données historiques déjà présentes dans Firebase ou IndexedDB, il faut exporter, chiffrer, importer dans le Coffre, vérifier le déchiffrement, puis exécuter une purge auditable et ciblée.
