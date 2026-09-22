# Exécution du prompt 1 — Sessions privées

Date : 18 septembre 2026. Checkout : `04_Application/Prototype Antigravity`, branche `feat/lecteur-unique-adr-028-031`, base Git `d79851d` et changements locaux préexistants conservés.

## Mandat

Exécution autorisée du **premier prompt** de [l’assessment](2026-09-18-assessment-code.md) : F01 (rendu/cache privé après perte de session) et F11 (verrouillage du Coffre). Les autres prompts restent à traiter séparément. Aucun commit, push, déploiement Firebase, changement de règles ou écriture en production dans cette intervention.

## Résultat

### Cartulaire et session Registre

- Le module du Cartulaire privé n’est chargé qu’après identification et confirmation serveur du compte actif et du droit de lecture du dossier. Un snapshot issu du cache ou contenant des écritures en attente ne constitue pas une confirmation.
- Le contrôle couvre `/cartulary`, `/cartulary-view` et l’aperçu local privé `/watch-website?preview=local`. Seules les identités de démonstration du catalogue sont exemptées ; un simple préfixe `cart_demo_` ne suffit pas.
- Déconnexion, changement d’identité, refus serveur et verrouillage d’inactivité retirent le Cartulaire du rendu, révoquent l’accès au cache, invalident les opérations asynchrones et révoquent les URL Blob privées. Une déconnexion distante échouée ne rouvre pas la session locale.
- Après fermeture d’une session déjà admise, la réouverture passe par une navigation complète et une nouvelle vérification. Cela évite de réutiliser les constantes et le journal du module chargés pour le compte précédent.
- Le marqueur d’un ancien verrou est retiré après une authentification Firebase explicite réussie, y compris lors de la création d’un nouveau compte. Un refus d’authentification, une simple reprise d’activation ou la réutilisation d’une session existante ne le retirent pas.
- Les réponses anciennes des chargements, téléchargements, restaurations et synchronisations sont ignorées. Les opérations pas encore envoyées sont interrompues avant leurs effets distants.
- Le refus d’une ressource auxiliaire n’est pas assimilé aveuglément à une révocation : un invité peut ne pas avoir de brouillon cloud personnel ; ses droits sur le dossier sont alors revérifiés. Les collections non accessibles restent optionnelles pour un membre aux droits limités.
- Le verrou d’inactivité existant couvre les routes privées réelles et contrôle le temps écoulé avant de considérer un retour au premier plan comme une nouvelle activité. Vérification forcée du token toutes les cinq minutes et au retour au premier plan ; les indisponibilités réseau ne sont pas assimilées à une révocation du token.

### Conservation des brouillons et cache

- Les nouveaux espaces localStorage/IndexedDB sont cloisonnés par **UID + Cartulaire**. Le cache est fermé par défaut et ne s’ouvre qu’après autorisation.
- Une instance révoquée ne peut pas être réutilisée, même après un aller-retour du compte A vers B puis A. Les écritures locales déjà acceptées peuvent terminer dans l’espace de leur auteur ; elles ne sont pas attribuées au compte suivant.
- Les anciennes données sans UID sont conservées à leur emplacement. Elles ne sont ni supprimées ni migrées vers l’utilisateur qui se connecte ensuite. Un bandeau avertit qu’une vérification de leur propriétaire est nécessaire avant récupération. **La récupération de ces anciens brouillons n’est pas automatisée par ce lot.**
- Aucune nouvelle ouverture hors ligne implicite : les droits doivent être confirmés par le serveur avant déverrouillage. Si seule la copie cloud est ensuite indisponible, la copie locale de l’identité admise peut être utilisée.
- Le journal de démonstration utilise un stockage en mémoire ; il ne lit, ne migre et ne modifie plus les anciens journaux privés du profil navigateur.

### Coffre personnel

- Le Coffre observe sa propre instance `personalAuth`, indépendamment du Registre et du bridge. Il se ferme lors d’une perte/changement d’identité, d’un refus d’enregistrement, après **30 minutes d’inactivité** ou **15 minutes d’onglet masqué**.
- Les formulaires déchiffrés et les références aux secrets actifs sont retirés de l’interface ; les anciennes ouvertures, récupérations et sauvegardes ne peuvent pas la rouvrir.
- Les saisies non enregistrées sont préservées dans une enveloppe **AES-GCM**, indexée par UID et contenant une identité authentifiée dans le texte chiffré. Aucun mot de passe n’est enregistré dans localStorage.
- Après authentification et déchiffrement, l’utilisateur choisit explicitement de reprendre le brouillon. L’édition reste suspendue tant qu’un brouillon antérieur ou une erreur de récupération attend une décision.
- En cas de quota/refus localStorage, seule l’enveloppe chiffrée reste en mémoire de l’onglet, avec avertissement. En cas d’échec du chiffrement, l’application annonce l’impossibilité de préserver les saisies plutôt que de promettre une sauvegarde inexistante.

## Vérification

Les tests de session utilisent des identités fictives, des backends mémoire et des promesses différées. Ils vérifient l’absence de rendu privé sans autorisation, propriétaire → déconnexion, A → B → A, refus serveur, écritures optimistes non confirmées, anciens callbacks, verrouillage sur les routes réelles, brouillons conservés, inactivité, onglet masqué et sauvegarde en cours.

- Suite UI complète finale : **626 tests réussis sur 102 fichiers**, dont les scénarios P1, la non-migration du journal privé par la démo et les neuf tests de sortie de verrou après connexion/création réussie.
- Coffre : 43 tests ciblés réussis ; cache/hybride/rétention : 29 tests Node réussis ; synchronisation différée et gardes cloud : 13 tests UI ciblés réussis. Ces sous-ensembles ne s’ajoutent pas au total UI.
- TypeScript, lint, catalogue IA (85 postes) et `git diff --check` validés.
- Builds Registre et Coffre validés. Les avertissements Vite de taille de certains bundles restent présents ; leur optimisation ne fait pas partie de ce prompt.
- Contrôle réel dans Chrome local isolé, sans session Firebase réelle ni réseau externe : quatre URL privées, dont un faux identifiant démo, restent verrouillées sans montage ni chargement de `App.tsx` ; la démo catalogue est rendue. Le contenu privé fictif n’apparaît jamais et sa copie locale demeure inchangée. Aucune exception JavaScript non interceptée relevée. [Résultats](2026-09-18-p1-session/browser-report.json), [capture privée](2026-09-18-p1-session/anonymous-private-lock.png), [capture démo](2026-09-18-p1-session/public-demo.png).

La commande globale `test:v7` rencontre les trois échecs déjà constatés avant P1 : un contrat d’accessibilité (`NEVER_INCOMPLETE` dans `tests/cartulary-presentation-contract.test.mjs`) et deux contrats d’accueil démo (`tests/demo-account.test.mjs`). La première étape Node est à **179/182 réussis** ; les étapes suivantes v4–v7, exécutées séparément sans être bloquées par ces échecs, sont à **232/232 réussis** sur 39 fichiers dédupliqués. Aucun nouvel échec restant attribué à P1 ; cela ne constitue pas une validation globale entièrement verte.

## Protection du rendu et données au repos

Le contrôle de session et le cloisonnement empêchent l’application d’afficher le cache privé d’une session non autorisée ou d’une autre identité. **Le cache du Registre reste en clair au repos** dans le profil navigateur : ce lot ne le chiffre pas et ne protège pas contre une personne capable de lire les fichiers du profil ou d’exécuter du code dans l’origine.

Les brouillons du Coffre sont chiffrés avec son secret dédié. Le retrait des références JavaScript ne garantit pas l’effacement physique immédiat des pages mémoire. Une requête réseau déjà envoyée avant le verrouillage peut terminer ; son résultat ne doit pas réhydrater l’interface verrouillée.

Le contrôle client de compte actif ne remplace pas les corrections serveur de suspension F02. Les courses de versions/acquittements F04 et la reprise des uploads F05 restent hors de ce lot. Aucun parcours authentifié contre Firebase de production ni vérification des règles actuellement déployées n’a été réalisé ici.

## Repères de code

- Admission et routes : `src/bootstrap/ApplicationBootstrap.tsx`, `applicationBootstrap.ts`, `PrivateCartularyGate.tsx` ; `src/security/privateCartularyAccess.ts`, `privateSessionEvents.ts`, `sessionSecurity.ts`.
- Cache et synchronisation : `src/persistence/localVault.ts`, `cloudDraft.ts`, `useHybridPersistence.ts` ; écriture de création dans `src/services/cartularyCreation.ts`.
- Invalidation UI/médias : `src/features/cartulary/state/useAuthoritativeCartulary.ts`, `src/services/privateMedia.ts`, `src/services/foundations.ts`.
- Coffre : `src/personalVault/PersonalVaultApp.tsx`, `PersonalRecovery.tsx`, `repository.ts`, `sessionSecurity.ts`, `lockedDraft.ts`.
- Démo : initialisation du journal dans `src/App.tsx` via `src/persistence/cartularyJournal.ts` et test `tests/ui/demo-journal-isolation.test.tsx`.

Les modifications antérieures de l’accueil, des styles et de sa documentation ne sont pas revendiquées comme des changements P1.
