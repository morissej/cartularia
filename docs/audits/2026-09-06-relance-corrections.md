# Cartularia — Relance des corrections après le repassage utilisateur

Date : 6 septembre 2026. Périmètre : constats C01–C14 et E01–E03 du repassage utilisateur, en conservant les corrections et modifications préexistantes. Cette livraison locale ne constitue pas une certification de production.

## Vagues exécutées

| Vague | Corrections | Vérification / limite |
|---|---|---|
|1 — Saisies et navigation|Garde de sortie partagée sur formulaires génériques, Nouvel objet et Collection, liens, annulation, historique, déconnexion et changement de Registre ; réponse de secours Coffre tardive protégée.|Tests UI avec saisie conservée et réponse différée. Aucun brouillon personnel ajouté au stockage clair du navigateur.|
|2 — Collections et enrichissement|Suppression d’une Collection vide contrôlée dans une transaction serveur ; suppression atomique de ses éléments publics pour empêcher leur résurrection si l’identifiant est réutilisé ; garde cohérente à la création/réaffectation ; suppression directe refusée par Rules. Édition des listes répétées et ajout/classement/autorisation explicite des médias génériques.|14 tests émulateur de suppression/réaffectation, dont course réelle et recréation du même identifiant. Identité des parents/enfants contrôlée ; nettoyage fermé au-delà de 200 éléments ; aucune suppression d’objet privé. Nouvelle callable et indexes non déployés.|
|3 — Codes et secours|Chargement explicite des seuls codes neutres depuis le Coffre, avec confirmation et retour à usage unique vers la session Registre ; aucun mot de passe, clé ni jeton partagé. Synchronisation des codes en attente conservée dans le payload chiffré, reprise après verrouillage. Liens vers secours/sécurité, étape facultative après création et état de service non confirmé distinct de « aucun kit ».|Isolation COOP du Coffre conservée. Retour par route Registre et BroadcastChannel même origine, capacité liée à l’UID/alias, échéance10min, retrait immédiat du fragment et contrôles stricts. Recette intégrée entre projets réels reste ouverte. Le compte partagé démo ne peut pas installer de kit.|
|4 — Médias, publication et impression|Texte public disponible avant chargement des binaires ; images à l’approche, vidéos au clic, concurrence2 et cache inactif borné ; erreurs distinguées et reprise ; références maintenues au retour navigateur. Bibliothèque moins redondante et blocs interactifs élargis. Rapport préparé avant impression, vues360 statiques, vidéos signalées non reproduites.|Tests réseau/droits/intégrité/reprise et cycle de baux. Navigateur local : rapport Submariner23blocs,38images décodées,0image cassée,0chargement restant, bouton d’impression activé. Aucun fichier PDF enregistré revendiqué. Les médias privés invités sans dérivé autorisé restent indisponibles avec un diagnostic explicite, pas de contournement des droits.|
|5 — Cohérence du parcours|Centre des accès utilise le même routage par type d’objet que le Catalogue. Une erreur À Faire n’est plus un faux état vide. La démo en échec ne reproche plus des identifiants personnels et propose un Cartulaire sans connexion. L’accueil ne promet plus de stocker des contrats dans le Coffre actuel.|Tests UI et lecture navigateur. E03 diagnostiqué : Firebase rejette le jeton App Check de l’origine locale. Aucun contrôle de sécurité désactivé. Recette locale utilisable préparée sur émulateurs.|
|6 — Données fictives et recette|Réparation data-only des cinq dossiers démo distants après simulation et sauvegarde : 38 médias, 5 racines, 5 projections et 5 événements de réparation. Aucun compte, droit, original ou publication modifié.|19 tests ciblés ; transaction distante réussie, simulation suivante sans écriture. Chrome sur Hosting : 5 images décodées, 5 codes et révisions 2 ; 5/5 chaînes vérifiées, 10 événements. L’ancien code Hosting reste distinct des données réparées.|

## Vérifications acquises pendant cette relance

- Suite UI finale : 178 tests / 46 fichiers réussis.
- Suppression/réaffectation de Collection : 14 tests sur Firestore Emulator au passage final rejoué par l’intégration, dont concurrence réelle, suppression des anciennes copies et recréation sans résurrection. Aucune référence d’objet pendante.
- Création/édition/enrichissement :5tests émulateur réussis ; synchronisation :4tests réussis. Une fixture ancienne qui réaffectait vers une Collection inexistante a été corrigée, et le refus de ce cas est désormais testé séparément.
- Rules Firestore :21tests réussis, dont suppression directe d’une Collection refusée même à l’éditeur.
- Secours/activation :3scénarios Auth/Firestore Emulator réussis, véritables sessions SDK, révocation et rotation ; aucune preuve IAM/audience entre projets réels revendiquée.
- Publication/retrait :3scénarios Firestore/Storage Emulator réussis avec suppression physique de copies et reprise après panne.
- Rules Storage : 16 tests réussis dans un émulateur dédié, arrêté proprement ensuite.
- Catalogue IA valide : 85 postes / 85 identifiants. TypeScript, lint et contrôle des espaces du diff réussis.
- Builds site et Coffre réussis dans deux répertoires isolés, sans toucher au `dist` partagé : `/private/tmp/cartularia-relance-20260906-site-final` et `/private/tmp/cartularia-relance-20260906-vault-final`. Avertissements de taille du bundle Coffre et d’import dynamique/static conservés comme limites de performance, pas comme erreurs de compilation.
- Chrome local : connexion démo réelle aux émulateurs, Catalogue 5 objets, Galerie 5 images décodées, diaporama et navigation photo suivante, comparaison de deux objets avec prix/coût/nets distincts, Collection non publiée, Suivi et Accès sans erreur, Preuves 5/5 vérifiées. Ce jeu local reste à la révision initiale 1 ; la réparation distante est à la révision 2.
- Codes Coffre : navigateur sur deux origines de test avec COOP, `opener` absent, fragments retirés, consentement et refus transmis puis acquittés. Services/Auth simulés pour ce parcours : ce n’est pas une preuve Firebase trois projets.

## Accès à la dernière version pour la recette

[Accueil public local](http://127.0.0.1:4197/) · [Entrée du Registre démo](http://127.0.0.1:4197/account/sign-in?demo=1).

Après le bouton « Ouvrir le Registre démo » : [Catalogue](http://127.0.0.1:4197/registry/reg_cartularia_demo/items), [Collections](http://127.0.0.1:4197/registry/reg_cartularia_demo/collections), [Galerie](http://127.0.0.1:4197/registry/reg_cartularia_demo/gallery), [Suivi](http://127.0.0.1:4197/registry/reg_cartularia_demo/follow-up), [Accès](http://127.0.0.1:4197/registry/reg_cartularia_demo/access), [Preuves](http://127.0.0.1:4197/registry/reg_cartularia_demo/integrity).

Le build `/private/tmp/cartularia-relance-20260906-emulator` est issu du code frontend final ; le chunk servi a été comparé au fichier construit. Projet strictement fictif `cartularia-audit-local`, Auth 39499, Firestore 38480, Storage 39419. Les serveurs locaux doivent rester démarrés et ces liens ne fonctionnent que sur ce Mac. Compte en lecture seule, Functions non démarrées, Coffre/pont désactivés dans ce build : ce n’est pas un environnement propriétaire complet ni une mise en ligne. Le lien externe vers le Coffre réel mène encore à sa version déployée.

[Démo en ligne](https://studio-2614005370-a3e51.web.app/account/sign-in?demo=1) : données fictives réparées mais ancien code Hosting, donc **pas** la dernière version de l’interface.

## Ce qui n’est pas livré / reste ouvert

E01 reste ouvert tant que Hosting Registre, Hosting Coffre, Functions, Rules et indexes ne sont pas livrés et recettés ensemble. Ne pas déployer uniquement le client qui attend une nouvelle commande serveur.

Le raccordement serveur du secours nécessite les droits persistants détaillés dans [l’autorisation spécifique](2026-09-06-autorisation-raccordement-secours.md). Le contrôle automatique les a précédemment refusés : cette relance n’a ni réessayé ces droits, ni utilisé le compte de calcul existant pour contourner le refus. Les droits permettraient techniquement de signer des sessions des trois projets et d’accéder aux bases Registre/Coffre à une portée supérieure à celle d’un utilisateur.

Le diagnostic détaillé des dépendances npm précédemment refusé, le runtime de traitement vidéo, les textes juridiques définitifs et la recette propriétaire/invité complète restent des gates de livraison distincts. Aucun audit npm ou changement IAM n’a été tenté pendant cette relance.

E02 : données fictives réparées, sauvegarde persistante et vérification documentées dans [le rapport data-only](2026-09-06-demo-data-only-repair.md). Le libellé « Demo Montres » et certains liens anciens restent visibles avec le vieux bundle public malgré des données conformes ; leur correction attend E01.

E03 : code d’erreur observé dans Chrome sur le site local connecté au vrai Firebase : `auth/firebase-app-check-token-is-invalid.`. La démo se connecte sur le domaine public autorisé et dans la recette émulateur, sans changement des identifiants ni assouplissement App Check. Le service réel sur l’origine locale reste refusé.

La recette mobile réelle, l’impression enregistrée en PDF, l’upload/publication de fichiers réels avec un propriétaire et les parcours invités/administrateur et Coffre trois projets restent à effectuer dans l’environnement adapté. Ne pas confondre les échecs explicites d’un service non déployé avec un parcours validé.

Les tests locaux et composants n’impliquent pas que les mêmes fonctionnalités sont déjà accessibles sur les domaines publics.

Rapports des lots : [Registre et générique](2026-09-06-corrections-repassage-registre.md), [médias](2026-09-06-corrections-repassage-medias.md), [Coffre et codes](2026-09-06-corrections-coffre-raccordement-codes.md).
