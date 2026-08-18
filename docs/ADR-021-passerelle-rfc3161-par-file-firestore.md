# ADR-021 — Passerelle RFC 3161 par file Firestore authentifiée

- Statut : accepté, implémenté sur émulateurs, non déployé
- Date : 2026-08-17
- Chantier : preuve d’intégrité opposable — lot 1/4
- Complète : ADR-017

## Décision

L’application demande désormais un horodatage par un document immuable `timestampRequests/{requestId}`. Une Cloud Function du codebase `cartularia-sync`, déclenchée par `onDocumentWritten`, revendique la demande, appelle la TSA, vérifie le jeton RFC 3161 avec OpenSSL, puis crée `timestampReceipts/{requestId}`. Le navigateur ne contacte pas la TSA, ne fournit pas de certificat et ne décide d’aucun niveau de qualification.

Le même service client et les mêmes collections Firestore sont utilisés en développement et en production. Le middleware Vite `/api/timestamps` est conservé comme outil technique local, mais l’interface n’en dépend plus.

Une demande est autorisée seulement si le compte est actif, correspond à `accountHolderId`, porte le rôle `legal_owner`, possède `integrity.batch` et reste dans le périmètre du Registre. Le reçu est lisible individuellement par ce propriétaire légal et n’est jamais inscriptible par le client. Les requêtes non bornées sont refusées.

La limite initiale est de six tentatives par compte et par heure, configurable côté serveur entre 1 et 100. Une tentative consommée reste comptée en cas de panne TSA. Un rejeu du même `requestId` renvoie le reçu existant sans nouvel appel TSA, sans nouveau reçu et sans événement d’audit supplémentaire.

Les trois niveaux de l’ADR-017 restent disjoints :

- `test_fixture` reste réservé aux tests locaux explicites ;
- la Function n’accepte en sortie que `trusted_rfc3161` avec signature, chaîne, nonce et digest vérifiés ;
- `qualified_eidas` n’est ni produit ni déduit par cette passerelle.

Le reçu conserve la requête DER et la réponse RFC 3161 complètes en Base64, leurs empreintes, le nonce, la politique, le certificat signataire et les éléments de vérification. Cela permet une revérification OpenSSL hors application.

## Raisons

- Une file Firestore réutilise le motif déjà adopté pour la création et la synchronisation : intention client minimale, traitement Admin, reçu idempotent.
- Les règles Firestore portent l’authentification, le rôle, la permission et le périmètre avant tout appel payant ou externe.
- Le document de reçu forme une frontière en lecture seule entre le traitement serveur et le navigateur.
- La conservation des octets d’origine évite qu’un simple résumé JSON devienne la seule preuve disponible.
- Le quota transactionnel limite les abus sans exposer le contenu du Cartulaire : seuls une empreinte SHA-256 et des identifiants opaques quittent le navigateur.

## Conséquences et risques

- Le runtime Functions doit fournir la commande `openssl` et un magasin de racines compatible avec la chaîne de la TSA. Cette hypothèse est testée localement avec une vraie TSA éphémère, mais devra être confirmée lors d’une recette de préproduction autorisée.
- La Function est limitée à 60 secondes et l’appel TSA à 20 secondes. Une panne marque la demande `failed` et ne crée jamais de fixture de repli.
- Un arrêt du processus après la revendication et avant l’écriture du reçu laisse la demande `processing`. Le propriétaire doit alors émettre une nouvelle demande ; aucune preuve non vérifiée n’est publiée.
- Les logs contiennent uniquement l’identifiant opaque de demande, le statut de traitement et un code d’erreur. Ils ne contiennent ni digest, ni identifiant de Cartulaire, ni contenu, ni jeton.
- Les compteurs de quota sont conservés côté serveur avec une échéance logique. Leur suppression physique relève d’une politique de rétention opérationnelle ultérieure.
- Le code est prêt pour le runtime Firebase mais n’a pas été déployé. L’interface de production ne fonctionnera qu’après un déploiement explicitement autorisé des Functions et des règles.

## Options rejetées

### Endpoint HTTP public ou callable direct

Rejeté : il crée une seconde frontière d’authentification et de limitation de débit, alors que la file Firestore applique déjà les règles tenant et le motif transactionnel du projet.

### Appel direct de la TSA par le navigateur

Rejeté : le navigateur ne doit ni gérer la confiance certificats, ni qualifier le reçu, ni exposer le produit aux contraintes CORS et aux variations des TSA.

### Fixture automatique en cas de panne

Rejetée : elle ferait passer silencieusement une preuve locale pour une preuve tierce.

### Reçu stocké uniquement dans `localStorage`

Rejeté : il resterait remplaçable avec le journal local et ne fournirait pas la frontière serveur recherchée.

## Limites assumées

- Ce lot rend la passerelle utilisable par le code de production ; il ne déploie rien et ne démontre pas encore la disponibilité d’un runtime distant.
- Il date une empreinte fournie par le propriétaire légal. Il ne prouve ni l’authenticité de l’objet, ni la vérité des données, ni le titre de propriété.
- Il n’active aucun ancrage public et ne modifie pas le statut `deferred` de l’ADR-006.
- Il ne revendique aucune qualification eIDAS. Une telle qualification exige un contrôle de liste de confiance et un rapport de validation distincts.
- Les règles de lecture suivent le propriétaire légal courant. Le transfert et l’accès à la chaîne héritée relèvent du lot 3.
