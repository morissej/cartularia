# Nouvel audit fonctionnement — comptes, récupération, Coffre et codes

Date : 6 septembre 2026. Revue indépendante du code courant, en lecture seule. Aucun correctif produit, seed, mutation distante, IAM, Auth ou Firestore réel ; aucun navigateur partagé utilisé. Seuls ce rapport et des fixtures de diagnostic temporaires hors dépôt ont été créés.

## Conclusion

**Deux défauts P1 de conservation des données sont reproduits**, ainsi que deux défauts P2 de cohérence des secours/codes. Les tests existants réussissent, mais ne couvrent pas ces quatre interleavings. La validation du code local ne permet donc pas de conclure que le Coffre est sûr pour un usage patrimonial réel.

| Référence | Priorité | Défaut utilisateur | Niveau de preuve |
| --- | --- | --- | --- |
| AC01 | P1 | Coffre sauvegardé avec une clé différente du mot de passe Auth après saisie pendant l'ouverture | UI réelle, services d'accès simulés, vrai chiffrement/déchiffrement |
| AC02 | P1 | Rotation du mot de passe écrasant les données plus récentes d'une autre session | Service client réel, commande serveur réelle, crypto réelle ; base mémoire |
| AC03 | P2 | Kit généré pour A puis activé pour B, avec faux succès et fichier inutilisable pour B | UI/service client/commande serveur réels ; Auth et base mémoire |
| AC04 | P2 | Ancienne synchronisation écrasant les codes récents alors que le dernier Coffre dit « synchronisé » | Orchestrateur réel, CAS et écritures du pont simulés conformément au code |

## AC01 — P1 : saisie pendant l'ouverture, puis clé de sauvegarde désynchronisée

**Scénario reproduit**

1. Entrer le mot de passe A et lancer l'ouverture du Coffre.
2. Pendant l'attente, modifier le champ encore éditable en B (par exemple pour corriger/recommencer la saisie).
3. La réponse correspondant à A arrive ; le Coffre s'ouvre et son formulaire d'accès disparaît.
4. Enregistrer le Coffre : il est maintenant chiffré avec B alors que le compte Auth conserve A.

**Résultat du diagnostic :** l'authentification et le chargement reçoivent A ; les deux écritures de sauvegarde reçoivent B. Le déchiffrement réel de l'enveloppe obtenue échoue avec A et réussit avec B. Le message indique pourtant « Coffre chiffré enregistré ». Après verrouillage, le parcours normal ne permet plus de fournir le mot de passe Auth A et la clé de déchiffrement B séparément.

**Preuves code**

- Champ mot de passe sans désactivation pendant `busy` : [src/personalVault/PersonalVaultApp.tsx](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/PersonalVaultApp.tsx:252>).
- A capturé par la fonction asynchrone pour l'authentification et le déchiffrement : [src/personalVault/PersonalVaultApp.tsx](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/PersonalVaultApp.tsx:79>).
- À la réussite, le pseudonyme est rétabli mais pas le mot de passe utilisé pour ouvrir : [src/personalVault/PersonalVaultApp.tsx](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/PersonalVaultApp.tsx:89>).
- La sauvegarde suivante prend le `password` courant de l'état React : [src/personalVault/PersonalVaultApp.tsx](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/PersonalVaultApp.tsx:116>).
- Cette valeur devient effectivement la clé de chiffrement, sans lien vérifié avec la session ayant déchiffré : [src/personalVault/repository.ts](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/repository.ts:87>) et [src/personalVault/crypto.ts](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/crypto.ts:53>).

**Correction à prévoir, non réalisée :** séparer le brouillon des identifiants et le secret confirmé de la session déchiffrée ; figer/valider les identifiants pendant l'ouverture et refuser une réponse devenue obsolète. Verrouiller ce scénario par un test qui exige soit l'absence de sauvegarde, soit le maintien du secret A confirmé.

## AC02 — P1 : rotation du mot de passe à partir d'un affichage périmé

**Scénario reproduit**

1. A ouvre une version V1 et ne modifie rien : son formulaire est « propre ».
2. B ouvre/enregistre une version V2 du même Coffre.
3. Sans recharger V2, A change son mot de passe avec son kit.
4. Le service lit bien l'enveloppe V2 distante, mais chiffre le payload V1 encore affiché et utilise l'empreinte V2 comme précondition d'écriture.

**Résultat du diagnostic :** la vraie commande serveur accepte la transaction. Le déchiffrement avec le nouveau mot de passe retrouve « État A affiché » et a perdu « État B enregistré ailleurs ». Les deux mises à jour de mots de passe Auth simulées ont également été appelées.

**Preuves code**

- Relecture de l'enveloppe distante puis chiffrement du `payload` reçu de l'écran, sans vérifier qu'il provient de cette enveloppe : [src/personalVault/recoveryRepository.ts](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/recoveryRepository.ts:74>).
- Les mises à jour Auth sont lancées avant la commande serveur : [src/personalVault/recoveryRepository.ts](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/recoveryRepository.ts:78>).
- La précondition utilise la version distante juste relue, pas celle dont le formulaire est issu : [src/personalVault/recoveryRepository.ts](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/recoveryRepository.ts:82>).
- La commande compare cette empreinte et remplace l'enveloppe ; elle ne peut pas détecter que le plaintext client était déjà obsolète : [scripts/lib/personal-recovery-command.mjs](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/scripts/lib/personal-recovery-command.mjs:218>).
- À l'inverse, la sauvegarde ordinaire compare la dernière enveloppe réellement chargée par la session : [src/personalVault/repository.ts](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/repository.ts:86>). Cette protection n'est pas reprise dans la rotation.

**Correction à prévoir, non réalisée :** ancrer la rotation sur la révision/enveloppe effectivement déchiffrée pour le formulaire, vérifier cette précondition avant les mutations Auth puis au commit. En présence d'un enregistrement concurrent, conserver le formulaire et imposer une réouverture/conciliation explicite ; ne pas utiliser la dernière empreinte relue pour légitimer un ancien payload.

## AC03 — P2 : kit tardif lié au mauvais compte après changement de session

**Scénario reproduit**

1. Sur `/account/security`, le compte A lance la génération d'un kit.
2. Avant la réponse, la session devient B (par exemple connexion sur un autre onglet).
3. L'observateur de session efface le kit, mais la génération de A termine ensuite et remet ce kit à l'écran.
4. L'utilisateur télécharge le fichier et l'active. Le callable l'associe à la session B courante.

**Résultat du diagnostic :** l'écran confirme « Kit activé et vérifié ». La base mémoire contient le credential sous `registryRecovery/user-b`, mais le fichier téléchargé contient toujours `ownerUid: user-a`. Une tentative de secours à partir de ce fichier est refusée. Le kit précédent de B serait remplacé par un fichier ne pointant pas sur B.

**Preuves code**

- Remise à zéro au changement de session, sans annulation des opérations déjà parties : [src/features/public/RegistryRecoveryPage.tsx](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/public/RegistryRecoveryPage.tsx:31>).
- Réponse tardive de génération affectée à `setKit` sans liaison à une génération/session courante : [src/features/public/RegistryRecoveryPage.tsx](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/public/RegistryRecoveryPage.tsx:75>).
- Activation/transfert et contrôle final fondés sur le seul `credentialId` : [src/features/public/RegistryRecoveryPage.tsx](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/public/RegistryRecoveryPage.tsx:80>).
- Le kit contient un `ownerUid`, mais la fonction d'activation ne le vérifie pas et ne transmet pas une cible attendue : [src/services/registryRecovery.ts](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/services/registryRecovery.ts:23>) et [src/services/registryRecovery.ts](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/services/registryRecovery.ts:29>).
- Le serveur écrit légitimement sous l'UID de la requête authentifiée, qui est B : [scripts/lib/registry-recovery-command.mjs](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/scripts/lib/registry-recovery-command.mjs:34>).

Il ne s'agit pas d'un accès non autorisé à un autre compte : le défaut est l'activation incohérente d'un secours sous une session valablement authentifiée.

**Correction à prévoir, non réalisée :** lier les opérations et résultats au couple UID/projet initial ; ignorer les réponses après changement de session ; vérifier aussi cette cible attendue à l'activation serveur pour couvrir un changement entre contrôle client et appel.

## AC04 — P2 : les codes peuvent rester anciens sans attente persistée dans le dernier Coffre

**Scénario reproduit sur l'orchestrateur réel**

1. A enregistre son Coffre avec `codeSyncPending: true`, puis sa synchronisation pont reste en attente.
2. B ouvre cette nouvelle sauvegarde, ajoute un lieu et termine ses deux écritures plus sa synchronisation : son Coffre est à jour, marqueur `false`.
3. L'ancienne synchronisation A reprend et écrit les anciens codes par-dessus ceux de B.
4. L'acquittement chiffré de A rencontre un conflit CAS et retourne seulement un état « pending » à l'onglet A. La sauvegarde distante B reste avec marqueur `false`.

**Résultat du diagnostic :** le dernier Coffre contient deux lieux et dit `codeSyncPending: false`, alors que le pont ne contient plus que le premier. Réouvrir le Coffre n'affiche donc pas la reprise annoncée ; le transfert vers le Registre peut présenter un inventaire incomplet.

**Preuves code**

- Ordre sauvegarde pending → synchronisation → acquittement ; un échec du dernier persist retourne le pending local sans pouvoir l'inscrire dans une version déjà dépassée : [src/personalVault/vaultSaveWorkflow.ts](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/vaultSaveWorkflow.ts:9>).
- Les écritures/suppressions des codes n'ont pas de précondition de génération/révision : [src/personalVault/codeBridgeRepository.ts](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/codeBridgeRepository.ts:73>).
- Les sous-collections sont synchronisées séparément : [src/personalVault/codeBridgeRepository.ts](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/codeBridgeRepository.ts:125>).
- Les Rules vérifient propriétaire et forme des codes mais n'imposent aucun ordre intersessions : [bridge-firestore.rules](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/bridge-firestore.rules:63>).
- Le transfert prend l'inventaire serveur des codes après vérification des sessions, sans lien avec la version chiffrée affichée : [src/personalVault/CodeHandoffSender.tsx](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/CodeHandoffSender.tsx:36>).

**Limite de preuve :** le diagnostic exécute `saveVaultAndCodes` réel, avec une simulation déterministe du CAS et du pont. Il n'exécute pas les Rules/SDK Firestore ni une transaction multi-projet réelle. Les écritures inconditionnelles et l'absence de génération sont confirmées par le code.

**Correction à prévoir, non réalisée :** ordonner/versionner les publications de codes par génération issue de la sauvegarde confirmée et interdire à une génération ancienne de remplacer la plus récente. Garder les bases séparées ; cette coordination ne nécessite ni noms ni contenu personnel dans le pont.

## Contrôles réussis et limites connues

Les protections déjà présentes ont été relues et leurs tests pertinents relancés :

- Séparation des trois projets exigée, absence de repli productif : [src/personalVault/isolatedConfiguration.ts](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/isolatedConfiguration.ts:41>).
- Sauvegarde ordinaire : CAS anti-écrasement, saisie tardive conservée, refus de verrouillage avec un ancien acquittement, confirmation de suppression et avertissement de sortie.
- Récupération du Coffre : édition bloquée pendant l'ouverture par kit et refus d'une réponse obsolète ; preuve signée à usage unique, expiration, révocation/remplacement et suspension refusés.
- Handoff : destination/nonce/UID/email/expiration contrôlés, confirmation explicite, refus des champs personnels et doublons, purge à la déconnexion, diagnostic popup bloquée, fonctionnement conçu sans `window.opener`.
- Le mode démo ne peut pas installer un kit Registre donnant le contrôle du compte partagé.
- Les nouvelles sessions à pseudonyme disposent du raccordement codes. **Limite fonctionnelle explicite** : les comptes Registre historiques dont l'identifiant Auth est une vraie adresse email sont refusés par ce raccordement ([src/personalVault/useVaultCodeHandoff.tsx](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/useVaultCodeHandoff.tsx:25>) et [src/personalVault/codeHandoffProtocol.ts](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/codeHandoffProtocol.ts:15>)), alors que l'authentification Registre accepte ces adresses. C'est testé et affiché, pas un contournement à enlever ; leur migration/rattachement prouvé reste à définir avant de dire que tous les comptes sont couverts.

## Barrières de livraison à maintenir et à vérifier séparément

Ces points ne constituent pas une nouvelle certification de l'état distant. Aucun IAM ni endpoint distant n'a été interrogé dans ce passage.

| Contrôle de livraison | Preuve locale / résultat attendu |
| --- | --- |
| Versions coordonnées Registre/Coffre et retour de codes | Les deux entrypoints capturent/effacent les fragments avant rendu ; le domaine Registre doit servir `/code-handoff-return`. Root compare les versions servies et fait la recette navigateur. |
| Trois projets distincts, configurations complètes | Le résolveur refuse tout partage/incomplétude. Refaire la recette avec les audiences Auth réellement déployées, pas seulement des mocks. |
| Origines opposées cohérentes | `VITE_PERSONAL_VAULT_URL` côté Registre et `VITE_REGISTRY_SITE_URL` côté Coffre doivent viser les deux origines effectives. Localhost et 127.0.0.1 ne sont pas interchangeables dans le contrôle d'origine. |
| Service de secours dédié | [scripts/firebase-functions.mjs](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/scripts/firebase-functions.mjs:141>) refuse de travailler sans `RECOVERY_RUNTIME_SERVICE_ACCOUNT`. La présence d'une variable ou un build réussi ne prouve pas les permissions nécessaires. |
| Signatures et droits minimaux interprojets | [scripts/firebase-functions.mjs](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/scripts/firebase-functions.mjs:103>) utilise les signataires des projets séparés. Vérifier séparément l'exécution réelle avec les droits explicitement autorisés ; ne pas remplacer ce garde par un compte privilégié par défaut. |
| Endpoint/CSP | Le transport peut configurer projet/région ([src/personalVault/recoveryTransport.ts](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/recoveryTransport.ts:4>)), tandis que la CSP Coffre autorise actuellement l'endpoint us-central1 du projet Registre ([firebase.personal.json](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/firebase.personal.json:17>)). Tout changement de destination doit actualiser les deux. |
| Recette de perte/reprise avant usage réel | Refuser le go-live patrimonial sur la seule base des tests existants : AC01/AC02 démontrent une perte d'accès ou d'enregistrement malgré ces tests verts. |

Le précédent dossier d'exécution signalait un blocage IAM pour les secours. Son état présent doit être confirmé par root ; je ne le transforme pas en constat distant actualisé.

## Tests exécutés dans ce passage

### Tests existants : 57 réussites

```sh
npx vitest run --config vitest.config.ts tests/ui/account-access-corrections.test.tsx tests/ui/recovery-entry.test.tsx tests/ui/personal-vault-draft.test.tsx tests/ui/personal-vault-repository.test.ts tests/ui/registry-recovery-roundtrip.test.tsx tests/ui/vault-recovery-concurrency.test.tsx tests/ui/vault-save-workflow.test.ts tests/ui/code-handoff.test.tsx tests/ui/code-handoff-sender.test.tsx
node --test tests/account-command.test.mjs tests/personal-recovery.test.mjs tests/isolated-vault-configuration.test.mjs tests/correspondence-codes.test.mjs tests/code-bridge-command.test.mjs
```

Résultats : **9 fichiers / 40 tests UI**, **5 fichiers / 17 tests purs**. Aucune nouvelle exécution émulateur dans ce lot.

### Diagnostics temporaires : 4 reproductions confirmées

Dossier hors dépôt : `/private/tmp/cartularia-audit-comptes-JPRBaZ`.

```sh
npx vitest run --config /private/tmp/cartularia-audit-comptes-JPRBaZ/vitest.config.mjs
```

| Fixture | Constat caractérisé |
| --- | --- |
| `login-password-race.test.tsx` | AC01 : vraie enveloppe déchiffrable avec B, plus avec A |
| `rotation-stale-payload.test.tsx` | AC02 : service + commande serveur réels acceptent la réécriture V1 après V2 |
| `registry-kit-session-race.test.tsx` | AC03 : succès pour B, fichier encore lié à A |
| `bridge-last-writer-race.test.tsx` | AC04 : pont ancien et dernier marqueur chiffré false |

**Attention : ces quatre tests passent parce qu'ils affirment le comportement défectueux actuel. Ce ne sont pas quatre validations d'absence de défaut.** Ils sont conservés temporairement pour permettre la reproduction et la préparation de vrais tests de non-régression dans une éventuelle vague de correction autorisée.

Lacunes restantes : vrai parcours propriétaire multi-appareil, récupération sans session/cache sur trois projets, interruptions aux étapes Auth/commit réseau, cohérence de codes pendant écritures concurrentes, Safari/Firefox, vrai navigateur mobile, téléchargement/conservation réelle d'un kit et révocation intersessions. Aucune garantie issue du seul test unitaire n'est étendue à ces parcours.
