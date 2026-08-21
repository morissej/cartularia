# ADR-026 — Gabarit universel des Cartulaires

## Décision

Toute modification de présentation ou de structure d’un Cartulaire s’applique à tous les Cartulaires existants et futurs, sans distinction de marque, de collection ou de type d’objet.

Le contrat commun est défini dans `src/features/cartulary/presentation/cartularyPresentationContract.ts`. Les lecteurs complet et multi-actifs doivent tous deux consommer ce contrat et exposer sa version dans `data-cartulary-presentation-version`.

Le socle commun comprend au minimum :

- les six pages Accueil, Médias, La référence, L’objet, Valorisation et Publication ;
- la Collection sur l’Accueil ;
- Stockage et Transmission sur L’objet ;
- les Rapports sur la référence ;
- la page 05 Publication comme point unique de pilotage des publications extérieure, Collection, Cercle et PDF ;
- l’absence de sélecteurs de publication répétés dans les blocs métier ;
- une sélection directe de tous les blocs, sans validation individuelle, puis une validation générale unique pour les niveaux Cartulaire, Collection et Cercle ;
- les éléments transverses de navigation, retour au Registre et identité Cartularia.

## Frontière autorisée

Seuls le contenu métier, les champs et les libellés propres à une verticale peuvent varier par profil de schéma. Une condition `isIwcCartulary`, `isRolexCartulary`, marque ou identifiant ne doit jamais décider de la présence, de l’ordre ou de la mise en page d’un élément structurel commun.

## Contrôle

`tests/cartulary-presentation-contract.test.mjs` verrouille les pages, les sections communes et l’utilisation du contrat par les deux lecteurs actuels. Tout nouveau lecteur de Cartulaire doit être ajouté à ce contrôle avant intégration.
