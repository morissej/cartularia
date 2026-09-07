# Cartularia — Plan de corrections par vagues

Date : 6 septembre 2026. Statut : **exécution engagée avec autorisation utilisateur**. Voir le [journal d’exécution](2026-09-06-execution-corrections.md) pour les corrections, preuves et blocages ; cette feuille de route ne vaut pas validation de la livraison.

Base : [audit utilisateur du 6 septembre 2026](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/docs/audits/2026-09-06-audit-utilisateur.md>), soit **42 constats : 9 P1, 26 P2 et 7 P3**. Les numéros ci-dessous renvoient à cet audit, sans ajouter de pannes supposées.

## 1. Résultat recherché et organisation

Un utilisateur doit pouvoir accomplir le parcours courant suivant sans assistance ni changement implicite de contexte ; une procédure de récupération exceptionnelle peut prévoir un accompagnement explicite :

**Accueil → démonstration → création d’accès → premier objet → médias et sauvegarde → partage choisi → consultation et téléchargement sur un autre appareil → retrait du partage.** Il doit aussi pouvoir retrouver ses accès et ses données.

Le plan comporte **15 vagues, de V00 à V14** : préparation, 13 lots correctifs, puis recette et livraison. Chaque constat possède une vague responsable de sa clôture. Des protections provisoires ou des travaux préparatoires peuvent commencer auparavant ; ils ne valent pas correction complète.

| Vague | Résultat attendu | Constats à clôturer | Prérequis de clôture |
|---|---|---|---|
| V00 | Référence de départ, preuves et environnement de test fiables | Préparation transversale | Aucun |
| V01 | Registre, Coffre et correspondances effectivement séparés | 01 | V00 ; état réel de l’infrastructure connu |
| V02 | Création et connexion reprenables, sans compte bloqué | 09, 10 | V00 |
| V03 | Récupération des accès et du déchiffrement organisée | 08 | V01, V02 ; choix du dispositif de secours |
| V04 | Saisies du Coffre conservées et états de sauvegarde fiables | 11, 12 | V01 pour la recette distante ; développement indépendant |
| V05 | Publication serveur réelle, sélective et révocable | 26, 27, 28, 29 | V00 ; modèle d’autorisation vérifié |
| V06 | Invitations, droits et administration sans rupture de session | 31, 32, 39, 40 | V02 ; règles et rôles de test disponibles |
| V07 | Médias consultables et téléchargeables sans dépendance au cache | 21, 22, 25 | V00 ; contrat public de V05 pour les dérivés publiés |
| V08 | Mini-sites cohérents, navigation publique sûre et export honnête | 23, 24, 30, 34 | V05, V06, V07 |
| V09 | Registre, Collections et Cartulaires présentent les mêmes données | 13, 14, 16, 19, 20 | V00 ; modèle média de V07 pour la Galerie |
| V10 | Suivi, Cercle et organisation proposent une prochaine action utile | 17, 33, 41 | V05, V06, V09 |
| V11 | Parcours commun à tous les types d’objets effectivement supportés | 18 | Contrats stabilisés V05, V07, V09 |
| V12 | Accueil, inscription et démonstration compréhensibles et fidèles | 02, 03, 04, 05, 06, 07, 15 | V01–V03, V08–V11 ; contenus validés |
| V13 | Design responsive, accessibilité et vocabulaire cohérents | 35, 36, 37, 38, 42 | Correctifs de base dès V00 ; recette sur les écrans stabilisés |
| V14 | Parcours complets validés et liens de la version livrée vérifiés | Recette transversale des 42 constats | Toutes les clôtures requises ci-dessus |

### Ordre d’exécution et parallélisation

Avec une seule équipe, suivre l’ordre des vagues, sauf dépendance ou décision en attente : un arbitrage sur la récupération en V03 ne doit pas retarder le développement indépendant de V04. Avec plusieurs intervenants, ouvrir après V00 trois chantiers coordonnés : **accès et conservation** (V01–V04), **partage et médias** (V05–V08), **cohérence et usages** (V09–V11). V12 et V13 accompagnent ces travaux, puis terminent leur recette après stabilisation.

Ne pas attendre la fin des chantiers lourds pour traiter les corrections courtes : menu mobile inaccessible (35), déconnexion sur refus d’administration (39), noms accessibles (37), faux message de téléchargement PDF (34), messages techniques trompeurs (42), avertissement sur les saisies du Coffre (11) et reformulation des promesses non démontrées (03). Chaque intervention anticipée reste rattachée à sa vague et à ses tests.

Les fichiers partagés, notamment `App.tsx`, le routage, la page de compte et les styles, doivent avoir un responsable d’intégration unique par lot. Le nombre de vagues n’est pas une estimation de durée : V01 et V03 dépendent notamment de décisions et d’accès d’exploitation. Chiffrer après V00, sans promettre un calendrier avant cet inventaire.

## 2. Règles applicables à toutes les vagues

- Préserver les modifications existantes, les données métier, les originaux et leurs empreintes. Aucun nettoyage global ni migration implicite.
- Garder l’accueil public à `/`, le Registre comme espace principal à `/registry` et le Cartulaire privé dans son parcours dédié. Distinguer consultation publique, démo et travail privé.
- Conserver deux authentifications indépendantes Registre/Coffre : même nom utilisateur possible, mots de passe distincts. Ne pas transférer les identités personnelles en clair dans le Registre pour simplifier un parcours.
- Appliquer les changements communs à tous les Cartulaires actuels et futurs. Pas d’exception de présentation par marque, Collection ou identifiant de dossier ; profils métier versionnés pour les différences légitimes.
- Publication volontaire, avec confirmation et sélection explicite des objets et contenus. Jamais de publication automatique d’une Collection existante.
- Maintenir une seule source de données pour une même information ou tâche ; une projection est un résultat dérivé, pas un second dossier éditable indépendant.
- Distinguer un défaut observé d’un risque établi par lecture du code. Pour ces derniers, reproduire les préconditions en test avant de choisir la correction ; ne pas provoquer l’incident dans les données réelles.
- Ne pas transformer une amélioration de libellé en nouveau service implicite : ni paiement, ni délégation réelle, ni expertise, ni garantie juridique ajoutés par ce plan.

### Définition commune de « corrigé »

Un constat ne passe à « validé » que si sa cause est identifiée, la correction est ciblée, un test empêche sa réapparition et le parcours utilisateur concerné aboutit dans l’environnement requis. Conserver : numéro du constat, version testée, preuve avant/après, résultat, environnement, limites et responsable de validation.

États de suivi : **à reproduire → correction en cours → validé localement → validé en préproduction → validé sur la livraison concernée**. Une fonctionnalité nécessitant Firebase réel ne peut pas être déclarée opérationnelle sur la seule base d’un test de composant.

## 3. Détail des vagues

### V00 — Fixer la référence et les conditions de travail

**Livrables**

- Inventaire du checkout réellement utilisé, de ses modifications, des routes et des versions livrées. Le commit seul ne suffit pas à identifier le code audité, qui comportait des modifications non commitées.
- Tableau de suivi des 42 constats, avec leur niveau de preuve et les scénarios de reproduction manquants.
- Environnements de test isolés : visiteur, démo strictement en lecture seule, propriétaire fictif, destinataire invité, membre autorisé et administrateur de test.
- Référence de tests : l’audit avait obtenu 65 tests UI réussis sur 66. Revoir l’ancienne assertion d’accueil selon le parcours souhaité, sans supprimer un test uniquement pour le faire passer.
- Inventaire en lecture seule de la configuration client **et** serveur des trois espaces. L’[ADR d’administration](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/docs/ADR-027-console-administration-trois-bases.md>) mentionne déjà `cartularia-vault-a3e51` et `cartularia-bridge-a3e51`, tandis que l’audit a relevé le repli du client livré : réconcilier ces faits avant de provisionner quoi que ce soit.

**Validation :** chacun peut retrouver la même version, reproduire les défauts avec des données fictives et identifier précisément le périmètre de ses changements. Les contrôles manquants sont nommés, pas assimilés à des succès.

**Mesures transitoires à préparer :** discours fidèle aux fonctions vérifiées ; absence de faux statut « publié » ; impossibilité d’une nouvelle opération sensible si ses préconditions ne sont pas assurées. Toute restriction de service existant demande un plan explicite protégeant l’accès aux données, et ne ferme pas à elle seule un P1.

### V01 — Assurer la séparation réellement utilisée

**Constat : 01 — P1.**

- Vérifier les projets existants, Auth, Rules, Storage et fonctions utilisés par chaque build et chaque parcours ; compléter le raccordement avant d’envisager de nouveaux projets.
- Interdire les configurations absentes ou identiques et le repli silencieux vers le Registre. Présenter un état d’indisponibilité compréhensible sans ouvrir une connexion de remplacement.
- Vérifier le pont à codes seuls et les permissions administratives minimales ; aucune donnée personnelle déchiffrée ne doit apparaître dans le Registre, le pont ou la console.
- S’il existe des comptes ou Coffres dans l’ancien emplacement, préparer un inventaire, une sauvegarde, un rapprochement des identifiants, une migration testée et un retour arrière. Ne pas supprimer l’ancienne copie ni imposer une réinscription sans décision explicite.

**Validation :** configuration manquante/identique refusée ; appels authentifiés dirigés vers trois projets distincts ; accès intercomptes refusés ; données fictives sauvegardées puis retrouvées dans le bon Coffre. Vérification sur le build servi, pas uniquement sur les exemples de variables d’environnement. Une simple modification du texte public ne clôture pas cette vague.

### V02 — Rendre la création d’accès reprenable

**Constats : 09 — P1 ; 10 — P2.**

- Modéliser les états « identité créée », « activation à terminer » et « Registre prêt » ; rendre l’activation idempotente et la reprendre à la connexion.
- Donner une action « Terminer la création de mon Registre » et préserver la destination demandée.
- Partager la logique de connexion ; réserver les contraintes de création de mot de passe à la création ou au changement, pas à l’usage d’un mot de passe historique valide.

**Validation :** échec après création Auth, réponse perdue après activation réussie, double clic et nouvelle connexion aboutissent à un seul compte et un seul Registre. Un compte suspendu ou dont les droits ont été retirés ne doit jamais être traité comme une simple activation incomplète. Les deux portes de connexion acceptent les mêmes identifiants valides.

### V03 — Prévoir une récupération durable et explicite

**Constat : 08 — P1.**

- Choisir et documenter séparément la récupération d’identité du Registre et le secours permettant le déchiffrement du Coffre. Ne pas envoyer un lien de secours vers une adresse technique `.invalid`.
- Préparer une proposition de dispositif de récupération compatible avec la confidentialité, puis la faire valider avant implémentation. Expliciter qui peut récupérer quoi, avec quel élément, et ce qui devient impossible si tous les secours sont perdus.
- Ajouter le parcours de secours, la confirmation du mot de passe Coffre, son affichage temporaire et l’adoption du dispositif par les comptes existants.
- Prévoir la rotation des secrets et la révocation des anciens moyens de secours sans rendre les données illisibles.

**Validation :** depuis un appareil vierge, sans session ni cache, le propriétaire fictif récupère son accès et retrouve les mêmes données déchiffrées selon le dispositif retenu. Tester les secours incorrects, expirés, réutilisés et révoqués. Un changement Auth ne doit jamais être annoncé comme une récupération du Coffre s’il ne permet pas réellement son déchiffrement.

### V04 — Protéger les saisies du Coffre

**Constats : 11 — P1 ; 12 — P3.**

- Afficher un état de modification fiable ; invalider le message de réussite dès une nouvelle saisie.
- Ajouter « Enregistrer et verrouiller », avec verrouillage seulement après confirmation de la sauvegarde ; en cas d’échec, garder les saisies et permettre une nouvelle tentative.
- Protéger les départs et suppressions : navigation interne contrôlée, avertissement navigateur lorsque possible, confirmation ou annulation. Définir la protection complémentaire nécessaire contre les interruptions que le navigateur ne permet pas d’intercepter, sans persister de données personnelles en clair.
- Renommer les fiches descriptives « Contacts gestionnaires » ; ne pas laisser croire qu’elles activent des droits. Ajouter des retours Accueil/Registre protégés contre l’abandon de saisie.

**Validation :** sauvegarde puis nouvelle modification, départ, verrouillage, rechargement, perte réseau, réponse tardive et saisie pendant un enregistrement. Les modifications plus récentes ne sont ni écrasées ni marquées sauvegardées par une réponse ancienne. Après fermeture et reconnexion, les données effectivement confirmées sont retrouvées à l’identique. Documenter les limites de fermeture forcée, sans promettre un avertissement universel.

### V05 — Refaire de la publication un résultat serveur vérifiable

**Constats : 26, 27, 28 — P1 ; 29 — P2.**

- Distinguer brouillon, aperçu local, publication en cours, publication confirmée, retrait en cours et retrait confirmé. Supprimer les raccourcis par code pilote qui font passer un aperçu local pour un site publié.
- Afficher une adresse publique seulement pour la publication réellement confirmée ; conserver l’aperçu comme outil distinct.
- Utiliser la même liste de contenus autorisés dans le sélecteur, l’aperçu et la validation serveur. « Tout sélectionner » signifie tout ce qui est publiable, jamais les données interdites.
- Rendre cohérents suppression de Collection et retrait de sa projection publique. Utiliser une transaction lorsque possible, sinon une commande reprenable qui ne confirme pas la suppression tant que le retrait public n’est pas assuré.
- Traiter les projections historiques devenues orphelines à partir d’un inventaire contrôlé, sans publication ni effacement massif implicite.
- Pour l’adresse personnalisée, raccorder un vrai identifiant d’URL ou retirer le champ sans effet. Par défaut, privilégier une adresse canonique fiable à l’ajout d’un nouveau système de noms.

**Validation :** publication consultable sur un autre navigateur sans stockage local ; aucune information interdite dans l’aperçu, la projection ni les réponses publiques ; accès anonyme refusé aux données privées. Tester échec réseau, double envoi, modification pendant publication, retrait puis réouverture de l’ancienne URL, suppression d’une Collection publiée et nouvelle tentative après échec partiel.

**Limite à expliquer :** retirer une publication bloque les nouveaux accès via le service selon sa politique de cache ; cela n’efface pas les fichiers déjà téléchargés par un tiers. Définir et tester le traitement des URL de médias et caches publics, pas seulement celui du document de publication.

### V06 — Fiabiliser invitations, permissions et administration

**Constats : 31 — P1 ; 32, 39, 40 — P2.**

- Construire les liens d’invitation avec le routeur commun, vers le bon Cartulaire et le bon type d’objet ; reprendre la destination après connexion sans aboutir à l’accueil générique.
- Contrôler les destinations de retour et leur contexte, sans accepter arbitrairement une URL externe.
- Aligner visibilité des actions et autorisation serveur pour la révocation : confirmation, état en cours, échec explicite et succès vérifié.
- Refuser l’administration globale sans déconnecter le Registre. Distinguer refus de rôle, session expirée et indisponibilité.
- Gérer la réauthentification, la fraîcheur des données et le dialogue de suspension accessible : focus initial, confinement, Échap et retour au déclencheur.

**Validation :** invitation valide, expirée, révoquée et déjà acceptée ; destinataire connecté ou non ; droits insuffisants sans mutation ; session Registre préservée après refus d’administration ; absence de tableau présenté comme frais après échec d’actualisation. Les actions privilégiées sont testées avec un administrateur fictif dans un environnement dédié.

### V07 — Unifier l’accès et le téléchargement des médias

**Constats : 21 — P1 ; 22 — P2 ; 25 — P3.**

- Fournir une résolution commune des médias privés distants pour image, vidéo, 360° et téléchargement, avec les mêmes autorisations et états de chargement/erreur.
- Conserver les originaux et leurs empreintes ; séparer les dérivés de présentation destinés au public. Ne pas exposer un original privé pour contourner un problème de téléchargement.
- Stabiliser la sélection du carrousel par identifiant et borner l’index avant rendu, y compris après filtre, suppression ou synchronisation.
- Afficher des intitulés et noms de fichiers utiles, le format et la taille lorsqu’ils sont connus ; retour explicite si le fichier n’est pas disponible.

**Validation :** appareil sans cache, compte autorisé, origine distante réelle ; affichage, lecture, rotation et téléchargement effectifs. Contrôler le contenu téléchargé, pas seulement l’événement de clic. Tester permissions retirées, fichier manquant, réseau interrompu, liste passant de trois médias à deux lorsque le troisième était sélectionné, puis liste vide. Vérifier séparément les dérivés autorisés sur mini-site public.

### V08 — Aligner aperçu, mini-site publié et export

**Constats : 23, 24, 30 — P2 ; 34 — P3.**

- Remplacer le faux bouton Lecture par un lecteur utilisable ; partager le rendu des médias autorisés entre aperçu et publication : photos, vidéo, 360°, diaporama, documents et téléchargement.
- Faire passer l’aperçu par le contrat de projection publique : la parité visuelle ne doit pas devenir une lecture des données privées dans le site public.
- Harmoniser les retours Accueil, Registre, Collection et Cartulaire selon le contexte. N’afficher « Voir le mini-site » que si une publication existe ; ne pas présenter un lien privé comme une consultation publique.
- Pour le PDF, adopter d’abord « Imprimer / Enregistrer en PDF » et un état honnête si ce mécanisme est conservé. Un téléchargement PDF natif reste une option distincte à décider, pas une condition cachée de correction.

**Validation :** le même contenu autorisé produit le même résultat dans l’aperçu et le site réellement publié, sur ordinateur et mobile. Tester liens directs, retour arrière et liens depuis Collection/Cercle/démo. Vérifier un PDF réellement enregistré : pagination, textes, images et métadonnées ; annuler l’impression ne doit jamais produire un message « fichier téléchargé ».

### V09 — Réconcilier les données entre niveaux du site

**Constats : 13, 14, 16, 19, 20 — P2.**

- Alimenter la Galerie démo avec les médias sources ; ne pas corriger les cinq couvertures uniquement par des exceptions d’affichage.
- Définir les correspondances de valeurs entre Cartulaire et Registre : prix d’achat, coût complet, valeur nette, code objet et état de preuve. Ne pas assimiler des notions différentes pour remplir une colonne.
- Utiliser le nom réel des Collections plutôt qu’une transformation de leur identifiant ; définir le comportement pendant leur chargement.
- Exclure les Collections archivées de la destination par défaut d’un nouvel objet.
- Séparer chargement, absence de Collection et erreur réseau ; conserver les données précédentes identifiées comme potentiellement périmées et désactiver les opérations nécessitant un inventaire fiable.

**Validation :** comparaison champ par champ des cinq Cartulaires démo et de leurs projections ; photos visibles dans la Galerie ; propagation d’une modification de test jusqu’au Registre avec état de synchronisation. Tester absence totale de Collection active, liste mixte active/archivée, erreur puis nouvelle tentative, et absence de suppression proposée sur la base d’un faux état vide.

### V10 — Rendre le suivi et les espaces secondaires actionnables

**Constats : 17, 33, 41 — P2.**

- Transformer Suivi en point de travail cohérent avec À Faire : mêmes tâches, échéances et états ; accès à l’objet concerné ; prise en compte des alertes suspendues et filtres compréhensibles.
- Conserver les modifications locales en attente pendant les pertes réseau et la réconciliation ; ne pas maintenir deux listes de tâches indépendantes.
- Pour le Cercle, distinguer admission requise, session expirée, réseau indisponible et absence de publication. Donner une démarche d’admission réelle ou expliquer l’indisponibilité ; afficher des fiches publiques lisibles avec leurs médias autorisés.
- Renommer l’administration du Registre « Organisation et droits » ; associer aux besoins de gestion une action existante ou une procédure réelle, sans simuler un abonnement ou une facturation inexistants.

**Validation :** une tâche modifiée depuis l’un des deux niveaux reste identique dans l’autre après rechargement et reconnexion ; les tâches en attente ne disparaissent pas devant un instantané distant vide. Chaque état du Cercle et de l’organisation possède une explication et une prochaine action valide.

### V11 — Étendre le parcours commun aux objets supportés

**Constat : 18 — P2.**

- Inventorier les types et versions de schémas déjà pris en charge. Annoncer clairement les types réellement utilisables, sans promettre des verticales encore absentes.
- Permettre le choix du type à la création et partager navigation, médias, édition, suivi et publication dans le cadre commun du Cartulaire.
- Limiter les différences aux contenus métier versionnés. Préserver l’ouverture des dossiers anciens sans réécriture silencieuse de leur schéma.

**Validation :** création puis parcours complet d’une montre et d’au moins un type non horloger supporté ; tests de contrat sur tous les profils déclarés. Les dossiers existants restent ouvrables et les écrans communs n’ont aucune branche par marque ou identifiant particulier.

### V12 — Rendre la promesse et le premier parcours compréhensibles

**Constats : 02, 03, 04, 05, 15 — P2 ; 06, 07 — P3.**

- Publier des pages Conditions, Confidentialité et informations d’accessibilité adaptées à la réalité du service, avec liens aux points de consentement. Faire valider les informations d’éditeur et les engagements ; ne pas inventer les mentions manquantes ni une conformité certifiée.
- Remplacer les promesses absolues par une description précise des fonctions, preuves et limites. Qualifier explicitement les exemples illustratifs.
- Présenter coûts ou périmètre de gratuité, quotas, stockage, conservation, export et disponibilité sur la base de décisions effectives. Une décision en attente doit être indiquée, pas remplacée par un chiffre fictif.
- Guider l’inscription par étapes et état d’avancement ; envoyer directement vers l’espace demandé, tout en conservant l’indépendance des deux accès.
- Montrer une démonstration complète et fictive : Galerie renseignée, Collection d’exemple, tâches illustratives et vrai résultat de mini-site consultable. La préparer dans un périmètre de démonstration maîtrisé, sans publier de données réelles ni rendre le compte démo modifiable.
- Pour le contact, solution minimale recommandée : annoncer l’ouverture du logiciel de messagerie et permettre de copier tout le message. Un envoi serveur avec reçu nécessite une décision de service distincte.

**Validation :** un nouvel utilisateur trouve les textes avant d’accepter, comprend ce qui est disponible et atteint sa première action sans interpréter l’architecture technique. Les chemins Registre et Coffre arrivent au bon accès ; la démonstration traverse tous les niveaux sans inscription et sans mutation. Un utilisateur sans client mail ne perd pas son message et ne reçoit pas de faux accusé d’envoi.

### V13 — Harmoniser design, accessibilité et langage

**Constats : 35, 36, 37 — P2 ; 38, 42 — P3.**

- Corriger en priorité les proportions du logo, la hauteur de l’en-tête et la fermeture du menu mobile. Organiser les huit entrées du Registre avec des libellés lisibles et un retour accueil unique.
- Assurer un nom accessible à chaque commande, un focus visible, un ordre clavier cohérent et des libellés correspondant aux destinations réelles.
- Définir des règles communes de typographie, contraste, espacement et composants ; éliminer les métadonnées trop petites et vérifier zoom, textes longs et écrans étroits.
- Remplacer le jargon technique par les termes utilisateur ; harmoniser tags, dates et langues. Définir les langues effectivement supportées sans prétendre à une traduction complète si elle ne l’est pas.
- Donner à chaque route un titre, un chargement et des erreurs contextualisés. Ne pas attribuer automatiquement une panne à une mise à jour.

**Validation :** accueil, compte, Coffre, huit sections du Registre, six pages du Cartulaire, mini-sites et administration aux largeurs de recette, notamment 390 px ; zoom 200 %, navigation clavier et contrôle au lecteur d’écran sur les parcours prioritaires. Menu toujours refermable, aucune commande principale anonyme, aucun contenu essentiel masqué. Les contrôles automatisés d’accessibilité complètent la recette manuelle ; ils ne constituent pas seuls une certification WCAG.

### V14 — Recette complète et livraison traçable

**Périmètre : les 42 constats, leurs interactions et les fonctions déjà opérationnelles à préserver.**

- Exécuter la matrice de recette ci-dessous sur une version figée ; corriger toute régression dans sa vague responsable avant de refaire le parcours affecté.
- Associer chaque résultat au code testé, aux configurations et aux services effectivement déployés. Refaire les contrôles si la version change pendant la recette.
- Préparer les lots de livraison séparément : application/Hosting, Functions, Rules, configuration Auth/Storage et éventuelles migrations. Un déploiement Hosting seul ne prouve pas la mise à jour des autres éléments.
- Prévoir un retour arrière compatible avec les données et les règles d’accès ; ne pas réintroduire une exposition de données ou annuler aveuglément une migration de schéma.
- Produire une liste de liens vérifiés pour chaque niveau, avec état public/privé/démo, rôle nécessaire et marqueur de version. Ouvrir ces liens dans une session indépendante sans cache pour vérifier la livraison réelle.

**Validation finale :** aucun P1 ouvert pour le périmètre destiné à un usage réel ; critères des P2/P3 couverts ou report explicitement documenté. Un report reste ouvert : il ne permet pas d’annoncer « audit entièrement corrigé ». Les défauts de confidentialité, récupération, conservation et révocation ne sont pas compensés par une bonne note de design.

## 4. Matrice minimale de recette

| Parcours ou risque | Acteur / contexte | Preuve attendue |
|---|---|---|
| Accueil → démo → Cartulaire → mini-site → retour | Visiteur, ordinateur et mobile | Navigation complète, zéro inscription imposée, contenu fictif explicite |
| Inscription interrompue puis reprise | Nouveau propriétaire fictif | Un compte, un Registre, activation aboutie sans droits indus |
| Accès existant par les différentes portes | Propriétaire existant | Identifiants valides acceptés, bonne destination retrouvée |
| Coffre distinct, sauvegarde et abandon de saisie | Propriétaire, projet Coffre cible | Bon projet, contenu retrouvé, absence de faux succès ou perte silencieuse |
| Récupération complète | Appareil vierge, propriétaire fictif | Auth rétablie et données effectivement déchiffrées selon le dispositif choisi |
| Création → médias cloud → lecture et téléchargement | Propriétaire sans cache local | Fichiers utilisables, empreintes des originaux conservées, erreurs gérées |
| Cartulaire ↔ Registre ↔ Collection ↔ Suivi | Propriétaire, plusieurs profils métier | Valeurs et tâches cohérentes, ancien dossier toujours lisible |
| Publication choisie → lecture et téléchargement → retrait | Propriétaire puis visiteur indépendant | Seul le contenu choisi est exposé ; retrait vérifié aussi pour les accès médias |
| Suppression d’une Collection anciennement publiée | Propriétaire, échecs partiels simulés | Aucun site public résiduel déclaré retiré à tort |
| Invitation → connexion → consultation → révocation | Destinataire distinct | Bon objet, bons droits, retrait d’accès effectif |
| Accès insuffisant / session expirée / suspension | Démo, membre, administrateur fictif | Refus sans mutation ni déconnexion parasite ; réauthentification explicite |
| Chargement, vide, indisponible, permissions retirées | Tous les espaces | Explication fidèle, reprise possible, données périmées identifiées |
| Téléphone, clavier, zoom et lecteur d’écran | Parcours prioritaires | Commandes accessibles, menu refermable, focus et titres cohérents |
| Navigateurs et version livrée | Chrome, Firefox, Safari ; mobile réel ou limite documentée | Résultat par navigateur ; URL et version vérifiées, pas de déduction depuis le build local |

### Moyens techniques de validation

Les scripts existent actuellement dans [package.json](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/package.json>). Les sélectionner selon le risque :

- Socle : `npm run test:ui`, `npm run validate:ai`, `npm run lint`, `npm run build`, `git diff --check` ; `npm run build:personal` lorsque le Coffre est touché.
- Accès et séparation : `test:public-account`, `test:personal-boundary`, `test:personal-rules`, `test:bridge-rules`, `test:correspondence-codes`, `test:code-bridge-command`.
- Permissions et publication : `test:rules`, `test:storage`, `test:invitation`, `test:administration-console`, `test:corrective-wave3`, complétés par les scénarios de publication/révocation manquants.
- Registre et objets : `test:registry-views`, `test:registry-wave4`, `test:registry-wave6`, `test:create`, `test:schema`, `test:demo-account`.
- Médias et parcours : tests dédiés de téléchargement, carrousel et médias privés, puis navigateur sur fichiers distants réels avec données fictives.

Inspecter les configurations avant lancement : ports et projets d’émulateurs isolés, aucun script de seed ou de migration dirigé par inadvertance vers la production. Produire les builds de recette dans un répertoire distinct du `dist` partagé si d’autres travaux l’utilisent. Les scripts existants constituent un point de départ, pas la preuve que les nouveaux cas sont déjà couverts. Aucun de ces tests n’a été relancé pour la simple rédaction de ce plan.

## 5. Décisions à préparer, sans bloquer les travaux indépendants

| Décision | Proposition de travail | Moment où elle devient nécessaire |
|---|---|---|
| Infrastructure effective et données anciennes | Vérifier/raccorder les projets existants avant toute création ; inventaire et migration réversible si nécessaire | Avant intervention distante de V01 |
| Récupération et confidentialité | Distinguer identité et déchiffrement ; expliciter les secours, leur stockage et les pouvoirs du support | Avant implémentation finale de V03 |
| Disponibilité provisoire d’un espace non conforme | Éviter les nouvelles opérations sensibles non garanties tout en préservant l’accès aux données existantes | Avant restriction de service |
| Conditions, confidentialité et éditeur | Informations réelles et textes validés par le responsable compétent | Avant publication des textes de V12 |
| Tarifs, quotas, conservation et niveau de service | Afficher uniquement des engagements approuvés ; expliquer le statut de disponibilité | Avant validation du contenu commercial |
| Contact, PDF, adresse personnalisée | Par défaut : copie du message, impression/PDF correctement nommée, adresse canonique fonctionnelle | V05, V08, V12 si une fonction plus ambitieuse est souhaitée |
| Types d’objets, langues et Cercle | Consolider d’abord ce qui existe ; annoncer explicitement les limites et démarches disponibles | V10–V13 |
| Mise en production et exploitation | Responsable, sauvegarde/restauration, support, coûts et périmètre de chaque livraison identifiés | Avant migration ou livraison distante |

Ce document prépare le travail ; il ne constitue pas une autorisation de créer des comptes réels, publier des objets, provisionner des services payants, migrer/supprimer des données ou déployer. Les arbitrages peuvent être préparés en parallèle ; ils ne doivent pas être tranchés silencieusement par une correction de code.

## 6. Contrôle de couverture des 42 constats

Chaque ligne désigne **une seule vague responsable de la clôture**. V00 organise la preuve ; V14 vérifie l’ensemble sans se substituer aux corrections.

| ID audit | Priorité | Clôture | Résultat vérifiable |
|---|---|---|---|
| 01 | P1 | V01 | Trois projets réellement utilisés, aucun repli silencieux |
| 02 | P2 | V12 | Textes lisibles aux points de consentement |
| 03 | P2 | V12 | Promesses proportionnées aux fonctions démontrées |
| 04 | P2 | V12 | Inscription guidée et progression explicite |
| 05 | P2 | V12 | Entrée Coffre conduisant au bon accès |
| 06 | P3 | V12 | Coûts, limites et disponibilité expliqués |
| 07 | P3 | V12 | Contact sans faux accusé et message récupérable |
| 08 | P1 | V03 | Accès et déchiffrement récupérés sur appareil vierge |
| 09 | P1 | V02 | Activation reprenable sans doublon ni escalade de droits |
| 10 | P2 | V02 | Connexions cohérentes pour les comptes existants |
| 11 | P1 | V04 | Saisies et états de sauvegarde fiables |
| 12 | P3 | V04 | Contacts distingués des droits et retours sûrs |
| 13 | P2 | V09 | Galerie des cinq démos renseignée |
| 14 | P2 | V09 | Valeurs et codes conformes au dossier source |
| 15 | P2 | V12 | Démonstration complète, fictive et non modifiable |
| 16 | P2 | V09 | Noms de Collections cohérents |
| 17 | P2 | V10 | Un même suivi opérationnel à tous les niveaux |
| 18 | P2 | V11 | Parcours commun pour les profils supportés |
| 19 | P2 | V09 | Aucune Collection archivée choisie par défaut |
| 20 | P2 | V09 | Erreur de chargement distincte d’un inventaire vide |
| 21 | P1 | V07 | Médias cloud utilisables sans cache local |
| 22 | P2 | V07 | Carrousel stable après réduction de la liste |
| 23 | P2 | V08 | Lecture vidéo effective sur mini-site |
| 24 | P2 | V08 | Parité de rendu sur la projection publique |
| 25 | P3 | V07 | Téléchargements identifiables et explicites |
| 26 | P1 | V05 | Statut publié confirmé par le serveur |
| 27 | P1 | V05 | Même sélection autorisée dans tous les niveaux |
| 28 | P1 | V05 | Suppression/retrait sans publication résiduelle |
| 29 | P2 | V05 | Adresse fonctionnelle ou champ trompeur retiré |
| 30 | P2 | V08 | Navigation respectant le contexte public ou privé |
| 31 | P1 | V06 | Invitation menant au bon Cartulaire |
| 32 | P2 | V06 | Révocation autorisée, confirmée et gérant les erreurs |
| 33 | P2 | V10 | Cercle lisible, états différenciés et démarche utile |
| 34 | P3 | V08 | Export PDF nommé et confirmé honnêtement |
| 35 | P2 | V13 | Menu mobile accessible et refermable |
| 36 | P2 | V13 | Huit entrées du Registre compréhensibles sur mobile |
| 37 | P2 | V13 | Noms accessibles et destinations exactes |
| 38 | P3 | V13 | Typographie, termes et langues harmonisés |
| 39 | P2 | V06 | Refus administrateur sans perte de session Registre |
| 40 | P2 | V06 | Actualisation fiable et dialogue administrateur accessible |
| 41 | P2 | V10 | Organisation et droits sans promesse de gestion fictive |
| 42 | P3 | V13 | Titres, chargements et erreurs contextualisés |

## 7. Livrable attendu à la fin de chaque vague

Un bilan court : **ce qui gênait l’utilisateur → cause → correction → test de non-régression → résultat dans le navigateur → version et environnement → limites restantes**. Joindre les liens utiles au test et, pour les changements visuels, des captures avant/après ordinateur et mobile.

La livraison finale rassemble le tableau des 42 clôtures, les preuves de recette, les éventuels reports encore ouverts et les liens de test de la version effectivement servie. Aucun état « corrigé » ne doit dépendre uniquement d’une intention, d’un aperçu local ou d’une compilation réussie.
