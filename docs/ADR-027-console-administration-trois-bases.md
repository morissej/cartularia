# ADR-027 — Console d’administration des trois bases

Date : 23 août 2026  
Statut : déployé et raccordé en production le 24 août 2026

## Décision

La route privée `/administration` fournit une console unique pour gérer les comptes du Registre, du Coffre personnel et de la base de correspondance. Cette vue consolidée ne fusionne pas les bases et ne crée pas de nouveau chemin de lecture de leurs contenus.

L’accès exige cumulativement :

- une authentification Firebase par identifiant et mot de passe dans le projet Registre ;
- le custom claim serveur `cartulariaAdmin: true` ;
- une authentification récente de moins de quinze minutes ;
- un jeton App Check hors émulateur ;
- le passage par des Functions privilégiées, sans credential administratif dans le navigateur.

La simple connaissance de l’URL ou d’un mot de passe utilisateur ne donne donc aucun accès administratif.

## Données visibles

La console peut lire les métadonnées minimales d’Authentication et constater la présence du document de compte attendu :

- Registre : libellé, état du compte, activité et présence de `users/{uid}` ;
- Coffre : état du compte et présence de l’enveloppe chiffrée, sans ciphertext ni donnée déchiffrée ;
- Correspondance : état du compte, présence du profil et éventuelle référence client codée, sans identité, adresse, email personnel ou instruction.

Les adresses techniques du Coffre et de la base de correspondance ne sont pas renvoyées au navigateur.

Un clic sur un compte ouvre son dashboard de gouvernance. Pour le compte Registre correspondant, il présente les organisations, memberships, rôles, permissions, Registres, Cartulaires, brouillons et Collections accessibles. Le rattachement aux comptes Coffre et Correspondances est calculé côté serveur à partir du nom utilisateur ; les adresses techniques dérivées ne sont jamais renvoyées. Le dashboard peut constater la présence d’un Coffre chiffré, mais ne lit ni ne déchiffre son contenu.

## Actions

La première version permet de suspendre et réactiver un compte, base par base. Chaque action exige un motif, interdit l’auto-suspension de l’administrateur dans le Registre et écrit un événement dans `administrationAudit`. Si l’audit ou la synchronisation du statut Registre échoue, la modification Authentication est compensée.

La suppression et la réinitialisation de mot de passe ne sont pas exposées : la suppression est destructive et les identifiants techniques des bases isolées ne sont pas des boîtes email de récupération.

## Raccordement de production

Les variables serveur `ADMIN_PERSONAL_FIREBASE_PROJECT_ID` et `ADMIN_CODE_BRIDGE_FIREBASE_PROJECT_ID` désignent les deux projets distincts. Le compte de service d’exécution des Functions du Registre doit recevoir, dans chacun de ces projets, uniquement les droits nécessaires pour lister/modifier les comptes Authentication et lire les documents de présence concernés.

Tant qu’un projet ou ses droits IAM ne sont pas configurés, la console le signale comme non raccordé ou indisponible au lieu de se rabattre sur le projet Registre.

Le raccordement de production utilise trois projets Firebase distincts :

- Registre et console : `studio-2614005370-a3e51` ;
- Coffre personnel : `cartularia-vault-a3e51` ;
- correspondances codées : `cartularia-bridge-a3e51`.

Les deux bases isolées sont situées en `eur3`, avec protection contre la suppression activée. Le compte d’exécution des Functions du Registre dispose des rôles `firebaseauth.admin` et `datastore.viewer` sur ces deux seuls projets secondaires.
