# Cartularia — Repassage utilisateur après corrections

Date : 6 septembre 2026. Audit de vérification uniquement : aucune correction du code, publication, invitation, création de compte ou modification de données métier n’a été exécutée. Ce rapport complète, sans les remplacer, l’audit initial et le journal des corrections.

## Conclusion

**Le site est plus clair dans sa version locale, mais le parcours utilisateur complet n’est pas encore validé.** Les contrôles de composants passent ; plusieurs raccordements entre écrans restent incomplets ou dangereux pour la saisie. La démonstration ne doit pas servir de preuve d’un cycle propriétaire → invité → publication réellement opérationnel.

Trois priorités : sécuriser les saisies, raccorder les parcours Coffre/Registre et médias/publication, puis effectuer une recette intégrée avant livraison coordonnée. Le passage présent n’autorise pas à clôturer les 42 constats initiaux.

## Versions réellement examinées

- **Site en ligne** : [Accueil public](https://studio-2614005370-a3e51.web.app/), puis connexion au compte démo partagé en lecture seule. L’accueil conserve « Rapport PDF Opposable », « indemnisé sans contestation » et un pied de page juridique sans liens : les corrections locales ne sont pas livrées sur cet accueil.
- **Coffre en ligne** : [domaine dédié](https://cartularia-vault-a3e51.web.app/). Le lien local de récupération arrive sur son ancien formulaire, sans kit. Son bouton « Accueil » revient sur le Coffre lui-même.
- **Candidat local** : build refait depuis le checkout courant, servi sur [127.0.0.1:4191](http://127.0.0.1:4191/). Sortie isolée : `/private/tmp/cartularia-repassage-20260906-site`. SHA-256 de `index.html` : `a1dd8e01f79ed2ba764ef235c20302911e20d78e0dbece958801504400e2561a`, identique à l’entrée du dernier build documenté. Cette empreinte n’identifie pas à elle seule tout le checkout.
- Le serveur local utilise les services Firebase configurés : il ne constitue pas un environnement intégré autonome. Aucun nouveau service serveur n’a été déployé pendant ce passage.
- Le port 4187 étant déjà occupé, aucun processus existant n’a été arrêté ; cette recette utilise 4191.

## Parcours effectivement refaits

| Parcours | Niveau de preuve actuel | Résultat |
|---|---|---|
| Accueil public | Navigateur, en ligne et local | Anciennes promesses encore en ligne ; discours et liens du pilote corrigés localement |
| Création d’accès | Formulaire local, sans saisie de secrets ni soumission | Trois étapes, confirmation du mot de passe, conditions et confidentialité accessibles |
| Conditions / confidentialité | Pages locales ouvertes par leurs liens | Textes lisibles, limites du pilote explicites ; mentions définitives restent à finaliser |
| Registre démo | Connexion réelle sur Hosting | Ouverture réussie, cinq objets, lecture seule |
| Registre local connecté à Firebase | Deux origines locales : 127.0.0.1 puis localhost | Échec de connexion démo ; diagnostic exact non établi, voir E03 |
| Vue d’ensemble / Catalogue / Collections / Galerie / Suivi / Accès / Preuves / Administration du Registre | Huit rubriques du Registre démo en ligne | Toutes accessibles ; Galerie et données de démo toujours dégradées |
| Recherche / comparaison | Recherche Rolex puis Tudor, ajout de deux objets, comparaison, retour, effacement au clavier | Fonctionne ; filtre conservé au retour ; écarts de données toujours visibles |
| Cinq Cartulaires fictifs | Couvertures locales des cinq objets | Titres distincts, images chargées, mention lecture seule présente |
| Cartulaire Submariner | Six pages locales | Accueil, Médias, Référence, Objet, Valorisation et Publication accessibles |
| Mini-site Submariner | Vrai lien « Accéder » depuis Publication locale | Aperçu explicitement non publié ; quatre pages publiques proposées |
| Médias du mini-site | Navigation réelle | Rotation 0° → 26°, diaporama 01/03 → 02/03, liens de téléchargement nommés ; vidéo chargée sans erreur |
| Secours Registre | Écran local sans kit soumis | Explications et liens présents ; aucune récupération réelle revendiquée |
| Coffre | Formulaire local de secours et domaine dédié en ligne | Interface corrigée visible localement ; ancien écran livré, aucun Coffre réellement déverrouillé |
| Cercle | État local sans session | Connexion requise, lien de connexion et retour Registre |
| Administration globale | État local sans session | Formulaire restreint et exigence du rôle serveur ; aucune opération privilégiée |
| Invitation incomplète | Route locale sans jeton | Erreur explicite, acceptation désactivée |
| Collection publique sans identifiant | Route locale incomplète | Message explicite et retour vers l’accueil |

La vidéo du mini-site local dispose d’un `readyState=4`, d’une durée de 4,684812 s et d’aucune erreur média. Le texte de repli HTML « Votre navigateur ne peut pas lire cette vidéo » présent dans l’extraction DOM **n’est donc pas compté comme une panne**. La lecture effective et un téléchargement avaient été démontrés au passage précédent ; ce passage recontrôle le chargement et les liens, sans revendiquer un nouveau fichier téléchargé ou un nouveau PDF enregistré.

## Écarts actuellement visibles dans le navigateur

### E01 — P1 · Les corrections locales et les sites livrés ne forment pas encore un parcours cohérent

Le visiteur de l’accueil en ligne voit encore les anciennes promesses et les anciennes portes d’accès. Depuis le secours Registre local, « Récupérer plutôt mon Coffre » ouvre `https://cartularia-vault-a3e51.web.app/?mode=recover`, mais ce domaine ne propose aucun mécanisme de kit dans la version servie. Le bouton « Accueil » du Coffre livré boucle vers sa propre racine.

**Impact :** un lien peut sembler correct alors que la fonctionnalité d’arrivée n’existe pas dans la version livrée. Ce n’est pas un nouveau défaut de récupération cryptographique démontré : c’est un défaut de livraison coordonnée, observé.

**Clôture attendue :** recette des liens entre domaines sur une version effectivement alignée, après levée des prérequis de livraison.

### E02 — P2 · La démonstration du Registre reste incohérente et visuellement incomplète

Les cinq cartes de Galerie affichent « Image indisponible ». Le Catalogue et la comparaison affichent « Demo Montres », contre « Les cinq icônes » dans Collections. Les codes objet sont « — ». La comparaison Rolex affiche prix de revient **8 850 €**, valeurs nettes non renseignées et projection datée du 22 août ; le Cartulaire local présente des valeurs nettes de **9 270 €**.

Les cinq dossiers restent « Import à vérifier » ; Suivi et Accès n’illustrent aucun exemple. La page Preuves, elle, affiche cinq chaînes vérifiées et aucun ancrage public confirmé : ces notions distinctes doivent rester expliquées.

**Impact :** la première visite donne une impression de données cassées et ne montre pas les bénéfices du suivi et du partage. La réparation de données préparée n’est pas réputée appliquée.

### E03 — P2 · La recette du Registre local est bloquée par une connexion démo peu explicite

Sur `127.0.0.1:4191` et `localhost:4191`, « Ouvrir le Registre démo » revient à « Connexion impossible. Vérifiez vos identifiants et réessayez ». Le même bouton fonctionne sur Hosting.

Un avertissement Firebase Auth/App Check `recaptcha-error` a été relevé, **sans preuve que cet avertissement soit la cause du refus**. Les identifiants démo, leur dérivation et la configuration Registre n’ont pas changé par rapport à l’archive pré-corrections. Aucun seed, changement de mot de passe ou contournement App Check n’a été tenté.

**Impact :** la version candidate n’est pas recettable ici de bout en bout avec la session démo, et le message reproche des identifiants que l’utilisateur n’a pas saisis. Vérifier code HTTP/code d’erreur du service Auth et configuration d’origine, sans exposer identifiants ou jetons.

## Défauts restant dans le code candidat

Les constats C01–C14 ci-dessous proviennent du code relu maintenant. Seules les reproductions explicitement mentionnées ont été exécutées ; aucun scénario destructif ou compte réel n’a été utilisé.

### C01 — P1 · Les codes du Coffre ne sont pas raccordés au Cartulaire entre domaines

**Parcours :** créer un lieu/personne dans le Coffre dédié → revenir au Cartulaire → choisir ce lieu/personne. L’authentification du pont est faite dans le Coffre, avec une persistance par origine. Le Cartulaire attend sa propre session pont, sans voie de connexion dédiée sur le domaine Registre ; en son absence, le sélecteur reçoit simplement une liste vide.

**À corriger :** organiser un accès minimal aux seuls codes avec un parcours et un diagnostic explicites. Ne pas transférer le mot de passe du Coffre et ne pas fusionner les bases.

Preuves : [connexion du pont](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/repository.ts:51>), [persistance](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/codeBridgeFirebase.ts:14>), [liste vide sans session](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/codeBridgeRepository.ts:143>), [abonnements Cartulaire](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/App.tsx:877>). Recette réelle multidomaine requise.

### C02 — P1 · Une réponse de récupération peut écraser une saisie récente du Coffre

**Parcours :** Coffre ouvert et propre → lancer « Ouvrir avec mon kit » → saisir pendant l’attente → réception de la réponse. Le formulaire de récupération conserve son attente localement ; les champs du Coffre ne sont pas désactivés par cette attente. La réponse remplace ensuite le formulaire sans vérifier les saisies intervenues depuis.

**À corriger :** partager l’état d’opération et/ou rejeter une réponse devenue obsolète. Ajouter un test avec réponse retardée et nouvelle saisie.

Preuves : [attente locale](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/PersonalRecovery.tsx:21>), [remplacement du formulaire](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/PersonalVaultApp.tsx:155>), [champs éditables](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/PersonalVaultApp.tsx:242>). Analyse du code, pas reproduction sur Coffre distant.

### C03 — P1 · Cocher un média générique ne l’ajoute pas à la publication

Le chargeur générique classe tous les médias « Secret ». Le sélecteur propose pourtant « Médias que vous autorisez à rendre publics », mais ne change pas cette autorisation. La construction du mini-site exclut donc les médias cochés.

**Reproduction pure exécutée :** un média coché → zéro média dans la demande ; même entrée explicitement « Tous » → un média.

**À corriger :** raccorder l’autorisation explicite et sa persistance ; ne pas supprimer le filtre de confidentialité.

Preuves : [chargement Secret](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/services/genericCartulary.ts:19>), [filtre public](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/domain/websiteDraft.ts:31>), [sélecteur](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/GenericCartularyView.tsx:155>).

### C04 — P2 · Quitter un formulaire générique peut perdre les modifications

La confirmation ne protège que les six boutons de page. « Retour au Registre », le logo et le rechargement ne sont pas protégés ; les modifications vivent dans l’état React. Nouvelle Collection et Nouvel objet demandent également une garde de départ.

**À corriger :** appliquer la même protection aux sorties, annulations et rechargements, avec conservation du brouillon si appropriée.

Preuves : [navigation partiellement gardée](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/GenericCartularyView.tsx:86>), [liens de sortie](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/GenericCartularyView.tsx:112>). Non provoqué sur dossier réel.

### C05 — P2 · Une Collection peut être supprimée sur un inventaire devenu périmé

Le contrôle « Collection vide » est effectué dans l’interface. La suppression ne recontrôle pas autoritairement l’absence d’objets. Si un second utilisateur ajoute un objet entre l’affichage et la confirmation, la Collection et sa vitrine peuvent disparaître avec un objet encore rattaché.

**À corriger :** garde serveur cohérente avec la création et résistante à la concurrence.

Preuves : [garde interface](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/registry/RegistryCollections.tsx:143>), [suppression](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/services/collections.ts:139>), [Rules](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/firestore.rules:207>). Scénario déduit, non exécuté.

### C06 — P2 · Une montre ouvre une interface différente selon le point d’entrée

« Gérer dans le Cartulaire » du Centre des accès omet le type d’objet. Une nouvelle montre peut ainsi ouvrir l’interface générique au lieu du Cartulaire montre complet.

**Reproduction pure exécutée :** `cart_watch_user_123` → `/cartulary-view` sans type, contre `/cartulary` depuis le Catalogue avec type montre.

Preuves : [lien Accès](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/registry/RegistryAccessCenter.tsx:320>), [résolution de route](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/registry/registryCatalog.ts:76>). Utiliser une résolution canonique commune.

### C07 — P2 · Une panne du suivi peut être affichée comme une absence de tâches

Le chargement de la projection objet et l’abonnement aux tâches génériques ignorent certaines erreurs. L’état initial vide peut aboutir à « Aucune tâche à traiter » ou à la disparition du tableau.

**À corriger :** distinguer chargement, absence de tâche et échec, conserver l’état connu et proposer une reprise.

Preuves : [erreurs absorbées](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/GenericCartularyPage.tsx:80>), [abonnement](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/GenericCartularyPage.tsx:89>), [état vide](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/registry/RegistryTodoBoard.tsx:170>).

### C08 — P2 · Le vrai mini-site attend tous ses médias avant son premier contenu

Le chargeur télécharge intégralement les fichiers en Blob, deux par deux, avant de rendre les blocs. Une vidéo non lue ou des photos d’une autre page retardent donc même la lecture du texte. Le budget admis peut atteindre 150 Mio ; aucun temps réseau réel n’a été mesuré ici.

**À corriger :** afficher le contenu textuel immédiatement et charger les médias visibles ou demandés. La fluidité de l’aperçu démo ne valide pas ce chargeur distant.

Preuves : [attente de tous les fichiers](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/services/projections.ts:59>), [écran de chargement](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/App.tsx:2631>).

### C09 — P2 · Certaines photos privées ne permettent pas de réessayer après une coupure

Après échec, l’image est remplacée par « Média indisponible ». Aucun bouton de reprise n’est proposé ; les dépendances de l’effet restent inchangées au retour du réseau.

**À corriger :** reprise explicite par média et état distinct fichier absent / session requise / problème réseau.

Preuves : [échec mémorisé](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/PrivateMediaImage.tsx:76>), [rendu sans reprise](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/PrivateMediaImage.tsx:121>).

### C10 — P2 · Une panne d’un fichier public est présentée comme une copie absente

Toute erreur de téléchargement devient une URL nulle, puis un message « pas de copie publique disponible ». L’utilisateur ne peut pas distinguer panne temporaire et retrait effectif.

**À corriger :** conserver le type d’échec et proposer un nouvel essai par fichier.

Preuves : [erreur transformée en null](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/services/projections.ts:67>), [message public](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/ProjectedPublicBlock.tsx:62>).

### C11 — P2 · Le secours Registre est peu découvrable après inscription

Le formulaire public propose le secours, mais la connexion directe `/registry` ne propose pas « Mot de passe oublié ». Le Registre connecté n’offre pas d’entrée Sécurité/Kit. La création redirige immédiatement vers le Registre : le lien de préparation placé sur l’inscription n’accompagne pas l’utilisateur ensuite.

**À corriger :** accès permanent au secours et étape de préparation après création, sans prétendre qu’un kit non activé récupère un compte.

Preuves : [connexion directe](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/registry/RegistryApp.tsx:183>), [navigation connectée](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/registry/RegistryApp.tsx:317>), [redirection de création](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/public/AccountAccessPage.tsx:61>).

### C12 — P2 · « Enregistrer et verrouiller » peut masquer l’échec du pont de codes

Si l’enregistrement chiffré réussit mais pas la synchronisation des codes, un avertissement est préparé, puis remplacé par « Coffre verrouillé ». Les données du Coffre sont enregistrées, mais le raccordement des nouveaux codes reste incomplet sans reprise visible.

**À corriger :** conserver ce statut après verrouillage et offrir une reprise identifiable.

Preuves : [sauvegarde et avertissement](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/PersonalVaultApp.tsx:108>), [message de verrouillage](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/PersonalVaultApp.tsx:139>).

### C13 — P2 · Le parcours automobile ne permet pas un enrichissement complet après création

Le formulaire initial accepte des pièces, mais la page Médias générique ne propose ensuite que consultation et téléchargement. Aucun ajout, remplacement, retrait, classification ou autorisation publique n’y est offert. Les listes répétées sont renvoyées à des « parcours dédiés » sans lien vers ces parcours.

**À corriger :** proposer les actions réelles d’enrichissement ou annoncer précisément cette limite avant création.

Preuves : [formulaire initial](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/registry/NewCartularyPage.tsx:224>), [limites éditoriales](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/GenericCartularyView.tsx:138>), [médias consultatifs](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/GenericCartularyView.tsx:148>).

### C14 — P2 · Le Coffre ne permet pas de déposer les contrats annoncés par l’accueil

L’accueil local invite à conserver les « contrats d’assurance » dans le Coffre, qui ne propose que des fiches personnelles et aucun téléversement de pièce jointe.

**À corriger :** ajuster la promesse, ou créer et recetter un véritable stockage chiffré de documents.

Preuves : [promesse](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/public/HomePage.tsx:617>), [contenu du Coffre](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/PersonalVaultApp.tsx:245>), [modèle](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/types.ts:52>).

## Design et confort

**Améliorations confirmées :** accueil local plus précis, architecture en six pages, titres contextualisés, indicateur « Aperçu local · non publié », noms de téléchargements et retour public du mini-site. L’identité graphique reste cohérente sur les écrans ordinateur examinés.

**Reste à améliorer :**

- Le mini-site répète les mêmes fichiers sous la photo principale, les 14 vues du 360°, le diaporama et la bibliothèque. La longue liste de téléchargements détourne l’attention du contenu. Regrouper les fichiers uniques dans une bibliothèque claire, en gardant un téléchargement direct au bon endroit.
- Le diaporama public occupe une colonne étroite avec beaucoup d’espace vide sur grand écran. Rééquilibrer les blocs interactifs selon leur contenu.
- Le parcours démo montre des pages À Faire, Accès et Collections publiées vides : ajouter des exemples figés et explicitement fictifs serait plus instructif.
- L’interface emploie encore des formulations techniques (« projection », « palier », « chaîne », « organisation »). Les expliquer à l’endroit où elles conditionnent une décision utilisateur.
- Le Cercle reste surtout textuel dans le code, sans présentation média complète.

Ces points sont des améliorations de confort, pas tous des pannes.

## Risques à reproduire avant validation finale

| Scénario | Risque établi par lecture du code | Test manquant |
|---|---|---|
| Invité autorisé, appareil neuf | Le résolveur privé recherche les binaires sous l’UID du lecteur, alors que les originaux restent réservés au propriétaire ; aucune chaîne alternative de dérivés privés n’est raccordée dans ce chemin | Propriétaire partageant à un invité, ouverture sans cache des photos, PDF, vidéo et téléchargements ; conserver la protection des originaux |
| Impression montre, appareil neuf | Images privées du rapport caché dépendantes de l’intersection à l’écran, impression immédiate sans attente | PDF réel avec plusieurs photos cloud et plusieurs pages, vérification des images et sauts de page |
| Retour arrière navigateur | Les URL Blob sont révoquées à `pagehide` sans reprise à `pageshow` | Aller-retour avec cache arrière/avant sur Chrome et Safari |
| Mobile / tactile / accessibilité | Nouvelle réduction de viewport non effective : largeur DOM restée 1728 px malgré demande 390 × 844 | Recette téléphone réelle/simulée vérifiée, menu, tableaux Registre, saisie, dialogues et lecteur d’écran |

Sources techniques : [médias invités](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/services/privateMedia.ts:71>), [Rules des originaux](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/storage.rules:43>), [bibliothèque du rapport](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/App.tsx:2448>), [conteneur caché](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/index.css:2558>), [impression immédiate](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/utils/pdfExport.ts:117>), [révocation pagehide](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/services/privateMedia.ts:122>).

La taille mobile a été réinitialisée après tentative. **Aucune nouvelle validation mobile n’est revendiquée**, et l’ancienne capture mobile du journal n’est pas présentée comme une preuve de ce passage.

## Contrôles techniques rejoués et limites

- Suite d’interface complète : **127 tests réussis, 35 fichiers**, rejouée après construction du candidat. Les suites ciblées des relectures sont comprises dans cette suite, pas ajoutées artificiellement à ce total.
- Tests Node purs du périmètre Registre : **40 réussis** ; deux reproductions pures supplémentaires décrites en C03 et C06.
- Build principal et TypeScript : réussis. Avertissement de découpage `cartularyIds` conservé, sans panne de build.
- `git diff --check` : réussi.
- Une suite communauté exigeant Firestore ne disposait pas de l’émulateur attendu : pas de conclusion sur les Rules à partir de cet arrêt de préparation.
- Aucune nouvelle recette des Rules, de récupération multi-projet, de publication/révocation serveur, ni de synchronisation distante n’est revendiquée à partir des résultats du passage précédent.
- Pas de création/édition propriétaire réelle, de Coffre déverrouillé, d’invitation valide, de retrait à deux sessions, d’administration privilégiée, de Safari/Firefox ni de PDF final examinés.
- Les prérequis connus restent ouverts : IAM de secours non accordé, nouveaux services non livrés, runtime vidéo non provisionné, seed démo non appliqué, dépendances à instruire et textes définitifs à finaliser. Leurs statuts détaillés restent dans le journal précédent ; aucun de ces droits ou changements distants n’a été appliqué ici.

## Ordre de reprise recommandé

1. **Protection et raccordements essentiels** : C01–C05 et C12 ; démontrer absence de perte et de publication involontaire.
2. **Parcours complets** : C06–C11 et C13–C14, puis invité sans cache, génération PDF, erreurs/reprises et média lourd.
3. **Recette intégrée** : environnement authentifiable, propriétaire + invité sur deux navigateurs, trois domaines, vrais services et données fictives maîtrisées.
4. **Livraison coordonnée et recette publique** : aligner les versions, réparer la démo explicitement, revérifier chaque porte d’entrée et les liens de sortie.
5. **Finition** : mobile, accessibilité, vocabulaire, hiérarchie média et exemples de suivi/partage.

**Décision proposée : poursuivre les corrections ; ne pas présenter encore l’ensemble comme prêt pour un usage patrimonial complet.**

