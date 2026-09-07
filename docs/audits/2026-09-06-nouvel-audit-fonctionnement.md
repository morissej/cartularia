# Cartularia — nouvel audit de fonctionnement

6 septembre 2026, passage de 21 h 41 à 22 h environ, Europe/Paris.

## Verdict

**La validation globale du fonctionnement n’est pas acquise.** Les parcours courants de démonstration fonctionnent et plusieurs corrections sont confirmées. Il reste cependant **13 anomalies fonctionnelles dans le code local, dont 3 prioritaires**, ainsi que des améliorations et un écart de version public/local. Les cas de concurrence les plus importants ne sont pas couverts par les tests existants.

Les deux défauts prioritaires du Coffre sont reproduits avec le vrai chiffrement et, pour la rotation, la vraie commande serveur sur une base mémoire. Le risque prioritaire de republication d’une Collection est reproduit jusqu’à la requête cliente ; son effet persistant est établi par lecture du service, sans publication distante pendant l’audit. **Aucune perte réelle de données utilisateur ni republication distante non souhaitée n’est affirmée.**

Audit sans correction : aucun fichier applicatif modifié, aucun déploiement, IAM, seed ou écriture métier distante. Les seuls ajouts sont les rapports et des fixtures de diagnostic temporaires. Connexion par les boutons démo existants, navigation et lectures en ligne ; tests mutateurs uniquement dans l’émulateur isolé ou des services simulés.

## Versions effectivement contrôlées

| Surface | Preuve actuelle | Ce que cela permet de conclure |
|---|---|---|
| Site public : `https://studio-2614005370-a3e51.web.app` | HTTP 200 ; entrée `/assets/index-2M4rMv2X.js`, SHA-256 `a5dfab1239d8b5202e7a78fb88f50eb6fece55cec3bda30223a7332ec1515f30` | Ancienne interface toujours visible : anciennes promesses, anciens libellés et liens. Données démo réparées présentes. |
| Recette locale : `http://127.0.0.1:4197` | HTTP 200 ; entrée `/assets/index-CFnpXImk.js`, SHA-256 `0e364565aea14855666682148b710b4cbcb2cb0e1178615c418d742a71fc8223`, identique au fichier construit | Version frontend corrigée, build du 6 septembre à 13:33:27 UTC ; aucun fichier de `src/` plus récent à l’ouverture de cet audit. |
| Code relu et testé | HEAD `94bba9c` avec modifications locales préexistantes ; 212 entrées de statut au départ | Le hash de commit seul n’identifie pas ce travail non commité. Les nouveaux défauts ci-dessous visent ce code courant. |
| Backend de recette | Projet fictif `cartularia-audit-local`, Auth 39499, Firestore 38480, Storage 39419 | Démo en lecture seule, pas de Functions démarrées ; Coffre/pont non raccordés dans ce build. Pas une recette propriétaire complète. |

Un hash différent entre deux builds configurés différemment n’est pas, à lui seul, une preuve d’ancienneté. Ici l’écart de livraison est également confirmé par le contenu et les contrôles réellement rendus dans Chrome.

## 1. Anomalies prioritaires à traiter avant une validation de production

### AC01 — P1 : le Coffre peut être sauvegardé avec le mauvais secret

Entrer le mot de passe A, lancer l’ouverture, puis modifier le champ encore actif en B pendant l’attente. Le Coffre finit par s’ouvrir avec A, mais sa sauvegarde suivante utilise B. La vraie enveloppe produite ne se déchiffre plus avec A ; elle se déchiffre avec B. Le compte Auth conserve pourtant A et l’écran annonce un enregistrement réussi.

**Impact :** perte d’accès par le parcours normal après verrouillage. Ce n’est pas seulement un libellé erroné.

**À prévoir :** séparer le secret confirmé de la session et le brouillon des identifiants ; ignorer les réponses obsolètes. [Preuves AC01](2026-09-06-nouvel-audit-comptes.md#ac01--p1--saisie-pendant-louverture-puis-clé-de-sauvegarde-désynchronisée).

### AC02 — P1 : une rotation de mot de passe peut écraser une version plus récente

A ouvre V1 ; B enregistre V2 ; A change son mot de passe sans recharger. Le service relit l’empreinte V2, mais rechiffre le contenu V1 encore affiché. La commande serveur accepte cette précondition récente et remplace V2 par l’ancien contenu.

**Impact :** perte silencieuse du travail de B malgré la protection contre les conflits présente dans la sauvegarde ordinaire.

**À prévoir :** utiliser la version effectivement déchiffrée par la session et refuser le conflit avant les opérations Auth, puis au commit. [Preuves AC02](2026-09-06-nouvel-audit-comptes.md#ac02--p1--rotation-du-mot-de-passe-à-partir-dun-affichage-périmé).

### N-R01 — P1 : un ancien formulaire peut renvoyer une publication retirée ailleurs

A édite une Collection publiée. B retire sa publication et modifie sa description. A change seulement le nom dans son formulaire resté ouvert : la requête renvoie toujours l’ancien consentement, les anciens objets sélectionnés et l’ancienne description. Le service d’enregistrement ne compare pas la version du formulaire.

**Impact :** risque d’écraser la décision plus récente et de republier son ancienne sélection. Ce scénario concerne deux sessions autorisées, pas un contournement des permissions. L’envoi obsolète est reproduit ; aucune republication réelle n’a été exécutée.

**À prévoir :** contrôle de version serveur, conflit explicite, nouvelle décision de publication après relecture. [Preuves N-R01](2026-09-06-nouvel-audit-registre.md#n-r01--p1--un-formulaire-de-collection-ancien-peut-annuler-une-décision-plus-récente).

## 2. Autres anomalies fonctionnelles du code local

| Référence | Priorité | Scénario et conséquence | Preuve nouvelle |
|---|---|---|---|
| AC03 | P2 | Un kit commencé sous A revient après passage à B. L’activation annonce un succès pour B, mais le fichier reste lié à A et ne permet pas le secours de B. | UI, client, crypto et commande serveur sur services/base simulés. |
| AC04 | P2 | Une ancienne synchronisation des codes termine après une plus récente : inventaire du pont périmé alors que le dernier Coffre porte `codeSyncPending:false`. | Orchestrateur réel, ordre déterministe des écritures et CAS simulés ; code du pont relu. |
| N-R02 | P2 | Supprimer une Collection pendant son édition laisse le formulaire ouvert et sauvegardable avec le même identifiant. Sa sauvegarde peut la recréer. | Formulaire et requête reproduits ; upsert confirmé dans le service. Les anciens enfants publics sont bien nettoyés par la nouvelle suppression serveur. |
| N-R03 | P2 | Après délai de création, corriger le modèle puis réessayer conserve l’ancienne demande ; le succès affiche pourtant le nouveau titre, jamais envoyé. | Reproduction DOM de la reprise, paramètres et faux titre contrôlés. |
| N-R04 | P2 | Choisir des médias dans Publication du Cartulaire générique, quitter puis revenir perd la sélection sans avertissement. | Reproduction DOM avec média déjà autorisé, contrôle de `beforeunload` et remontage. |
| N-R05 | P2 | Une Collection secondaire contenant un objet n’est pas proposée dans la portée d’une invitation. | Deux Collections, objet à double rattachement ; option secondaire absente, aucune invitation envoyée. |
| N-R06 | P2 | Le lecteur générique alternatif d’une montre propose des listes partiellement éditables que le serveur refuse ensuite, faute de champs frères non éditables. | Reproduction pure sur `condition.reports[]` et contrat serveur ; chemin alternatif, pas le parcours nominal montre. |
| M01 | P2 | Une vidéo ou un PDF sans poster classé dans Diaporama bloque la préparation du rapport au bout de 30 secondes. | Deux reproductions de composants et temporisation, renderer relu. Le rapport Submariner nominal réussit. |
| M02 | P2 | Une image 360° en erreur réseau/décodage n’offre ni diagnostic ni reprise de cet angle. | Échec du préchargement et événement `error` reproduits sur le composant. |
| M03 | P2 | Un original nommé `cadran.jpg` peut fournir une copie WebP téléchargée sous le nom `cadran.jpg`. | Attribut de téléchargement reproduit sur le bloc public ; comportement de logiciels tiers non testé. |

Détails, lignes et propositions : [comptes et Coffre](2026-09-06-nouvel-audit-comptes.md), [Registre et Collections](2026-09-06-nouvel-audit-registre.md), [médias et PDF](2026-09-06-nouvel-audit-medias.md).

## 3. Problèmes encore visibles en ligne et améliorations

### D01 — P1 livraison : les corrections locales ne sont pas celles du visiteur public

Depuis [l’accueil public](https://studio-2614005370-a3e51.web.app/), Chrome montre encore « Rapport PDF Opposable », « Ancré & daté », des contrats annoncés dans le Coffre et les mentions de pied de page non proposées comme liens. La recette locale présente les formulations prudentes, les limites du pilote, les vrais liens d’information et la réserve sur les pièces jointes du Coffre. Il faut une livraison coordonnée, mais **pas avant traitement des P1 de cet audit**.

Le raccordement IAM du secours avait été refusé lors de l’exécution précédente. Cet audit n’a ni réinterrogé IAM ni réessayé son application : voir [le dossier d’autorisation existant](2026-09-06-autorisation-raccordement-secours.md). La présente demande d’audit n’a pas été interprétée comme une approbation de ce changement.

### D02 — P2 livraison : le Catalogue public propose un mini-site vide

Parcours réellement cliqué : accueil → Registre démo → « Voir le mini-site » sur Audemars Piguet. L’onglet ouvert affiche « Aucun contenu validé » et demande de valider du contenu depuis Publication, alors que ce compte est en lecture seule. Dans le dernier Catalogue local, ce faux raccourci n’est pas proposé. La réparation des données seule ne corrige pas cet ancien lien.

### Améliorations non confondues avec les blocages

- **M04 — P3 :** une phrase ordinaire comme « Cadran original bleu, sans restauration. » est filtrée sans avertissement à cause du mot « original ». Reproduction pure réussie. Expliquer l’exclusion et réduire les faux positifs sans affaiblir la confidentialité.
- **M05 — P3 :** une vidéo publique est téléchargée intégralement avant lecture, sans progression ni annulation. Chemin de code confirmé, pas de mesure sur réseau lent.
- **N-R07 — P3 :** le formulaire de création dit à la fois que les montants alimentent les vues privées du Registre et que sa projection ne contient aucune valeur. Clarifier la distinction Registre privé / mini-site public.
- **U01 — P3, navigateur :** dans la fenêtre 360° mobile, les 14 liens sont visuellement tous nommés « Télécharger ». Les noms existent dans leurs labels accessibles, mais aucun angle/nom visible ne permet de choisir sa vue. Source : `CartularyModals.tsx:53-57`.
- **U02 — P3, navigateur + code :** le deuxième angle du jeu Rolex est affiché à 26° par le calcul uniforme `360/14`, alors que ce média est nommé 30°. Les vues du jeu ne sont pas régulièrement espacées. Afficher un index plutôt qu’un degré non connu, ou porter un angle explicite par média. Source : `Spin360.tsx:242,288` ; noms des médias visibles dans la bibliothèque du mini-site.
- **Comptes historiques :** le transfert de codes refuse explicitement les anciens comptes Registre identifiés par une vraie adresse email. Ce refus préserve la séparation, mais leur migration/rattachement prouvé reste à définir ; tous les comptes ne sont pas couverts.
- **Invités :** le diagnostic de média non autorisé est amélioré, mais aucune copie accessible n’est fournie dans certains parcours. Aucune preuve de consultation/téléchargement complet d’un invité réel n’est acquise.

## 4. Parcours effectivement réussis pendant ce nouvel audit

| Parcours | Résultat obtenu maintenant | Limite |
|---|---|---|
| Accueil local à 390 × 844 | Largeur réelle mesurée 390, pas de débordement horizontal ; menu ouvert, accès démo cliqué, actions lisibles | Simulation responsive dans Chrome desktop, pas téléphone réel. Dimensions réinitialisées ensuite. |
| Catalogue local connecté | 5 objets, recherche inexistante → message utile ; recherche Rolex → 1 objet | Compte fictif en lecture seule. |
| Catalogue → Cartulaire → retour | Le filtre `q=Rolex` et sa valeur visible sont conservés | Un aller-retour nominal, pas une garantie sur toutes les saisies. |
| Cartulaire mobile | Consultation des Médias, fenêtre 360°, angle suivant 0°→26°, image décodée, liste de 14 téléchargements | Défauts U01/U02 ci-dessus ; panne d’image traitée dans les probes M02. |
| Mini-site local correspondant | Mention « Aperçu local · non publié », navigation Médias, bibliothèque et actions de téléchargement présentes ; aucun des montants privés recherchés dans le texte affiché | Projection de démonstration, pas publication/retrait réels. Pas un audit exhaustif d’absence de données sensibles. |
| Rapport Submariner nominal | 23 blocs, 38 images décodées, aucune image non prête, bouton « Imprimer / Enregistrer en PDF » activé | Aucun PDF final enregistré ni pagination imprimée validée. M01 reste présent sur médias mixtes. |
| Collections, Suivi, Organisation locaux | « Les cinq icônes », 5 objets, non publié / aucun objet exposé ; Suivi vide sans erreur ; droits démo sans action de mutation administrative | Les flux propriétaire, invitation et administration privilégiée nécessitent d’autres sessions. |
| Démo en ligne | Connexion via bouton existant ; 5 codes, 5 révisions 2, 5 images principales décodées | Ancien frontend, cf. D01/D02. |
| Preuves en ligne | 5/5 chaînes vérifiées, 10 événements, 0 ancrage public revendiqué | Ne prouve ni authenticité de l’objet ni horodatage externe. |

Un téléchargement de photo fictive a été déclenché depuis le Cartulaire. Le contrôle du gestionnaire de téléchargements du navigateur a été refusé par sa politique ; aucun contournement tenté. **Le fichier enregistré sur disque n’est donc pas vérifié** : ne pas assimiler le clic ou l’attribut `download` à une validation complète du téléchargement.

## 5. Tests frais et lecture de leurs résultats

- **Suite UI complète : 178/178, 46 fichiers**, relancée par le responsable d’audit.
- **Collections : 14/14 sur émulateur**, dont suppression/réaffectation concurrente et recréation sans anciens éléments publics. Fixtures isolées puis nettoyées.
- Séries ciblées des lots : Registre 29 UI + 38 Node ; comptes 40 UI + 17 Node ; médias 56 UI et **17/18 Node**. Les tests UI se recouvrent avec la suite complète : **ne pas additionner ces nombres pour gonfler la couverture**.
- **T01 :** l’unique échec Node médias provient d’une assertion textuelle obsolète dans `tests/media-download-wiring.test.mjs:24`. Ce n’est pas la preuve d’une panne Storage ; le test doit être remplacé par une vérification fonctionnelle. Aucun correctif appliqué ici.
- Les **14 probes temporaires** des trois lots ont été rejouées indépendamment par le responsable d’audit : 4 comptes, 5 Registre, 5 médias. Elles réussissent **parce qu’elles reproduisent les défauts**, pas parce qu’elles valident leur correction. N-R06 dispose en plus d’une reproduction pure dans le lot Registre.

Reproductions disponibles tant que le système conserve les répertoires temporaires :

```sh
node node_modules/vitest/vitest.mjs run --config /private/tmp/cartularia-audit-comptes-JPRBaZ/vitest.config.mjs
node node_modules/vitest/vitest.mjs run --config /private/tmp/cartularia-nouvel-audit-registre.nbg9n0/vitest.config.mts
node node_modules/vitest/vitest.mjs run --config /private/tmp/cartularia-medias-audit.SpoQCd/vitest.config.ts
```

## 6. Ordre recommandé pour la suite — non exécuté dans cet audit

1. Corriger AC01, AC02 et N-R01 ; transformer leurs reproductions en tests empêchant la perte d’accès, l’écrasement et la republication obsolète.
2. Traiter AC03/AC04 et les reprises N-R02 à N-R06, puis les trois pannes médias M01–M03 et le test T01.
3. Refaire les scénarios propriétaire sur deux sessions, puis propriétaire→invité→visiteur, téléchargement et PDF réellement enregistrés, interruption réseau et récupération sans cache.
4. Seulement ensuite, préparer la livraison coordonnée frontend/serveur/Rules/indexes/Coffre avec les autorisations appropriées ; vérifier les versions servies et rejouer les mêmes parcours sur les domaines publics.

Ce rapport n’est pas un audit exhaustif de sécurité, d’accessibilité WCAG ou de conformité juridique. Aucun test Safari/Firefox, téléphone réel, compte personnel existant ou service de secours trois projets en production n’est revendiqué. Les résultats des anciens audits ne remplacent pas ces validations manquantes.
