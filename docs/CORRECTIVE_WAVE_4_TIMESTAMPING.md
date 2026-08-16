# Vague corrective 4 — horodatage externe vérifiable

Date : 16 août 2026

## Résultat

Le bouton principal du panneau Intégrité ne fabrique plus un reçu avec l'horloge du navigateur. Il transmet uniquement la racine Merkle courante à une passerelle serveur, qui :

1. construit une requête RFC 3161 SHA-256 avec nonce ;
2. appelle une autorité de temps externe ;
3. vérifie la réponse contre la requête, le nonce, la signature du jeton et la chaîne de certificats ;
4. retourne le jeton, la requête et leurs empreintes pour une revérification portable ;
5. n'affirme une qualification eIDAS que si une preuve de validation `QTSA` issue d'une liste de confiance est jointe.

Le fournisseur par défaut du serveur Vite local est le service RFC 3161 public documenté par DigiCert. Il donne un vrai temps signé par un tiers, mais sa qualification eIDAS n'est pas évaluée par Cartularia : l'interface affiche donc exactement « Qualification eIDAS : non évaluée ».

## Frontière de confidentialité

Le navigateur envoie à `/api/timestamps` deux valeurs : une racine `sha256:…` et un identifiant de requête aléatoire. La passerelle envoie à l'autorité de temps une structure DER contenant cette empreinte, l'algorithme et un nonce. Elle n'envoie ni identité, ni code public, ni numéro de série, ni média, ni document, ni valeur patrimoniale, ni identifiant de Cartulaire.

L'URL TSA et ses éventuels secrets restent des variables serveur `CARTULARIA_TSA_*`. Ils ne doivent jamais être placés dans une variable `VITE_*`.

## Preuve conservée

Le reçu `rfc3161-v1` conserve :

- la racine Merkle et la révision de contenu couvertes ;
- la date UTC signée, le numéro de série et l'OID de politique ;
- la requête et la réponse RFC 3161 en base64, avec leurs empreintes SHA-256 ;
- l'identité et l'empreinte du certificat signataire ;
- les résultats de vérification signature, chaîne et nonce ;
- un statut de qualification distinct du statut cryptographique.

`npm run integrity:verify-local -- --input=/chemin/preuve.json` revérifie aussi les jetons RFC 3161 avec OpenSSL et le magasin de certificats racines de Node.js. Toute modification des octets, de la racine ou d'une revendication de qualification rend l'export invalide.

## Interface et rapport

- Le faux motif QR est remplacé par un QR réellement encodé vers `/watch-website?publicCode=…` ; ouvrir ce lien ne publie rien.
- Le rapport R imprime la révision, l'empreinte complète du contenu, la tête de chaîne, la racine Merkle horodatée, l'empreinte du jeton, la date signée, le fournisseur et le statut eIDAS.
- Si le contenu a changé depuis le reçu, le rapport dit « Contenu non encore couvert par un horodatage tiers ».
- La fixture locale est conservée uniquement dans le tiroir « Simulation technique » et porte toujours `TestReceipt`.

## Avertissement — correction à risque

Cette vague touche la chaîne d'intégrité et le contrat de reçu. Un déploiement de la passerelle ne doit pas être confondu avec le déploiement statique Firebase Hosting : en production, `VITE_CARTULARIA_TIMESTAMP_URL` doit viser une fonction ou un service serveur contrôlé, authentifié, limité en débit et supervisé.

Le choix d'un prestataire qualifié est une décision produit et contractuelle. Cartularia ne convertit jamais `trusted_rfc3161` en `qualified_eidas` sur la seule base du nom du fournisseur. Une revendication `qualified=true` est refusée sans identifiant de service de liste de confiance et empreinte d'un rapport de validation.

L'ancrage sur une blockchain publique reste différé. Il pourra publier une racine de lot et une référence de transaction, jamais des données métier.

## Recette

```bash
npm run test:corrective-wave4
npm run test:cartulary
npm run lint
npm run build
git diff --check
```

Un test réel du 16 août 2026 a reçu un jeton DigiCert RFC 3161, puis vérifié avec succès la signature, la chaîne et le nonce. Le contrôle navigateur a confirmé la persistance après rechargement, le QR URL et l'absence de débordement horizontal du panneau à 390 px.
