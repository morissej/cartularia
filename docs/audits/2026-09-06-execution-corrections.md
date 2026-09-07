# Exécution des corrections Cartularia

Lancement autorisé le 6 septembre 2026 : vagues successives sans validation intermédiaire demandée à l’utilisateur. Ce journal distingue code corrigé, tests locaux, services distants et version effectivement livrée.

## Référence V00

- Checkout : `main`, commit de base `94bba9c`, avec modifications préexistantes conservées.
- Copie de sécurité avant corrections : `/private/tmp/cartularia-corrections-20260906.2wRRRD/pre-existing-worktree.tar.gz` (archive locale privée, pas un livrable public).
- Baseline UI relancée : 65 tests réussis / 66. Échec ancien libellé et ancienne route démo dans `public-site.test.tsx`.
- Inventaire Firebase actuel : les trois projets attendus existent et sont actifs. Vérification du contenu et du raccordement en cours ; aucune nouvelle infrastructure créée.
- Répartition : Coffre/récupération ; publication/médias ; Registre/multi-objets ; intégration comptes/accueil/administration et recette.

## Décisions d’implémentation

- Récupération par kit cryptographique détenu par l’utilisateur, indépendant dans chaque espace. Pas d’identité personnelle ajoutée au Registre ; pas de reset Auth présenté comme un déchiffrement.
- Contact : email préparé et message complet copiable ; aucun envoi serveur ni faux accusé.
- PDF : impression/enregistrement PDF correctement nommé ; pas de nouveau moteur PDF imposé.
- Offre : fonctionnement pilote et limites annoncés honnêtement, sans inventer tarifs, garanties de conservation ou mentions d’éditeur inconnues.

## Résultat et statut de livraison

Les chantiers V01–V13 ont produit des corrections de code et des tests. **V14 n’est pas clôturée : aucune nouvelle version n’a été déployée, aucun commit ni push n’a été réalisé.** Les changements préexistants ont été conservés. Les projets distants ont seulement été inspectés ; les tests ont utilisé des données fictives locales.

La distinction est volontaire : un contrôle local réussi ne démontre ni le raccordement réel du secours, ni une réparation des données Firestore distantes, ni une publication depuis un navigateur authentifié sur la version livrée.

### Blocages et reliquats explicites

1. **Secours en production — autorisation IAM refusée par le contrôle automatique.** Il faut créer un compte d’exécution et deux signataires, puis accorder les permissions détaillées dans [l’autorisation spécifique](2026-09-06-autorisation-raccordement-secours.md). Aucun de ces droits n’a été appliqué ; aucun contournement par le compte de calcul existant. Les permissions IAM Firestore seraient au niveau des bases, pas limitées aux chemins par les Rules clientes.
2. **Vidéo publique importée — runtime non provisionné.** Le lecteur fonctionne pour un média disponible ; la création d’un dérivé public depuis un nouvel original exige FFmpeg/FFprobe récents. L’absence de ces exécutables laisse l’original privé et interdit sa publication. Aucun vieux binaire ou exécutable global installé.
3. **Données démo distantes — réparation préparée, non exécutée.** Le seed commun corrige cinq images, montants et noms ; il reste à l’appliquer de façon coordonnée puis à comparer les vues servies. Le build client seul ne répare pas les documents distants.
4. **Textes et offre — limites rendues lisibles, validation définitive absente.** Mentions complètes de l’éditeur, responsable des données, conditions commerciales, quotas et engagements de conservation ne sont pas inventés. Les pages décrivent honnêtement le pilote, sans prétendre constituer des CGU ou une conformité juridique validées.
5. **Dépendances — alertes à instruire.** L’installation a signalé 25 alertes globales dont 2 hautes et 2 critiques. L’audit npm détaillé a été refusé par le contrôle automatique car il transmettrait la liste/version des dépendances à npmjs.org. Aucune attribution aux nouveaux composants PDF et aucun audit de sécurité complet ne sont revendiqués.
6. **Recette restante.** Sessions réelles dans trois projets distincts, wrapper Functions/App Check, migration/backlog des médias, invitation et retrait avec deux navigateurs, mobile du Registre authentifié, pagination des rapports complets et présentation média complète du Cercle ne sont pas tous démontrés. Ces limites interdisent une conclusion « tout le site validé ».

## Suivi des 42 constats

« Local » ci-dessous signifie correction ciblée et tests indiqués, non validation sur le site en ligne. « Partiel » conserve un reliquat identifié. Les deux rapports spécialisés détaillent causes, fichiers et scénarios : [Registre](2026-09-06-corrections-registre-recette.md), [médias/publication](2026-09-06-correctifs-media-publication.md).

| Constat | Vague | Correction et preuve principale | État / reste à établir |
|---|---|---|---|
| 01 | V01 | Configurations Coffre/pont complètes et distinctes obligatoires ; collisions et repli vers Registre refusés. Projets réels existants inventoriés, builds configurés. | Local ; recette authentifiée des trois audiences et déploiement restants |
| 02 | V12 | Liens conditions/confidentialité consultables avant consentement, routes et textes du pilote testés. | Partiel : mentions et validation juridique définitives manquantes |
| 03 | V12 | Promesses d’assurance, authenticité, horodatage et confidentialité reformulées ; démonstration fictive explicite, limites des pièces jointes visibles. | Local ; relecture éditoriale globale restant possible |
| 04 | V12 | Démarrage expliqué en trois étapes : Registre, premier objet, Coffre si nécessaire. | Local + formulaire vu dans le navigateur, sans création réelle |
| 05 | V12 | Entrée Coffre redirigée vers son interface dédiée, sans mot de passe transféré. | Local ; cible dédiée vérifiée dans le build, raccordement final restant |
| 06 | V12 | Page Disponibilité et limites : pilote, aucun paiement en ligne, aucune promesse de stockage illimité. | Partiel : décisions commerciales non inventées |
| 07 | V12 | Préparation d’email annoncée avant action, message complet copiable, pas de faux accusé d’envoi. | Local ; aucun email réellement envoyé pendant la recette |
| 08 | V03 | Kits Registre/Coffre, preuve cryptographique unique, activation/remplacement/révocation, reprise du déchiffrement et rotation atomique. Sessions révoquées refusées. | Tests réels émulateurs réussis ; production bloquée IAM |
| 09 | V02 | Activation transactionnelle idempotente et reprise après identité créée ; suspension/droits retirés jamais restaurés. | Local + six activations concurrentes sur émulateur |
| 10 | V02 | Minimum de création non imposé aux mots de passe historiques à la connexion ; logique partagée. | Local, tests des deux parcours |
| 11 | V04 | Saisie sale, garde de départ, Enregistrer et verrouiller, protection contre réponses tardives et écrasement après rotation. | Tests UI/crypto/CAS ; fermeture forcée toujours une limite navigateur |
| 12 | V04 | Contacts gestionnaires descriptifs, absence de délégation expliquée ; retours protégés. | Local |
| 13 | V09 | Source démo unique et documents média/cover construits pour les cinq objets. | Seed distant non appliqué |
| 14 | V09 | Frais, valeurs nettes et codes cohérents ; vrais zéros préservés ; champs absents non remis à zéro par édition générique. | Local + tests ; projections distantes à reprendre |
| 15 | V12 | Accès explicite mini-site et rapport depuis la démo ; faux incidents de suivi/Collections supprimés, données privées non lues dans le suivi démo. Les médias fictifs statiques ont une source publique explicite, sans ouvrir les vrais médias Secret. | Démo et mini-site vérifiés dans le navigateur ; pas assimilés à une publication réelle |
| 16 | V09 | Nom canonique depuis Collection, abonnement commun aux vues, source fictive canonique pour la démo. | Local ; renommage distant simultané à recetter |
| 17 | V10 | Suivi accueille le tableau À Faire commun ; résumé/lien depuis Vue d’ensemble, retour contextualisé. | Local ; même tâche dans deux sessions à recetter |
| 18 | V11 | Montre/automobile explicites, schémas exacts, six pages, édition scalaire persistée, médias, tâches, partage choisi et synthèse imprimable. | Création/édition automobile en émulateur ; listes répétées et édition média avancée hors formulaire générique |
| 19 | V09 | Collection active uniquement par défaut ; serveur revérifie dans la transaction avant création. | Local + refus réel en émulateur, aucune écriture partielle |
| 20 | V09 | Chargement, erreur, vide et dernier inventaire connu distincts ; reprise et actions dangereuses désactivées si état inconnu. | Local |
| 21 | V07 | Résolveur cloud partagé image/vidéo/PDF/360°/téléchargement, identifiant de dossier explicite et contrôle d’empreinte. | Tests ciblés ; navigateur privé neuf sans cache restant |
| 22 | V07 | Sélection du carrousel par identité et index borné ; réduction, réordonnancement et liste vide testés. | Local ; tactile réel restant |
| 23 | V08 | Vrai lecteur vidéo et copie publique vérifiée exigée. | Partiel : runtime de transcodage des nouveaux uploads absent |
| 24 | V08 | Aperçu et publication utilisent le même rendu de blocs et les mêmes lecteurs/téléchargements. | Local ; publication anonyme distante à recetter |
| 25 | V07 | Noms et formats utiles, préparation, indisponibilité et nouvelle tentative explicites. | Téléchargement réel du mini-site démo confirmé dans Chrome ; média cloud privé authentifié restant |
| 26 | V05 | Publication autoritaire, sélection/consentement, révision et état actuel serveur ; ancien reçu ne prétend pas republier. | Tests mémoire + vrais Firestore/Storage locaux ; wrapper distant restant |
| 27 | V05 | Listes blanches et compteurs cohérents par destination ; médias admissibles seulement, confirmation d’absence de contenu personnel. | Local ; anonymisation visuelle des pièces jointes jamais garantie automatiquement |
| 28 | V05 | Retrait atomique des projections/droits, suppression des copies connues, journal immuable et reprise après refresh/panne. Collection retirée avant suppression. | URL à jeton bloquée + fichier absent démontrés localement ; anciens fichiers non référencés à inventorier |
| 29 | V05 | Adresse canonique serveur et aperçu local nommés correctement ; champ éditable sans effet supprimé. | Local ; lien réellement publié à vérifier après livraison |
| 30 | V08 | Logos publics vers Accueil ; Collection publique n’envoie pas vers Cartulaire privé ; liens conditionnés aux publications actives. | Local et mini-site de démo vu dans le navigateur |
| 31 | V06 | Invitation résout type/dossier autorisés et ouvre la bonne route ; lien malformé traité. | Tests UI ; deux comptes réels à recetter |
| 32 | V06 | Droits de révocation, cible, confirmation, attente, succès/erreur/reprise explicites. | Tests UI ; coupure effective dans deuxième navigateur restant |
| 33 | V10 | Cercle : session/admission/chargement/vide/erreur distincts, contact/connexion/retour/retry et champs lisibles. | Partiel : présentation média communautaire complète non ajoutée |
| 34 | V08 | « Imprimer / Enregistrer en PDF », sans promettre le fichier enregistré ; synthèse automobile réutilise ce mécanisme. | Local ; pagination finale avec médias distants restante |
| 35 | V13 | Menu mobile sous l’en-tête, fermeture visible, hauteur bornée, Échap et restitution du focus. | Vérifié dans Chrome à 390 × 844 |
| 36 | V13 | Navigation Registre en deux rangées avec libellés visibles et remontée au contenu. | Local ; visuel du Registre authentifié restant |
| 37 | V13 | Noms accessibles édition, suppression, vidéo et À Faire ; focus/inert des dialogues. | Tests composants et contrôle navigateur partiel |
| 38 | V13 | Vocabulaire objet/mini-site, dates et libellés localisés ; absence de prétention à une harmonisation intégrale. | Partiel : finition éditoriale et visuelle globale restante |
| 39 | V06 | Refus d’administration ne déconnecte plus le compte Registre ; état Accès réservé et retour. | Tests UI avec session conservée |
| 40 | V06 | Administration : erreurs de rafraîchissement visibles, actions bloquées sur état périmé, dialogue clavier et retour focus. | Local ; compte administrateur réel non utilisé |
| 41 | V10 | « Organisation et droits », actions réellement proposées et contact clairement distingués. | Local ; aucun paiement ni gestionnaire de factures ajouté |
| 42 | V13 | Chargement/titres/logos contextualisés ; erreur de démarrage sans faux diagnostic ni réinitialisation silencieuse. | Tests de routage/bootstrap + états de chargement vus dans Chrome |

## Contrôles consolidés

| Contrôle | Résultat | Ce que cela prouve / limite |
|---|---|---|
| Suite UI globale | 127 tests / 35 fichiers réussis | Composants et interactions simulées ; pas 127 parcours de production |
| Tests Node ciblés comptes, accès, édition, médias, publication, navigation, démo | 114 réussis | Inclut crypto réelle et PDF reconstruit ; certains services simulés |
| Schémas immuables | 21 tests réussis ; catalogue vérifié | Versions historiques conservées, profils actuels cohérents |
| Rules Firestore Registre/Coffre/pont | 27 tests réussis | Requêtes réellement autorisées/refusées par émulateur |
| Rules Storage | 16 tests réussis | Original privé, sélection de dérivé, révocation, membership et modération |
| Activation et récupération Auth/Firestore | 3 scénarios réels réussis | SDK client, nouvelle session, concurrence, suspension, rotation/reprise ; Auth émulateur unique, pas IAM multi-projet |
| Publication Firestore/Storage | 3 scénarios réels réussis | Ancienne URL à jeton accessible avant puis refusée, `exists=false`, reprise après panne, original intact |
| Création + live-sync | 7 tests réels réussis | Automobile créée/éditée, conflit/droits/archivage refusés, médias/rappels/valeurs préservés |
| Catalogue IA | 85 postes / 85 identifiants valides | Liaison interface/catalogue |
| TypeScript, lint, diff-check | Réussis | Pas d’avertissement lint sur la dernière passe |
| Builds Registre et Coffre | Réussis, sorties temporaires isolées | Pas de déploiement ; warnings de découpage des bundles conservés |

Un premier essai Rules avait échoué par restriction de connexion locale du bac. Après autorisation locale, Firestore est passé. Storage a ensuite dû être lancé avec son propre projectId fictif correspondant à Firestore pour les appels croisés : les 16 tests passent dans `firebase.audit-storage-test.json`. Un arrêt ultérieur du processus d’émulateurs pendant la recette publication a nécessité la relance du seul bac identifié ; la suite réelle a ensuite réussi et nettoyé ses données fictives exactes. Aucun processus utilisateur non identifié n’a été arrêté.

### Preuves de recette navigateur

Chrome, sur le build local en mode production : accueil ordinateur et téléphone, menu ouvert/fermé par Échap avec focus restauré, création d’accès non soumise, conditions lisibles avant inscription, Cartulaire démo et navigation vers Publication, compteurs admissibles 14/14 et absence de faux incident Collections sur la version candidate. Mini-site distingué explicitement « Aperçu local · non publié », logo vers Accueil public.

La première recette réelle de l’aperçu a révélé des médias fictifs encore classés Secret, donc tous filtrés : correction de la source de démonstration, sans assouplir `buildWebsiteDraft` pour les vrais médias privés. Le test dédié couvre les cinq Cartulaires fictifs, les fichiers vidéo existants et l’exclusion d’un véritable asset Secret. Après reconstruction : photo, lecteur vidéo, 360°, carrousel et téléchargements visibles sur le mini-site. Lecture vidéo confirmée (`paused=false`, `readyState=4`, durée 4,684812 s, aucune erreur média) et événement de téléchargement navigateur reçu pour `Rolex Submariner · plateau tournant 0°.jpg`. Une image fictive a donc été téléchargée localement pendant la recette.

Cette recette ne soumet ni nouveaux identifiants réels, ni messages, ni demande de publication de contenus personnels. La démonstration publique et les callables testées en émulateur sont deux niveaux de preuve distincts.

## Versions et liens de test

Le serveur de consultation local est [http://127.0.0.1:4187/](http://127.0.0.1:4187/). Il sert un build isolé récent du checkout ; ce n’est pas Firebase Hosting. Les fonctions et données distantes restent à leur état antérieur. Ne pas utiliser cette prévisualisation comme preuve que les nouvelles opérations serveur sont livrées.

Artefacts finaux : `/private/tmp/cartularia-corrections-20260906.2wRRRD/site-verified-build` et `/private/tmp/cartularia-corrections-20260906.2wRRRD/coffre-verified-build`. Le serveur 4187 sert le premier. Empreintes SHA-256 des fichiers d’entrée (et non du checkout entier) :

- `index.html` : `a1dd8e01f79ed2ba764ef235c20302911e20d78e0dbece958801504400e2561a`.
- `personal-vault.html` : `e55f786a32d12257d17c0400919be6272913755d33089f75b66239d7ca37b0af`.

Les émulateurs de recette ont été arrêtés proprement après nettoyage fictif ; la prévisualisation locale 4187 est conservée pour consultation tant que son processus reste ouvert.

- [Accueil local](http://127.0.0.1:4187/)
- [Création d’accès — lecture du formulaire](http://127.0.0.1:4187/account/create)
- [Cartulaire démo](http://127.0.0.1:4187/cartulary-demo?cartularyId=cart_demo_rolex_submariner_124060#cover)
- [Médias de la démo](http://127.0.0.1:4187/cartulary-demo?cartularyId=cart_demo_rolex_submariner_124060#media)
- [Publication, aperçu mini-site et rapport](http://127.0.0.1:4187/cartulary-demo?cartularyId=cart_demo_rolex_submariner_124060#publication)
- [Limites du pilote](http://127.0.0.1:4187/service)

Les domaines [Registre Firebase Hosting](https://studio-2614005370-a3e51.web.app/) et [Coffre Firebase Hosting](https://cartularia-vault-a3e51.web.app/) **n’ont pas été mis à jour dans cette exécution**. Les nouvelles corrections ne doivent pas y être présumées disponibles.

## Reprise ordonnée après levée des blocages

1. Obtenir l’autorisation IAM spécifique, inspecter/appliquer le plan exact, puis valider les trois audiences et les refus sur comptes fictifs.
2. Instruire les alertes de dépendances et choisir/provisionner le runtime vidéo maintenu ; recetter le dérivé réellement produit avant ouverture de cette fonction.
3. Finaliser les éléments juridiques/commerciaux manquants avec l’exploitant ; ne pas les remplacer par des affirmations techniques.
4. Recetter le cycle intégré client → Functions → Rules → Storage et deux utilisateurs, ainsi que la première création/édition générique, le Coffre et les rapports.
5. Livrer de façon coordonnée les versions nécessaires, appliquer uniquement la réparation démo contrôlée et le backlog média autorisé, puis tester les liens servis et leurs fichiers hachés. Ne fermer V14 qu’après ces vérifications.

## Références techniques

Les reprises concurrentes utilisent les [transactions Firestore](https://firebase.google.com/docs/firestore/manage-data/transactions). Les sessions de récupération utilisent la [création de jetons personnalisés Firebase](https://firebase.google.com/docs/auth/admin/create-custom-tokens), après vérification serveur de la preuve de possession ; jamais un jeton privilégié dans le client.
