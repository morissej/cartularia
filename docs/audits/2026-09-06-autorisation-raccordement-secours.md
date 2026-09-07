# Raccordement du secours — autorisation spécifique requise

## État

Le 6 septembre 2026, le contrôle automatique a refusé l’application des droits ci-dessous malgré l’autorisation générale de poursuivre les vagues. Aucun compte de service, rôle ou droit IAM n’a été créé ou modifié par cette tentative. Le code et les tests locaux sont préparés ; le service de secours n’est pas déployé.

## Ressources exactes

| Projet | Compte de service à créer | Utilisation |
|---|---|---|
| `studio-2614005370-a3e51` | `cartularia-recovery-runner@studio-2614005370-a3e51.iam.gserviceaccount.com` | Exécuter les fonctions de secours et signer les sessions Registre |
| `cartularia-vault-a3e51` | `cartularia-recovery-signer@cartularia-vault-a3e51.iam.gserviceaccount.com` | Signer les sessions Coffre après preuve de possession |
| `cartularia-bridge-a3e51` | `cartularia-recovery-signer@cartularia-bridge-a3e51.iam.gserviceaccount.com` | Signer les sessions du pont après preuve de possession |

## Droits persistants demandés

Créer le rôle personnalisé `cartulariaRecoveryRuntime` dans chacun des trois projets et l’accorder au compte central `cartularia-recovery-runner` :

- Registre et Coffre : `firebaseauth.users.get`, `datastore.entities.get`, `datastore.entities.create`, `datastore.entities.update`, `datastore.databases.get`.
- Pont : uniquement `firebaseauth.users.get` dans ce rôle.
- Autoriser le compte central à utiliser `roles/iam.serviceAccountTokenCreator` sur lui-même et sur les deux comptes signataires, sans l’accorder au niveau de tout un projet.
- Accorder `roles/logging.logWriter` au compte central dans le projet Registre.

Ces droits restent actifs jusqu’à leur révocation. Aucune clé privée de compte de service téléchargeable n’est demandée. Les deux signataires ne reçoivent pas de rôle de lecture/écriture des données.

## Risque et portée réelle

La signature permet techniquement de créer des sessions pour des utilisateurs des trois espaces. Les permissions Firestore de ce rôle s’appliquent aux bases des projets Registre et Coffre : elles ne sont **pas** limitées à certains chemins par IAM. Le code de secours limite ses opérations aux comptes, preuves et enveloppes concernés ; les règles Firestore clientes ne bornent pas un serveur Admin SDK. Une compromission de ce compte central aurait donc une portée supérieure à celle d’un utilisateur ordinaire.

Le dispositif ne transmet au serveur ni la clé privée du kit ni le contenu personnel déchiffré. La vérification de possession, les contrôles de suspension/révocation et les opérations atomiques sont testés localement. Cela ne remplace pas la validation des droits et des audiences Auth sur les trois projets réels.

## Action après approbation explicite

Appliquer le script `scripts/configure-recovery-infrastructure.mjs --apply` via le mécanisme ADC local déjà utilisé, vérifier les droits effectifs, déployer les nouvelles fonctions de secours sur le compte dédié, puis effectuer une recette avec des comptes fictifs isolés. Ne pas utiliser le compte de calcul existant comme contournement et ne pas annoncer le secours disponible avant cette recette.

La livraison générale reste distincte de cette approbation : dépendances signalées, runtime vidéo, contenu juridique et recette complète demeurent des contrôles séparés.
