# ADR-005 — Communauté authentifiée et isolée

- Statut : accepté pour le MVP
- Date : 2026-08-14
- Vague : 5

## Contexte

La Communauté doit permettre des profils, publications et échanges sans devenir une voie indirecte vers les Cartulaires privés. La décision D-02 restant ouverte dans la note technique, le MVP retient l’option la plus restrictive : un cercle authentifié et explicitement admis.

## Décision

L’admission communautaire réside dans `communityMemberships/{uid}` et ne découle ni d’un abonnement, ni d’un rôle patrimonial. Le profil `communityProfiles/{uid}` contient uniquement un pseudonyme volontaire, une courte biographie et une référence d’avatar ; il ne copie ni email, ni identité légale.

Les publications communautaires sont des projections physiques sous `communityPublications`. Chaque valeur est associée à un `fieldId` du schéma vertical dont `publishableTo` contient `community`. Un champ Secret est refusé avant toute écriture. La projection ne stocke ni chemin, ni identifiant du Cartulaire maître.

Un post référence seulement `communityPublicationId`. Les commentaires et réactions vivent dans des sous-collections ; le post conserve uniquement des compteurs agrégés. Un commentaire porte explicitement `proofStatus=not_cartulary_evidence` et ne modifie jamais la révision ou le journal du Cartulaire.

La suspension par un modérateur agit uniquement sur la publication communautaire. Les règles Firestore et Storage rendent alors la publication, ses posts, ses commentaires et ses dérivés immédiatement illisibles, sans mutation du dossier maître.

Toutes les écritures restent des commandes serveur transactionnelles et idempotentes. Les clients ne peuvent écrire directement aucun profil, membership, post, commentaire, réaction, projection ou événement de modération.

## Conséquences

- audience non anonyme et admission révocable ;
- identité communautaire pseudonyme séparée du compte privé ;
- absence physique des champs Secret dans les projections ;
- modération indépendante du patrimoine ;
- stockage communautaire séparé des originaux et des dérivés publics ;
- possibilité de séparer ultérieurement la base sociale sans reconstruire le Cartulaire.

## Hors périmètre

La vague ne déploie pas de réseau social public, de messagerie privée, de recommandation algorithmique ou de modération automatisée. Les données du pilote sont synthétiques et non certifiantes. Aucun déploiement Firebase distant n’est réalisé.
