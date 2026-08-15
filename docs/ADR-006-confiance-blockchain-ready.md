# ADR-006 — Confiance blockchain-ready sans blockchain active

- Statut : accepté et vérifié dans les émulateurs
- Date : 2026-08-14
- Vague : 6

## Décision

Les événements patrimoniaux sont sérialisés selon le profil `jcs-1`, chaînés par Cartulaire et vérifiables depuis le premier événement jusqu’à `integrityHead`. Le vérificateur accepte aussi les événements historiques `sorted-json-1`, dont la représentation était compatible pour les valeurs JSON déjà admises.

Les têtes intègres de plusieurs Cartulaires sont agrégées dans un arbre de Merkle binaire déterministe. Chaque Cartulaire reçoit une preuve d’inclusion privée. La charge destinée à un futur ancrage public contient seulement l’algorithme, la version de canonisation, la racine et le nombre de feuilles ; elle exclut identités, numéros de série, documents, valeurs, localisations et identifiants de Cartulaire.

L’interface d’horodatage accepte des reçus séparés du lot. Le pilote fournit uniquement `cartularia-test-tsa`, une fixture déterministe, non qualifiée et explicitement marquée comme telle. L’adaptateur d’ancrage public retourne `anchoring_deferred` : aucune blockchain et aucun prestataire eIDAS ne sont activés par cette vague.

L’export propriétaire est une commande serveur observable et idempotente. Elle ajoute une seule révision et un seul événement, vérifie le journal, puis produit un manifeste et des enregistrements JSON portables. Les métadonnées des médias en attente sont exportées, mais aucun binaire absent n’est présenté comme inclus.

## Autorité et accès

- `integrity.batch` autorise la création serveur d’un lot pour les Cartulaires situés dans la portée du Registre.
- `cartulary.export` autorise l’export du propriétaire légal.
- Le navigateur peut seulement lire son export prêt et ses reçus ; toutes les écritures client restent refusées.
- Une projection d’intégrité ne remplace jamais une `sourceRevision` plus haute par un événement arrivé en retard.
- Les jobs, lots et reçus ont des états explicites et ne dépendent pas de l’ordre d’arrivée des triggers.

## Portée de la preuve

La chaîne et les reçus prouvent qu’un état empreinté existait et rendent une altération ultérieure détectable. Ils ne prouvent pas à eux seuls l’authenticité de l’objet, la vérité d’une assertion, l’identité juridique d’une personne ni la propriété légale.

## Hors périmètre

- choix d’une autorité d’horodatage qualifiée ;
- ancrage sur une chaîne publique ;
- import des binaires média dans l’export ;
- signature électronique, preuve d’identité ou qualification juridique ;
- déploiement Firebase distant.
