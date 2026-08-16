# ADR-017 — Horodatage RFC 3161 derrière une passerelle privée

- Statut : accepté pour le prototype local
- Date : 2026-08-16
- Vague : corrective 4/6

## Décision

L'horodatage réel est exécuté côté serveur. Le navigateur ne contacte pas directement une TSA et ne décide pas si un jeton est qualifié. Il transmet seulement une racine Merkle SHA-256 et conserve le reçu vérifié retourné par la passerelle.

Le contrat distingue trois niveaux qui ne sont jamais déduits l'un de l'autre :

- `test_fixture` : déterministe, local, sans tiers ;
- `trusted_rfc3161` : jeton externe dont requête, nonce, signature et chaîne sont vérifiés ;
- `qualified_eidas` : niveau précédent complété par une validation `QTSA` sur liste de confiance et un rapport de validation empreinté.

L'autorité par défaut de développement reste configurable. Son nom ne constitue pas une preuve de qualification. Le jeton complet et la requête d'origine sont exportés afin qu'un vérificateur indépendant puisse refaire le contrôle OpenSSL.

## Raisons

- Une requête RFC 3161 ne révèle que l'empreinte et le nonce, ce qui respecte la confidentialité du Cartulaire.
- La vérification côté serveur évite de faire confiance à une simple réponse JSON ou à l'horloge locale.
- Conserver la requête permet de revérifier le nonce, pas seulement l'empreinte des octets du jeton.
- Séparer confiance cryptographique et qualification juridique empêche une revendication eIDAS non démontrée.

## Conséquences

Le serveur doit disposer d'OpenSSL et d'un magasin de racines à jour. Une panne TSA bloque la création d'un nouveau reçu mais ne remplace jamais celui-ci par une fixture silencieuse. Le service de production devra ajouter authentification, limitation de débit, observabilité expurgée, reprise et politique multi-fournisseurs.

L'ancrage blockchain reste un adaptateur ultérieur portant seulement sur une racine Merkle. La présente décision ne sélectionne ni réseau public, ni prestataire eIDAS qualifié.
