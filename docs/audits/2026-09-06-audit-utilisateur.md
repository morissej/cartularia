# Cartularia — Audit du parcours utilisateur

Date : 6 septembre 2026 · Point de départ : [Accueil public Cartularia](https://studio-2614005370-a3e51.web.app/).

## Appréciation générale

Cartularia possède une identité visuelle reconnaissable et un dossier horloger riche. La découverte d’un Cartulaire fictif fonctionne, le Registre démo est accessible sans inscription, et la structure en six pages aide à se repérer. En revanche, le parcours complet n’est pas encore suffisamment cohérent pour qu’un nouvel utilisateur puisse créer, documenter, conserver et partager son patrimoine avec confiance.

Le principal problème est le décalage entre ce qui est annoncé, ce que l’interface semble confirmer et le résultat obtenu. La publication, la séparation du Coffre, la cohérence des données entre Registre et Cartulaire, ainsi que plusieurs retours de navigation demandent une correction avant de présenter l’ensemble comme un service abouti.

Ce rapport recense **42 constats et améliorations**, avec leur niveau de preuve. Il ne transforme pas une fonctionnalité non testée en fonctionnalité défaillante.

## Périmètre et méthode

Audit du site Firebase en ligne dans Chrome, avec examen visuel sur ordinateur à 1728 × 906 et sur téléphone simulé à 390 × 844. Parcours réalisés avec une session démo en lecture seule, puis sans session ; lecture parallèle du code actuel pour les opérations nécessitant un propriétaire ou un administrateur. Aucune création de compte réel, publication, invitation, suppression ou modification de contenu métier n’a été exécutée.

La version auditée charge `index-2M4rMv2X.js`. Son empreinte SHA-256 a été comparée au fichier local : correspondance exacte. Même vérification pour `PersonalVaultApp-jENLcAJ_.js`. Le checkout contient des modifications non commitées : le dernier commit `94bba9c` n’identifie donc pas, seul, tout le code livré. L’audit n’a pas déclenché de déploiement.

Niveaux de preuve utilisés :

- **Observé** : résultat obtenu sur le site en ligne pendant cet audit.
- **Reproduit localement** : comportement exécuté dans un composant de test, sans modification des données du site.
- **Code** : défaut ou parcours établi par lecture du code ; les préconditions sont indiquées lorsque son impact dépend d’un état particulier.
- **Amélioration UX** : jugement d’usage ou de présentation, distinct d’une panne.

Priorités : **P1** = compromettre l’accès, la conservation, le partage ou la confiance ; **P2** = gêne importante, résultat incorrect ou fonction incomplète ; **P3** = clarté, confort ou finition.

### Parcours effectivement examinés

| Surface | Vérification réalisée | Résultat principal |
|---|---|---|
| Accueil public | Contenu, liens, pied de page, menu et mise en page mobile | Accessible ; promesses excessives et défaut de menu mobile |
| Création de compte | Formulaire Registre et passage vers Coffre | Deux créations séparées ; conditions non consultables |
| Connexion / démo | Ouverture réelle du compte partagé | Connexion démo réussie, accès en lecture seule |
| Coffre personnel | Écran de création, configuration du code livré | Interface disponible ; séparation physique annoncée non respectée par le repli de configuration |
| Registre démo | Vue d’ensemble, Catalogue, Collections, Galerie, Suivi, Accès, Preuves, Administration | Les huit rubriques s’ouvrent ; données de démonstration incomplètes |
| Catalogue / comparaison | Recherche Rolex, effacement au clavier, sélection Rolex + Tudor, comparaison | Recherche et comparaison fonctionnent ; écarts avec le dossier source |
| Cinq Cartulaires démo | Ouverture et couverture des cinq objets | Cinq titres et cinq couvertures correctement chargés |
| Submariner | Les six pages, photos, documents affichés, valorisation, publication | Dossier riche ; partage public non découvrable dans le parcours démo |
| Médias Submariner | Téléchargement photo, ouverture 360°, passage de 0° à 26° | Événement de téléchargement reçu ; rotation manuelle fonctionnelle |
| Mini-site Submariner | Aperçu explicite avec médias sélectionnés, commandes et liens | Téléchargements présents ; faux bouton Lecture |
| Mini-sites pilotes IWC et Rolex | Ouverture des liens canoniques précédemment fournis | IWC : aperçu local ; Rolex : aperçu local et « Aucun contenu validé » |
| Cartulaire privé IWC sans session | Message et lien de connexion | Originaux distants verrouillés avec explication ; comportement attendu |
| Mini-site Collection | Adresse sans identifiant + lecture du parcours de publication | État « Adresse de Collection incomplète » ; pas de Collection publiée testée de bout en bout |
| Cercle | Visite avec session démo | « Admission au Cercle requise », sans démarche d’admission |
| Administration globale | Visite avec session démo non administratrice, puis retour au Registre | Refus normal, mais déconnexion involontaire du Registre |

Les créations/modifications avec un compte propriétaire, la récupération de compte, un Coffre réellement déverrouillé, une invitation valide, la publication/révocation serveur et l’administration privilégiée n’ont pas été exécutées. Leurs constats ci-dessous sont explicitement fondés sur le code. La compatibilité Safari/Firefox, les lecteurs d’écran réels, la performance réseau mesurée et la valeur juridique des documents ne sont pas certifiées par cet audit.

## 1. Accueil, compréhension et premier accès

### 01 — P1 · La séparation physique annoncée ne correspond pas à la configuration livrée

**Observé + code.** L’accueil affirme que Cartularia « sépare physiquement » dossiers et identité ; le Coffre affiche « SITE DÉDIÉ · BASES SÉPARÉES ». Pourtant, sans configuration dédiée, le Coffre et le pont de correspondance se replient sur le projet Firebase du Registre. Ce repli est présent dans le fichier Coffre effectivement livré. Le contrôle interdisant un projet identique ne couvre pas ce cas.

**Impact :** l’utilisateur prend sa décision de confier ses informations sur une propriété technique qui n’est pas assurée. Cela ne démontre pas une fuite : le chiffrement du contenu est une question distincte.

**À faire :** faire correspondre l’architecture réellement provisionnée au discours et refuser le repli silencieux si l’isolement est requis. Sources : [configuration Coffre][vault-config], [configuration correspondance][bridge-config], [accueil][home].

### 02 — P2 · L’inscription demande d’accepter des textes qu’on ne peut pas lire

**Observé + code.** La case d’inscription exige l’acceptation des conditions et de la confidentialité, sans lien vers ces textes. Le formulaire de contact mentionne aussi une politique absente. Au pied de l’accueil, « Confidentialité · Conditions d’utilisation · Accessibilité WCAG AA » est un simple texte.

**Impact :** impossible de comprendre les engagements, l’usage des données ou de vérifier la promesse d’accessibilité avant d’accepter.

**À faire :** publier les informations correspondantes et rendre leurs liens disponibles au point de consentement. Source : [compte][account], [pied de page public][home-footer].

### 03 — P2 · Les promesses dépassent les résultats démontrés

**Observé + amélioration de contenu.** L’accueil emploie « dossier opposable », « Rapport PDF Opposable », « directement recevable », « indemnisé sans contestation », « horodatage certifié ». L’aperçu commercial affiche « 100% documenté » et « Ancré & daté », alors que le Registre démo indique cinq imports à vérifier et aucun ancrage public confirmé.

**Impact :** le visiteur peut confondre mise en forme documentaire, vérification d’intégrité, expertise d’objet et acceptation par un tiers.

**À faire :** décrire précisément les services disponibles et leurs limites, distinguer illustration commerciale et état réel d’un dossier, documenter les garanties revendiquées. Il s’agit ici d’un écart de promesse observé, pas d’une conclusion juridique. Sources : [accueil][home], [vue d’ensemble][overview], [preuves du Registre][integrity].

### 04 — P2 · « Créer mon dossier » mène d’abord à un problème d’architecture

**Observé + amélioration UX.** Après l’appel à l’action, le visiteur découvre « Un nom utilisateur, deux clés différentes », deux accès à créer et plusieurs notions nouvelles. Aucun état de progression ne dit quel accès existe déjà ni à quel moment le Coffre est nécessaire.

**Impact :** effort de compréhension élevé avant le premier objet ; risque de création partielle ou d’abandon.

**À faire :** guider par l’usage : accès Registre → premier objet → enrichissement → proposition du Coffre lorsque nécessaire. Montrer la progression et les accès déjà créés. Source : [page de compte][account].

### 05 — P2 · L’entrée dédiée au Coffre ne conduit pas directement au Coffre

**Code, parcours visible dans les liens.** « Accéder au Coffre » mène à la page générale avec `space=vault`. Ce paramètre modifie surtout l’emphase visuelle ; la démonstration et le formulaire Registre restent avant le Coffre.

**Impact :** l’utilisateur doit refaire un choix qu’il vient d’exprimer, particulièrement pénalisant sur téléphone.

**À faire :** placer l’accès demandé en premier ou conduire directement à son écran de connexion. Source : [page de compte][account].

### 06 — P3 · Le coût et les limites du service ne sont pas expliqués avant l’inscription

**Observé + amélioration de contenu.** Aucun tarif, gratuité clairement délimitée, quota, volume de stockage, durée de conservation ou niveau de disponibilité n’est présenté dans l’accueil et la création examinés.

**Impact :** le visiteur ne sait pas à quoi il s’engage ni si le service convient à sa collection.

**À faire :** présenter ce qui est inclus, les limites, la disponibilité et les conditions d’export/conservation dans un langage simple. Sources : [accueil][home], [compte][account].

### 07 — P3 · Le contact prépare un email mais ne transmet pas la demande

**Code.** Le bouton est correctement nommé « Préparer le message », mais toute la saisie aboutit à un lien `mailto:`. Le message d’état affirme que le client mail a été préparé, sans savoir s’il existe ou s’est ouvert.

**Impact :** un utilisateur sans application mail configurée peut avoir saisi tout le formulaire sans envoyer quoi que ce soit.

**À faire :** annoncer ce fonctionnement avant la saisie et proposer de copier le message complet ; ou prévoir un véritable envoi avec confirmation de réception. Aucun message de test n’a été envoyé. Source : [traitement du contact][contact].

## 2. Compte et Coffre personnel

### 08 — P1 · Aucun parcours de récupération d’accès n’est proposé

**Observé + code.** Aucun lien « Mot de passe oublié » ni mécanisme de secours présenté dans les accès examinés. Le pseudonyme Registre est transformé en adresse technique `.invalid` : une simple réinitialisation par email ne peut donc pas être supposée suffisante.

**Impact :** l’oubli d’un mot de passe peut devenir une impasse, particulièrement critique pour un outil de conservation dans la durée.

**À faire :** définir la récupération d’identité et le secours de déchiffrement du Coffre, puis les expliquer avant création. Ajouter au Coffre une confirmation de mot de passe et une commande d’affichage temporaire. Sources : [authentification][foundations], [compte][account], [Coffre][vault].

### 09 — P1 · Une inscription interrompue peut laisser un compte créé mais inutilisable

**Code, condition : l’activation échoue après la création Auth.** La création de l’identité est suivie d’un appel d’activation. Si ce second appel échoue, un nouvel essai de création rencontre un nom déjà utilisé ; la connexion normale ne reprend pas l’activation. Le Registre peut alors afficher un manque de contexte ou de « membership ».

**Impact :** l’utilisateur suit « Réessayez » et s’enferme dans une boucle.

**À faire :** activation reprenable et idempotente ; écran « Terminer la création de mon Registre » avec action explicite. Incident non provoqué sur le service. Sources : [création/connexion][foundations], [sélection du contexte Registre][registry-app].

### 10 — P2 · Deux formulaires de connexion appliquent des règles différentes

**Code, condition : compte valide avec mot de passe historique de moins de 12 caractères.** La connexion publique impose la longueur de création, contrairement à la connexion directement accessible au Registre.

**Impact :** des identifiants peuvent fonctionner par une porte et être refusés par l’autre.

**À faire :** réserver les exigences de création à la création ou au changement de mot de passe, et partager la logique des connexions. Sources : [compte][account], [Registre][registry-app].

### 11 — P1 · Des modifications du Coffre peuvent être perdues sans avertissement

**Code.** Enregistrer, modifier ensuite une fiche, puis verrouiller, recharger ou quitter ne déclenche pas de contrôle des modifications non enregistrées. Le verrouillage efface l’état du formulaire. Le message de succès d’un précédent enregistrement peut rester affiché après de nouvelles saisies.

**Impact :** perte de données saisies avec une impression trompeuse de sauvegarde.

**À faire :** état fiable « Modifications non enregistrées », confirmation avant départ et action « Enregistrer et verrouiller ». Prévoir annulation ou confirmation pour les suppressions de fiches. Aucun Coffre réel n’a été modifié pour ce test. Source : [gestion du Coffre][vault].

### 12 — P3 · Une fiche de gestionnaire peut être prise pour une délégation effective

**Code + amélioration UX.** Le Coffre décrit des personnes désignées pour gérer le compte, mais leur ajout ne crée qu’une fiche descriptive. Il n’accorde ni compte, ni invitation, ni permission. Une fois le Coffre ouvert, les retours vers Accueil/Registre sont également peu découvrables.

**Impact :** le propriétaire peut penser avoir organisé une continuité d’accès alors qu’il a seulement enregistré un contact.

**À faire :** nommer clairement « Contacts gestionnaires », distinguer désignation et accès activé, et ajouter des retours explicites protégés contre la perte de saisie. Source : [Coffre][vault].

## 3. Registre, Collections et démonstration

### 13 — P2 · Les cinq images de la Galerie démo sont indisponibles

**Observé + code.** La Galerie affiche cinq cartes « Image indisponible », alors que les cinq couvertures se chargent correctement dans leurs Cartulaires. Les médias de démonstration ne sont pas raccordés aux documents consultés par la Galerie.

**Impact :** l’écran destiné à faire découvrir visuellement la collection semble défaillant dès le premier essai.

**À faire :** utiliser une projection média démo cohérente avec les dossiers. Sources : [chargement Galerie][gallery-service], [projection démo][demo-projection], [initialisation démo][demo-seed].

### 14 — P2 · Le Registre et le Cartulaire démo affichent des données différentes

**Observé + code.** Pour la Submariner, la comparaison Registre affiche un prix de revient de **8 850 €**, contre **9 480 €** dans le Cartulaire. Les valeurs nettes sont « Non renseignées » dans le Registre et **9 270 €** dans le dossier. Les cinq codes objet du Catalogue sont « — » alors que les Cartulaires ont des codes DEMO. Les cinq dossiers sont « Import à vérifier ».

**Impact :** l’utilisateur ne sait plus quel écran fait foi et peut prendre une décision sur une synthèse incomplète.

**À faire :** alimenter le Registre depuis le même état de référence, identifier les données périmées et expliquer les statuts de démonstration. Le code de projection fixe actuellement `costBasis` au seul prix d’achat, les valeurs nettes à vide et `objectCode` à `null`. Source : [projection démo][demo-projection].

### 15 — P2 · La démonstration ne permet pas de découvrir naturellement tous les livrables promis

**Observé + amélioration UX.** « Voir la projection de partage » ouvre la page Publication du Cartulaire. La démo est bien en lecture seule, mais les interrupteurs sont désactivés et aucun accès évident au mini-site fini n’y apparaît dans l’état testé. La Collection n’est pas publiée, Suivi et Accès n’ont aucun exemple.

**Impact :** le visiteur peut explorer la saisie théorique sans voir le résultat que recevra un tiers.

**À faire :** fournir des exemples figés de mini-site, rapport, rappel et invitation, tous clairement fictifs, accessibles en un clic depuis la démo. Garder la lecture seule. Sources : [accueil][home], [publication][publication-ui].

### 16 — P2 · Une Collection change de nom selon l’écran

**Observé + code.** La Collection s’appelle « Les cinq icônes » dans Collections et dans le Cartulaire, mais « Demo Montres » dans Catalogue, Galerie et comparaison. Plusieurs vues transforment directement l’identifiant technique en libellé.

**Impact :** un renommage paraît ne pas avoir été enregistré ; risque de confusion entre plusieurs collections.

**À faire :** résoudre partout l’identifiant vers le nom du document Collection. Sources : [présentation des noms][registry-labels], [Catalogue][catalogue].

### 17 — P2 · La gestion des tâches est dispersée

**Code + amélioration de logique.** Une tâche se modifie dans un Cartulaire ou dans le tableau situé en bas de Vue d’ensemble, tandis que l’onglet Suivi renvoie au Cartulaire. Les alertes du tableau de bord sur des objets suspendus/perdus renvoient également au Suivi, qui liste des rappels plutôt que les objets concernés.

**Impact :** l’utilisateur doit chercher où agir alors qu’un centre de suivi existe.

**À faire :** faire de Suivi le centre opérationnel, garder des résumés ailleurs, et ouvrir une liste filtrée pertinente pour chaque alerte. La source de données commune est un point positif ; le défaut porte sur le parcours. Sources : [vue d’ensemble][overview], [Suivi][follow-up].

### 18 — P2 · « Ajouter un objet » reste un parcours de création de montre

**Code.** La création appelle toujours `createWatchCartulary`, fixe le type et le schéma montre, et n’offre pas de choix initial du type. Les objets non horlogers utilisent en outre une vue générique beaucoup moins fonctionnelle que la démo : listes de valeurs et métadonnées, sans les mêmes outils médias/édition/publication.

**Impact :** la promesse multi-objets n’aboutit pas à une expérience comparable pour une voiture, une œuvre ou un autre bien.

**À faire :** conserver une structure commune et adapter les champs au type choisi ; annoncer précisément les types actuellement utilisables. Sources : [nouveau Cartulaire][new-cartulary], [création][creation-service], [vue générique][generic-view].

### 19 — P2 · Une Collection archivée peut être sélectionnée par défaut lors de la création

**Code, condition : première Collection retournée archivée.** Les options visibles sont filtrées, mais la sélection initiale utilise la liste non filtrée et peut réintroduire l’élément archivé.

**Impact :** un nouvel objet peut être orienté vers une Collection que l’utilisateur croyait sortie de l’usage courant.

**À faire :** choisir le défaut parmi les Collections actives et expliquer l’absence de Collection éligible. Source : [initialisation de création][new-cartulary].

### 20 — P2 · Une erreur de chargement peut faire paraître une Collection vide

**Code, condition : échec du chargement des objets.** Le composant Collections remplace la liste par `[]` sans distinguer erreur et absence d’objets. Le nombre d’objets et l’état du bouton de suppression utilisent ensuite cette liste.

**Impact :** l’utilisateur peut agir sur un inventaire qu’il croit complet alors qu’il n’a pas été chargé.

**À faire :** distinguer chargement, erreur et vide ; conserver le dernier inventaire connu et bloquer les actions qui en dépendent. Source : [Collections][collections-ui].

## 4. Cartulaires, médias et téléchargements

### 21 — P1 · Le chargement cloud des médias privés n’alimente pas toutes les fonctions

**Code, à confirmer avec compte propriétaire dans un navigateur sans cache.** Une photo distante peut acquérir son URL à l’intérieur du composant image, sans transmettre cette URL au bouton de téléchargement, à la vidéo ou au 360°. Le bouton Télécharger est masqué si l’URL de l’objet média reste vide.

**Impact :** voir une photo ne garantit pas de pouvoir la télécharger ; vidéo et 360° peuvent avoir un comportement différent selon le cache de l’appareil.

**À faire :** résoudre une seule fois le média privé et partager chargement, URL, erreur et nouvelle tentative entre toutes les présentations. Le téléchargement photo démo observé ne valide pas ce parcours cloud. Sources : [image privée][private-image], [état des médias][media-state], [réhydratation][app-hydration], [téléchargement][media-download].

### 22 — P2 · Le diaporama peut faire planter la page après retrait d’un média

**Reproduit localement.** Avec trois médias, sélectionner le troisième puis réduire la liste à deux provoque `Cannot read properties of undefined (reading 'posterUrl')`. Le composant lit l’ancien index avant l’effet qui le remet à zéro.

**Impact :** suppression, changement de catégorie ou synchronisation peuvent interrompre la consultation.

**À faire :** borner l’index pendant le rendu ou conserver l’identifiant du média sélectionné. Aucun fichier utilisateur n’a été supprimé pour reproduire le défaut. Source : [carrousel][carousel].

### 23 — P2 · L’icône Lecture du mini-site ne lit aucune vidéo

**Observé + code.** Dans le mini-site Submariner, cliquer l’image avec ▶ ne fait rien : aucun lecteur ni dialogue n’apparaît ; le DOM contient zéro élément vidéo. L’icône est placée dans un simple bloc d’image. Le lien Télécharger reste disponible.

**Impact :** une action visuellement évidente ne fonctionne pas.

**À faire :** lecteur vidéo accessible avec une vraie commande Lecture, un état de chargement et un message d’erreur. Source : [bloc vidéo du mini-site][mini-video].

### 24 — P2 · Le rendu publié n’offre pas les mêmes interactions que l’aperçu

**Code, condition : contenu issu d’une projection serveur.** Le rendu passe par `ProjectedPublicBlock`, qui présente essentiellement une image, des textes et des liens de téléchargement. Il ne conserve pas les lecteurs vidéo, 360° et diaporama de l’aperçu local.

**Impact :** ce que le propriétaire valide à l’écran n’est pas nécessairement ce que le destinataire reçoit.

**À faire :** réutiliser les mêmes composants de présentation, alimentés exclusivement par les médias publics autorisés. Source : [rendu public][public-block].

### 25 — P3 · Les téléchargements gagneraient à être identifiables et prévisibles

**Code + amélioration UX.** Dans une vraie projection, plusieurs boutons sont simplement nommés « Télécharger » et les fichiers reçoivent des noms génériques. Certaines informations de type/taille manquent dans l’action elle-même.

**Impact :** le destinataire ne sait pas immédiatement quel fichier il récupère ni son poids.

**À faire :** miniature ou icône de type, nom lisible, format, taille lorsqu’elle est connue, et nom de fichier explicite. Sources : [rendu public][public-block], [lien téléchargement][media-download].

## 5. Publication, destinataires, Collections et Cercle

### 26 — P1 · L’état « Publication active » ne confirme pas une publication serveur

**Code + observations des liens pilotes.** L’interrupteur mini-site peut afficher « Publication active », mais l’adresse produite est explicitement un aperçu local. Les liens canoniques IWC et Rolex basculent eux-mêmes vers ce mode pour les codes connus, sans paramètre `preview=local` demandé. Pendant l’audit, l’IWC a affiché un aperçu, le Rolex « Aucun contenu validé ».

**Impact :** le propriétaire peut penser avoir publié ; le destinataire peut voir un état vide ou différent. Le message demandant de « valider un contenu » s’adresse au propriétaire alors que le destinataire ne peut pas le faire.

**À faire :** séparer Préparer, Prévisualiser et Publier ; afficher l’état confirmé par le serveur et une URL stable, indépendante du navigateur ; traiter distinctement lien invalide, retrait et indisponibilité. Sources : [publication][publication-ui], [choix aperçu/publication][publication-routing].

### 27 — P1 · La sélection de publication contredit ses règles de confidentialité

**Observé dans la démo + code.** Les listes de publication incluent Propriétaire, Transmission, Stockage et Prix de revient ; plusieurs de ces cases apparaissent cochées dans la démo. « Tout sélectionner » ne filtre pas selon la politique de destination, alors que cette politique exclut explicitement des blocs personnels. L’aperçu accepte ces identifiants.

**Impact :** le propriétaire ne peut pas déduire de l’écran ce qui sera réellement accepté ni ce qui doit rester privé.

**À faire :** même politique pour cases, aperçu et publication, exclusions expliquées avant validation. Ce constat ne démontre pas une publication serveur de données privées. Sources : [sélecteur][publication-selector], [politique][publication-policy].

### 28 — P1 · Supprimer une Collection ne révoque pas nécessairement son ancien mini-site

**Code, condition : Collection précédemment publiée, puis vidée et supprimée.** La suppression concerne le document privé ; elle ne retire pas sa publication. La lecture publique dépend du statut de la publication.

**Impact :** l’utilisateur peut croire avoir retiré la Collection alors que l’ancienne vitrine demeure accessible.

**À faire :** gérer explicitement et de manière cohérente le sort de la publication lors de la suppression, avec message préalable puis vérification du résultat. Aucun mini-site n’a été supprimé ou révoqué pendant l’audit. Sources : [service Collections][collections-service], [règles publiques][firestore-rules].

### 29 — P2 · Le champ « Adresse du site » n’a pas l’effet annoncé

**Code.** Le champ modifie un slug, mais l’adresse construite utilise uniquement l’identifiant de publication. La résolution du slug n’est pas implémentée dans ce parcours.

**Impact :** l’utilisateur personnalise une adresse qui ne sera pas celle partagée.

**À faire :** brancher une véritable adresse lisible ou supprimer/renommer le champ tant qu’il n’a pas cet effet. Sources : [Collections][collections-ui], [construction des URL][collections-domain].

### 30 — P2 · Plusieurs liens conduisent un visiteur public vers le privé

**Code ; lien de retour démo observé.** Le mini-site de Collection propose « Ouvrir le Cartulaire » et son logo conduit au Registre. Le Catalogue affiche « Voir le mini-site » sur la présence d’un code, sans vérifier une publication. Depuis une démo ouverte directement depuis l’accueil, le logo vise le Registre pilote privé alors que « Retour au Registre » vise le sélecteur général.

**Impact :** accès refusé, page vide ou perte du contexte démo ; des liens d’apparence équivalente ne mènent pas au même endroit.

**À faire :** retours adaptés au contexte, visiteur dirigé vers l’accueil public, lien public uniquement lorsqu’une publication existe, découverte démo préservée sans authentification supplémentaire. Sources : [mini-site Collection][collection-website], [Catalogue][catalogue], [barre Cartulaire][dossier-bar].

### 31 — P1 · Une invitation acceptée peut ouvrir l’accueil au lieu du Cartulaire

**Code.** Pour une invitation ciblant un Cartulaire, « Ouvrir le contenu autorisé » est construit avec `/?cartularyId=...`. La racine `/` ouvre désormais l’accueil public, indépendamment de cet identifiant.

**Impact :** après vérification de son adresse, l’invité n’atteint pas le contenu qui lui a été promis.

**À faire :** utiliser le constructeur partagé de route Cartulaire, adapté au type d’objet, et vérifier le parcours complet invitation → connexion → dossier. Aucune invitation réelle n’a été utilisée. Sources : [acceptation d’invitation][invitation], [route d’entrée][root-page].

### 32 — P2 · La révocation d’un accès n’explique ni les droits ni les échecs

**Code, condition : présence d’accès révocables.** Le bouton Révoquer peut être présenté à un lecteur qui n’a pas le droit de le faire. L’appel ne fournit pas de traitement d’erreur utilisateur ni de confirmation de la cible.

**Impact :** bouton sans résultat compréhensible pour certains ; coupure involontaire possible pour un gestionnaire.

**À faire :** afficher l’action selon les droits, confirmer la cible et présenter résultat/échec avec possibilité de reprise. Source : [centre des accès][access-center].

### 33 — P2 · Le Cercle et certains états d’échec sont des impasses

**Observé + code.** Avec la session démo, le Cercle affiche « Admission au Cercle requise » et seulement un retour Registre, sans connexion/admission à demander. Son rendu réel expose encore des identifiants de champs, sans présentation média complète. Certaines erreurs réseau du Cercle ou du mini-site Collection sont assimilées à absence d’admission ou de publication.

**Impact :** on ne sait pas si le service est fermé, si le contenu a été retiré, si la connexion a expiré ou si le réseau est en panne.

**À faire :** distinguer les causes, fournir la prochaine action et une nouvelle tentative ; rendre les publications sous forme de fiches lisibles avec photo et détail. Sources : [Cercle][community], [mini-site Collection][collection-website].

### 34 — P3 · « Télécharger le rapport PDF » ouvre l’impression

**Code.** L’action utilise l’impression du navigateur ; l’utilisateur doit choisir lui-même l’enregistrement PDF. Le message de résultat ne sait pas s’il a enregistré ou annulé.

**Impact :** écart avec le téléchargement direct annoncé, surtout sur mobile.

**À faire :** soit un PDF effectivement téléchargé, soit le libellé « Imprimer / Enregistrer en PDF », sans annoncer un fichier enregistré avant de le savoir. La qualité d’un PDF final exporté n’a pas été contrôlée dans cet audit. Sources : [bouton PDF][publication-ui], [export impression][pdf-export].

## 6. Design, navigation et accessibilité

### 35 — P2 · Le menu mobile recouvre son propre bouton de fermeture

**Observé et mesuré.** À 390 px de largeur, l’en-tête mesure **241 px** : le logo conserve une hauteur de **240 px** malgré une largeur réduite. Le menu ouvert commence à 70 px, tandis que le bouton de fermeture occupe y=98 à 142 px ; le menu est au-dessus de ce bouton. Un contrôle du point central confirme que le clic rencontrerait la navigation.

**Impact :** beaucoup d’espace perdu avant le contenu, puis fermeture du menu devenue inaccessible au toucher à cet endroit.

**À faire :** dimensionnement explicite et proportionnel du logo, hauteur d’en-tête maîtrisée, panneau placé sous l’en-tête réel et fermeture toujours visible. Sources : [logo][brand-logo], [styles globaux][global-css], [styles publics][public-css].

### 36 — P2 · La navigation du Registre devient difficile à comprendre sur mobile

**Observé + code.** Les huit libellés deviennent des icônes seules. La grille contient sept colonnes, laissant Administration seule sur une seconde ligne. Deux retours vers le site d’accueil sont aussi visibles dans cette zone, qui occupe une grande part du haut de l’écran.

**Impact :** le novice doit deviner le sens des icônes et fait défiler beaucoup de navigation avant d’atteindre son contenu.

**À faire :** menu avec libellés courts, organisation régulière des huit entrées et un retour accueil unique. Source : [styles du Registre][registry-css].

### 37 — P2 · Certains contrôles n’ont pas de nom accessible

**Observé + code.** Sur mobile, le bouton À Faire du Cartulaire apparaît sans nom dans l’arbre d’accessibilité lorsque son texte est masqué. Un bouton du bloc vidéo est également sans nom. Les logos annoncent systématiquement « Ouvrir le Registre Cartularia », même quand leur destination est l’accueil public.

**Impact :** navigation au lecteur d’écran ambiguë ; commandes difficiles à identifier sans leur icône.

**À faire :** conserver un nom accessible lors du masquage de texte et adapter les noms à la destination. Cela complète, sans remplacer, un audit WCAG complet. Sources : [barre Cartulaire][dossier-bar], [logo][brand-logo].

### 38 — P3 · Typographie, vocabulaire et langues ne sont pas harmonisés

**Observé + code + amélioration UX.** Titres très grands côtoient des métadonnées de 8–11 px, souvent en capitales. Le Registre parle de « projections », « R3/R4/R5/R6 » et parfois « membership ». Le Cartulaire français expose `main photo`, `spin 3d`, `slideshow` ; le carrousel conserve une date française en interface anglaise. Le libellé « mini -site » comporte une espace fautive. Les autres surfaces ne proposent pas la même couverture linguistique que le Cartulaire.

**Impact :** lecture fatigante, sensation de prototype technique, changement de repères entre pages.

**À faire :** minimum de lecture cohérent, vocabulaire centré sur dossier/objet/partage, traduction des tags et dates, et règles éditoriales communes. Sources : [styles Registre][registry-css], [carrousel][carousel], [publication][publication-ui].

## 7. Administration et gestion des erreurs

### 39 — P2 · Visiter l’administration globale déconnecte le Registre

**Observé + code.** La session démo fonctionnait dans le Registre. Après ouverture de `/administration`, le refus de rôle s’est affiché ; le retour à `/registry` a présenté le formulaire de connexion. La vérification de rôle appelle bien la déconnexion partagée.

**Impact :** une visite non autorisée dans un espace secondaire interrompt le travail en cours ailleurs.

**À faire :** afficher « accès réservé » sans supprimer la session générale et proposer un retour au Registre. Source : [administration globale][admin-global].

### 40 — P2 · L’administration gère mal certaines erreurs et son dialogue au clavier

**Code, espace administrateur privilégié non utilisé.** Une expiration d’authentification lors d’Actualiser peut laisser les anciennes données sans explication adaptée. Le dialogue de suspension ne met pas en œuvre tout le cycle de focus, Échap, retour au déclencheur et isolement du fond attendu d’une fenêtre modale.

**Impact :** administrateur susceptible de croire le tableau à jour, ou de perdre le fil de l’action au clavier.

**À faire :** erreur visible avec reconnexion contextualisée ; réutilisation du composant de dialogue accessible commun. Source : [administration globale][admin-global].

### 41 — P2 · « Administration » promet plus de gestion que l’écran du Registre n’en fournit

**Observé en lecture seule + code + amélioration UX.** L’administration du Registre présente surtout organisation, membres, permissions et règles de gouvernance. Elle ne constitue pas un parcours complet pour modifier les rôles, gérer un abonnement ou traiter une facture. Son nom ressemble en outre à celui de la console globale, de nature différente.

**Impact :** l’utilisateur cherche une action de gestion dans un écran principalement explicatif.

**À faire :** nommer l’entrée « Organisation et droits » et présenter, pour chaque gestion attendue, l’action ou la démarche disponible. Ne pas confondre écran informatif et console d’administration du service. Source : [administration Registre][registry-admin].

### 42 — P3 · Les écrans techniques brouillent le contexte de navigation

**Observé + code.** Le chargement d’une page publique ou du Coffre est intitulé « Cartulaire privé ». Plusieurs surfaces publiques/Coffre gardent le titre générique du site. L’erreur globale explique toute exception par « Une mise à jour a été appliquée », même si le défaut vient d’un composant comme le diaporama.

**Impact :** mauvais repérage dans les onglets et diagnostic trompeur face à une panne.

**À faire :** titres et chargements adaptés à la destination ; message d’erreur honnête, nouvelle tentative et retour sûr, sans inventer la cause. Sources : [démarrage/erreurs][bootstrap], [routage][root-page].

## 8. Ordre de correction recommandé

| Ordre | Résultat utilisateur attendu | Constats concernés |
|---|---|---|
| 1 | Savoir où les données sont conservées, récupérer l’accès et ne pas perdre ses saisies | 01, 08, 09, 11 |
| 2 | Publier réellement et ouvrir exactement le contenu autorisé chez le destinataire | 26, 27, 28, 31, puis 23–24 et 30–33 |
| 3 | Voir les mêmes informations et médias dans tous les niveaux du site | 13–16, 21–22 |
| 4 | Pouvoir naviguer sur téléphone et au clavier sans impasse | 35–37, 39–40 |
| 5 | Comprendre la proposition, l’inscription et les limites sans jargon ni promesse ambiguë | 02–07, 10, 12, 17–20, 25, 29, 34, 38, 41–42 |

Le parcours de référence à faire fonctionner complètement est : **Accueil → découverte sans compte → création d’accès → premier objet → ajout et conservation de médias → sauvegarde → publication choisie → ouverture sur un autre appareil → téléchargement → retrait de publication**. Chaque étape devrait avoir un résultat visible, une prochaine action et un état d’échec compréhensible.

## 9. Ce qui fonctionne et doit être conservé

- L’accès au Registre démo a réellement abouti sans inscription ; les droits de création et de modification n’étaient pas proposés dans ce parcours.
- Les cinq Cartulaires démo s’ouvrent avec leur propre titre et leur propre photo de couverture ; la nature fictive est clairement signalée dans les dossiers.
- Recherche, effacement au clavier et comparaison de deux dossiers ont fonctionné. Une anomalie de l’effacement automatisé a été écartée après contrôle au clavier et reproduction locale : elle n’est pas attribuée au site.
- Les six pages Submariner sont accessibles ; les documents, valeurs et observations sont nettement qualifiés de fictifs.
- La photo testée a déclenché un téléchargement ; le visualiseur 360° s’ouvre et le changement d’angle fonctionne.
- Les contrôles de preuve distinguent utilement intégrité, authenticité et propriété. Le Registre démo annonce bien zéro ancrage public confirmé.
- Un Cartulaire privé sans session explique que les originaux distants sont verrouillés et propose de se connecter. L’absence de ces originaux dans cette situation n’est pas classée comme panne.
- La publication de Collection prévoit une sélection volontaire des objets dans le code. Cette intention doit être conservée lors de la correction des parcours.

## 10. Vérifications complémentaires et limites

La suite UI existante a été exécutée : **65 tests réussis sur 66, 19 fichiers réussis sur 20**. L’échec concerne une ancienne attente du test d’accueil (`Explorer un Cartulaire de démo` / ancienne route), alors que l’interface actuelle propose la démo Submariner. Cet échec de test n’est pas compté comme une panne supplémentaire du site.

Le crash du carrousel a été reproduit localement avec une liste de médias qui rétrécit. Les chemins de perte de données, d’activation incomplète et de publication résiduelle n’ont pas été provoqués dans les données réelles. Ils doivent faire l’objet de scénarios ciblés dans un environnement de test.

Avant de qualifier le service de prêt pour un usage réel, il reste à exécuter le parcours de référence avec un compte propriétaire de test, un Coffre distinct, des médias cloud sans cache local, un destinataire indépendant et une publication réellement émise puis révoquée. L’audit actuel constate les défauts d’usage identifiés ; il ne certifie pas les autres combinaisons de rôles, données, appareils et navigateurs.

### Références de version

- Entrée livrée : `index-2M4rMv2X.js` — SHA-256 `a5dfab1239d8b5202e7a78fb88f50eb6fece55cec3bda30223a7332ec1515f30`.
- Coffre livré : `PersonalVaultApp-jENLcAJ_.js` — SHA-256 `b42e4ce89181f7f19f7289e6bbcb0d9ddc8d047cfe47f2cf5072b5704b5ac014`.
- Sources et lignes ci-dessous : état du checkout inspecté le 6 septembre 2026. Les lignes peuvent évoluer après correction.

[home]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/public/HomePage.tsx:329>
[home-footer]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/public/HomePage.tsx:752>
[contact]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/public/HomePage.tsx:238>
[account]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/public/AccountAccessPage.tsx:117>
[vault-config]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/firebase.ts:23>
[bridge-config]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/codeBridgeFirebase.ts:23>
[vault]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/personalVault/PersonalVaultApp.tsx:74>
[foundations]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/services/foundations.ts:46>
[registry-app]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/registry/RegistryApp.tsx:181>
[overview]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/registry/RegistryOverview.tsx:138>
[integrity]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/registry/RegistryIntegrity.tsx>
[gallery-service]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/services/registryGallery.ts:99>
[demo-projection]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/data/demoCartularyDocuments.ts:243>
[demo-seed]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/scripts/seed-demo-account.mjs:132>
[registry-labels]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/registry/registryPresentation.ts:35>
[catalogue]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/registry/RegistryItems.tsx:191>
[follow-up]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/registry/RegistryFollowUp.tsx:213>
[new-cartulary]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/registry/NewCartularyPage.tsx:82>
[creation-service]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/services/cartularyCreation.ts:285>
[generic-view]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/GenericCartularyView.tsx:69>
[collections-ui]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/registry/RegistryCollections.tsx:35>
[collections-service]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/services/collections.ts:140>
[collections-domain]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/domain/collections.ts:74>
[firestore-rules]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/firestore.rules:274>
[media-state]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/cartulary/state/useCartularyMediaState.ts:14>
[private-image]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/PrivateMediaImage.tsx:65>
[app-hydration]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/App.tsx:1254>
[media-download]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/MediaDownloadLink.tsx:17>
[carousel]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/MediaCarousel.tsx:46>
[mini-video]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/App.tsx:2393>
[public-block]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/ProjectedPublicBlock.tsx:24>
[publication-ui]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/App.tsx:3591>
[publication-routing]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/App.tsx:810>
[publication-selector]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/App.tsx:1665>
[publication-policy]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/domain/publication.ts:225>
[collection-website]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/CollectionWebsitePage.tsx:146>
[invitation]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/registry/RegistryInvitationPage.tsx:42>
[root-page]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/RootPage.tsx:34>
[access-center]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/registry/RegistryAccessCenter.tsx:298>
[community]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/CommunityPage.tsx:59>
[pdf-export]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/utils/pdfExport.ts:117>
[brand-logo]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/BrandLogo.tsx:25>
[global-css]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/index.css:150>
[public-css]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/public/public-site.css:13>
[registry-css]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/registry/registry.css:1524>
[dossier-bar]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/BarreDossier.tsx:149>
[admin-global]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/administration/AdministrationApp.tsx:284>
[registry-admin]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/features/registry/RegistryAdministration.tsx:204>
[bootstrap]: </Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/bootstrap/ApplicationBootstrap.tsx:32>
