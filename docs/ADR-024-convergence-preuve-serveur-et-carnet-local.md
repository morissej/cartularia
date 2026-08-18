# ADR-024 — Convergence vers une preuve serveur unique et un carnet local distinct

- Statut : accepté pour le pilote, non déployé
- Date : 2026-08-17
- Décisions liées : ADR-003 (projections W/R/Sceau), ADR-006 (architecture de confiance), ADR-012 (journal local révisionné), ADR-021 (RFC 3161), ADR-022 (OpenTimestamps), ADR-023 (cession contradictoire)
- Portée : lot 4 du chantier « Preuve d’intégrité opposable »

## Contexte

L’interface présentait sous un vocabulaire voisin deux chaînes de solidité différente :

- la chaîne transactionnelle Firestore, écrite uniquement par les commandes serveur, portée par `cartularies/{id}/auditEvents` et utilisée par le Registre, les cessions et les exports portables ;
- le journal `cartularia-integrity-v2`, conservé dans le navigateur, utile pour le travail hors ligne et la détection d’altérations locales mais remplaçable avec le stockage qui le contient.

Le panneau du Cartulaire appelait le second « Preuve d’intégrité » et affichait un « Statut Sceau ». Un utilisateur pouvait donc lui attribuer la même portée qu’à la chaîne serveur ou au Sceau public W, ce que le code ne démontre pas.

## Décision

Cartularia adopte la convergence : la chaîne serveur devient l’unique autorité d’intégrité affichée pour les opérations partagées, les cessions et les preuves portables. Dès que le compte est connecté, le panneau du Cartulaire relit cette chaîne, la recalcule dans le navigateur et dérive son état à partir de faits persistés : révision, séquence, tête, statut RFC 3161 et statut OpenTimestamps.

Le journal navigateur est conservé sans changement de format ni réécriture. Il est renommé « Carnet local de travail » et présenté comme un cache hors ligne. Ses événements, reçus, anciens journaux et exports restent vérifiables avec les outils existants, mais ce carnet ne commande ni cession, ni publication, ni Sceau public.

Si la preuve serveur est indisponible, l’interface l’indique. Elle ne remplace jamais silencieusement cette preuve par le carnet local. Sans connexion, elle demande l’authentification puis présente séparément le carnet local.

## Vocabulaire retenu

- **Preuve serveur du Cartulaire** : chaîne transactionnelle autoritaire, avec son éventuel lot Merkle, reçu RFC 3161 et ancrage OpenTimestamps.
- **Carnet local de travail** : historique du navigateur, conservé pour le travail hors ligne et la reprise, sans autorité partagée.
- **Sceau public** : projection publique minimale associée à W. Il ne désigne ni la chaîne serveur ni le carnet local.
- **Trace locale du rapport** : preuve attachée à l’export R produit depuis l’état local ; elle est explicitement distincte de la chaîne serveur.
- **Simulation technique** : uniquement le tiroir qui falsifie volontairement un événement local ou crée une fixture locale. Le terme reste exact à cet endroit et disparaît des garanties réelles.

Le Registre remplace « Confiance blockchain-ready » par « Preuve serveur portable » et nomme explicitement la chaîne serveur, la tête serveur et sa source autoritaire.

## États dérivés

Le statut principal n’est jamais codé en dur. La fonction de présentation distingue :

- connexion requise ;
- chargement ;
- preuve serveur indisponible ;
- rupture détectée ;
- chaîne cohérente sans scellement extérieur ;
- chaîne horodatée par RFC 3161 ;
- ancrage Bitcoin soumis et en attente ;
- échec temporaire de l’ancrage ;
- ancrage OpenTimestamps confirmé.

Les niveaux `test_fixture`, `trusted_rfc3161` et `qualified_eidas` restent affichés selon leur valeur persistée et ne sont jamais déduits l’un de l’autre. Une fixture conserve la mention « simulation ».

## Conservation et migration

Aucune migration destructive n’est introduite. Le stockage `cartularia-integrity-v2:{cartularyId}` reste inchangé. Les anciens journaux `cartularia_audit_events` et `cartularia_audit_receipts` continuent d’être importés une seule fois dans `legacyBundles`, avec leur empreinte et leur classement `legacy_valid`, `legacy_broken` ou `legacy_unverifiable`.

Le rejeu de l’initialisation ne crée aucun événement supplémentaire et ne modifie aucun octet de l’état déjà persisté. Une chaîne locale rompue reste archivée avant tout rollover, conformément à l’ADR-012.

## Raisons

- La chaîne serveur est déjà la seule à couvrir les commandes transactionnelles, les droits, les cessions et les projections.
- Les lots 1 à 3 lui donnent les points d’attache extérieurs et le passage de propriétaire qui manquaient auparavant.
- Le carnet local reste nécessaire pour l’édition hors ligne, la reprise après incident et la conservation des historiques déjà créés.
- Deux garanties clairement nommées sont plus défendables qu’un même terme appliqué à deux autorités différentes.

## Conséquences et risques

- Un utilisateur non connecté ne voit pas le détail de la preuve serveur ; l’interface doit assumer cette limite plutôt que fabriquer un état rassurant depuis le cache.
- La preuve serveur peut être temporairement indisponible alors que le carnet local reste accessible. Cette disponibilité différente est visible et n’autorise aucun basculement d’autorité.
- La trace locale d’un rapport R antérieur reste valide dans sa portée propre, mais ne devient pas rétroactivement une preuve serveur.
- Les textes ou surfaces futures devront réserver « Sceau » à la projection publique et passer par la fonction de dérivation pour les statuts de preuve.
- La chaîne serveur démontre une cohérence, une détection d’altération et, lorsqu’ils existent, un horodatage ou un ancrage. Elle ne démontre toujours ni authenticité physique, ni véracité, ni identité, ni titre de propriété.

## Options rejetées

- **Maintenir deux “Sceaux” avec une note explicative** : le risque de confusion demeure dans les vues compactes, les exports et les usages de transmission.
- **Supprimer le journal local** : cela détruirait des historiques existants et ferait perdre le fonctionnement hors ligne.
- **Importer les événements locaux dans la chaîne serveur comme s’ils avaient toujours été autoritaires** : cela réécrirait leur nature et surévaluerait leur garantie.
- **Afficher le carnet local quand la chaîne serveur échoue** : ce repli silencieux transformerait une panne en fausse preuve.
- **Masquer toute simulation** : les outils de démonstration restent utiles pour vérifier la détection d’altération, à condition d’être isolés et nommés comme tels.

## Limites assumées et exploitation

La convergence est une décision d’interface et d’autorité ; elle ne fusionne pas physiquement les deux magasins. La synchronisation des contenus locaux vers le Cartulaire serveur continue de passer par les commandes prévues, avec leurs validations et leurs événements propres.

Ce lot ajoute le service de lecture, les statuts dérivés, les libellés et les tests, sans autoriser aucun déploiement Firebase. L’activation sur Hosting reste soumise à une validation et à une livraison séparées.
