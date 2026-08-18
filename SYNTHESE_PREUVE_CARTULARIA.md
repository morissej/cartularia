# Synthèse — Ce que la preuve Cartularia établit

- Date de validation : 18 août 2026
- Périmètre : lots 1 à 4 du chantier « Preuve d’intégrité opposable »
- État : implémenté et vérifié localement sur émulateurs, non déployé

## Garantie désormais apportée

Cartularia conserve une chaîne transactionnelle serveur par Cartulaire. Chaque événement canonique contient l’empreinte du précédent ; la tête et la séquence attendues sont enregistrées sur le Cartulaire. Un vérificateur détecte toute suppression, modification, permutation ou tête incohérente. Les règles Firestore interdisent au navigateur de réécrire la chaîne.

Les têtes peuvent être regroupées dans une racine Merkle. Une passerelle serveur authentifiée fait horodater cette racine par RFC 3161, vérifie digest, nonce, signature et chaîne de certificats, puis conserve requête et jeton complets. Le reçu est revérifiable avec OpenSSL hors application. Une panne de TSA ne produit jamais de fixture et les niveaux `test_fixture`, `trusted_rfc3161` et `qualified_eidas` restent distincts.

La racine horodatée peut être soumise à OpenTimestamps. La charge publique contient seulement l’algorithme, la version de canonicalisation, la racine et le nombre de feuilles : aucune identité, référence d’objet, valeur ou localisation. Après confirmation Bitcoin, un tiers muni de l’export portable, de la preuve d’inclusion et de la chaîne publique peut démontrer que l’état empreinté existait au plus tard à la date du bloc, sans interroger Cartularia. Un ancrage en attente n’est jamais annoncé comme confirmé.

La cession exige deux consentements humains, liés à une révision déterminée. Toute évolution du Cartulaire invalide la proposition. La dernière tête du cédant est incluse dans un lot, horodatée et soumise à l’ancrage public avant le transfert. La chaîne continue sous le nouveau propriétaire en référençant cette tête, sans réécrire l’historique. Les droits changent de titulaire, les publications et le Sceau public sont réexaminés, et les données privées du cédant ne suivent pas l’objet.

## Lecture de l’interface

La « Preuve serveur du Cartulaire » est l’autorité affichée pour les opérations partagées, les cessions et les exports. Son statut est dérivé des faits persistés : chaîne cohérente ou rompue, horodatage vérifié, ancrage soumis, échoué ou confirmé.

Le « Carnet local de travail » est un cache hors ligne distinct. Ses anciens journaux restent archivés et vérifiables dans leur portée locale, mais ne remplacent jamais la preuve serveur et ne commandent ni cession, ni publication, ni Sceau public. Le « Sceau public » désigne uniquement la projection W.

## Ce que la preuve n’établit pas

La chaîne établit la cohérence et l’antériorité d’un état numérique, pas la vérité des informations ni leur lien matériel avec l’objet. Elle ne constitue donc pas, à elle seule :

- une signature électronique d’une personne ;
- une signature électronique qualifiée ou une qualification eIDAS ;
- un certificat d’authenticité de l’objet ;
- une expertise physique, une garantie de valeur ou d’état ;
- une preuve d’identité ou un titre juridique de propriété ;
- une décision automatique sur l’opposabilité devant une juridiction.

Ces effets exigent identité vérifiée, signatures et mandats adaptés, expertise de l’objet, sources fiables et analyse juridique dans la juridiction concernée.

## Limite opérationnelle actuelle

Code, règles et parcours ont été validés avec les émulateurs Firebase, y compris altérations négatives et rejeux idempotents. Rien n’a été déployé. Disponibilité TSA, planification OpenTimestamps, runtime Functions, supervision et conservation doivent encore être qualifiés en préproduction puis activés par un déploiement expressément autorisé.
