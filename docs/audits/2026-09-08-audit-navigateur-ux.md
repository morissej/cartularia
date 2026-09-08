# Cartularia — Audit navigateur du point de vue utilisateur

Date : 8 septembre 2026 · Site audité : [https://studio-2614005370-a3e51.web.app/](https://studio-2614005370-a3e51.web.app/) (production, bundle `index-2M4rMv2X.js`, antérieur aux travaux ADR-028 à 031 du dossier de travail).

## Périmètre et méthode

Parcours d’un visiteur sans compte, puis du compte démo partagé en lecture seule (bouton « Ouvrir le Registre démo », aucun identifiant saisi), dans le navigateur intégré, à 1440 × 900 puis à 390 × 844. Surfaces visitées : accueil public, Cartulaire de démonstration (six pages, panneau Preuves, bascule EN), mini-site public, Cercle, mini-site de Collection, pages d’information, page 404, connexion, Registre démo (vue d’ensemble, catalogue, collections, galerie, comparaison, suivi, accès, preuves, administration), déconnexion.

Mesures relevées par le navigateur : requêtes et poids transférés, temps de chargement, erreurs console, structure d’accessibilité (titres, libellés, tailles de cibles), débordements horizontaux.

Limites : le panneau du navigateur est resté masqué pendant la session, donc les captures ne montrent que le haut de chaque page ; les défilements et survols n’ont pas pu être observés visuellement, ils ont été mesurés par script. Aucun parcours propriétaire (création, téléversement, publication, rapport PDF, Coffre) n’a été exercé : le compte démo l’interdit et aucun identifiant réel n’est utilisé. Aucun test clavier complet ni lecteur d’écran. Le journal console du navigateur intégré persiste entre navigations dans un onglet réutilisé : les comptages d’avertissements « par page » (B6) proviennent d’un onglet réutilisé et sont à relire en ouvrant un onglet neuf par page.

Niveaux de preuve : **Observé** (résultat obtenu sur le site) · **Mesuré** (valeur relevée par script) · **Amélioration UX** (jugement d’usage).

Ce rapport recense **26 constats**, classés par gravité puis par thème.

## Appréciation générale

L’identité visuelle est forte et cohérente, l’accueil est léger et bien structuré, le Registre navigue sans rechargement et la chaîne de preuves est lisible. Les trois faiblesses principales vues par un visiteur sont : des liens légaux et de service qui mènent à une erreur 404, une démonstration qui promet un partage et un mini-site qu’elle ne montre jamais, et un Cartulaire en lecture seule qui se présente comme un formulaire à remplir. Sur téléphone, deux pages du Cartulaire sont hors de portée et la page Valorisation déborde.

## A. Bloquant ou majeur

| # | Constat | Preuve | Recommandation |
|---|---|---|---|
| A1 | Les pages `/conditions`, `/confidentialite`, `/service` et `/accessibilite` affichent « Cette page n’existe pas ». Elles sont liées depuis le formulaire de contact (politique de confidentialité), le pied de page et la page de connexion. | Observé | Déployer la version du dossier de travail, qui route ces adresses vers la page d’information de service ; ajouter un contrôle de non-régression des liens du pied de page. |
| A2 | App Check échoue sur toutes les surfaces : erreur 403, reCAPTCHA (346 ko) chargé même pour un visiteur, puis mise en veille des tentatives pendant 24 h. Les fonctions serveur qui exigent App Check (invitations, publication, secours) peuvent être refusées. | Observé, console | Vérifier la clé reCAPTCHA, le domaine `web.app` autorisé et l’enregistrement de l’application dans App Check ; ne charger reCAPTCHA que sur les surfaces authentifiées. |
| A3 | La promesse « Voir la projection de partage » de l’accueil n’aboutit à aucun mini-site : `/watch-website?publicCode=DEMO-ROL-124060` répond « Aucun contenu publié », et depuis le Registre démo, les cinq boutons « Voir le mini-site » mènent à « Aucun contenu validé ». | Observé | Publier réellement le mini-site d’au moins un Cartulaire de démonstration, ou retirer ces liens de la démo. |
| A4 | Depuis l’accueil, le Cartulaire démo propose « Retour au Registre » vers le Registre privé (`/registry/reg_collection_privee/items`), qui exige une connexion. Depuis le Registre démo, le lien est correct. | Observé | Faire pointer le retour par défaut d’un Cartulaire `cart_demo_*` vers le Registre démo ou vers l’accueil. |
| A5 | Le Cercle (`/community`) demande une connexion et propose « Retour au Registre » à un visiteur qui n’a pas de Registre. | Observé | Proposer « Ouvrir le Registre démo » et « Retour à l’accueil ». |

## B. Fluidité et performance

| # | Constat | Preuve | Recommandation |
|---|---|---|---|
| B1 | Page Accueil du Cartulaire démo : 3,7 Mo transférés en 54 requêtes, dont les 14 vues 360° (≈170 ko chacune) et la photo « full set » (446 ko), alors que ces médias ne servent que sur la page Médias. | Mesuré | Charger les médias par page et la séquence 360° à l’ouverture du bloc ; produire des dérivés WebP/AVIF redimensionnés pour les démos comme il en existe pour IWC. |
| B2 | Ouverture du Registre démo : environ 6 à 8 s et rechargement complet, avec une quarantaine de morceaux JavaScript, dont une trentaine d’icônes livrées chacune dans son propre fichier. | Mesuré | Regrouper les icônes dans le bundle du Registre ; précharger `RegistryApp` depuis la page de connexion. |
| B3 | Le catalogue du Registre affiche des cartes sans vignette (icône générique) alors que la Galerie charge les photos des mêmes objets. | Observé | Réutiliser dans le catalogue la vignette résolue par la Galerie. |
| B4 | Le passage accueil → démo → Registre se fait par rechargements complets avec écran vide entre deux (pas de routeur client). À l’intérieur du Registre, la navigation est sans rechargement. | Observé | Acceptable à court terme ; à terme, un routeur unique pour toutes les surfaces. |
| B5 | Accueil public : 107 ko, 20 requêtes, contenu prêt en 309 ms, aucun décalage de mise en page. Les deux polices sont servies par Google Fonts. | Mesuré | Bon niveau. Héberger les polices avec le site pour supprimer la dépendance externe. |
| B6 | Avertissements console « Deprecated API for given entry type » à chaque page. **Requalifié le 8 septembre 2026 : non imputable au site** (voir la note sous ce tableau). | Observé | Aucune correction dans `src/`. Pour les prochaines mesures de laboratoire, utiliser la sonde `scripts/lib/web-vitals-probe.mjs` (un `observe({ type, buffered: true })` par type, protégé par `supportedEntryTypes`), dans un onglet neuf par page ; garde-fou `tests/performance-api-hygiene.test.mjs`. |

Note sur B6 (requalification du 8 septembre 2026). Ni `src/`, ni le bundle déployé (`index-2M4rMv2X.js` et ses 53 morceaux atteignables) ne contiennent de `PerformanceObserver`, d’`entryTypes` ni de `supportedEntryTypes` ; les deux seuls appels bundlés à `performance.getEntriesByType` (`resource` par react-dom, `navigation` par @firebase/webchannel-wrapper) portent sur des types de chronologie qui n’avertissent jamais. Chromium émet « Deprecated API for given entry type. » depuis `performance.getEntriesByType(type)` lorsque `type` est connu mais hors chronologie (`largest-contentful-paint`, `layout-shift`, `longtask`, `event`…), une ligne par appel, et non depuis `PerformanceObserver.observe({ entryTypes })`. Les deux lignes relevées par page correspondent aux deux appels du script de mesure de B5 (LCP et décalage de mise en page), dont le journal a persisté dans l’onglet réutilisé. Vérification en onglet neuf sur `/` et `/account/sign-in` (Chrome 148, reCAPTCHA Enterprise chargé par App Check) : aucun message console.

## C. Fonctionnalités de la démonstration

| # | Constat | Preuve | Recommandation |
|---|---|---|---|
| C1 | Suivi (« 0 rappel ») et Accès (« 0 accès ») du Registre démo sont vides : ces deux fonctions ne se démontrent pas. | Observé | Seeder quelques rappels et une invitation fictive dans le compte démo. |
| C2 | La vue d’ensemble démo affiche « À revoir 5 · Import à vérifier » et chaque carte du catalogue « Import à vérifier » : des signaux d’alerte sur des données fictives présentées comme un Registre prêt à l’emploi. | Observé | Seeder les Cartulaires démo en statut revu, ou masquer ces indicateurs en démo. |
| C3 | La page Publication de la démo répète quatre fois la même liste de 26 contenus (mini-site, Collection, Cercle, PDF) et affiche « Collections indisponibles. Vérifiez votre connexion au Registre. » alors qu’aucune action n’est possible. | Observé | En lecture seule, présenter un résumé de ce qui serait publié ; ne pas afficher d’erreur de connexion. |
| C4 | Sur la même page, les blocs « Propriétaire », « Transmission » et « Stockage » sont proposés à la publication du mini-site, ce qui contredit la promesse d’accueil « ne transmet jamais vos données personnelles ». | Observé | Retirer les blocs personnels des cibles publiables, ou les nommer sans ambiguïté (codes pseudonymisés). |
| C5 | La comparaison n’est accessible que depuis le catalogue ; elle n’apparaît pas dans la barre latérale du Registre. | Observé | L’ajouter à la navigation ou la signaler dans le catalogue. |

## D. Expérience utilisateur et présentation

| # | Constat | Preuve | Recommandation |
|---|---|---|---|
| D1 | Le Cartulaire en lecture seule ressemble à un formulaire : listes déroulantes désactivées (type de bien, statut, collection), icône crayon grisée, boutons « Ajouter une période », « Ajouter un lieu », « Ajouter une personne », « Ajouter une évaluation », « Ajouter une dépense », « Ajouter une ligne d’analyse », et le tableau des documents rendu en listes déroulantes. Le visiteur ne sait pas s’il peut agir et la lecture est parasitée. | Observé | Un rendu « lecture » en texte pur, sans contrôle, pour la démo et pour tout lecteur non éditeur. |
| D2 | Messages techniques hors contexte pour un visiteur : « Synchronisation momentanément indisponible. » sur l’Accueil démo ; dans le panneau Preuves, « Private cloud copy : Sign-in required… Sign in to the Registry ». | Observé | Ne pas afficher l’état de synchronisation en démo ; adapter le panneau Preuves au mode lecture seule. |
| D3 | Sur téléphone, la barre d’onglets du Cartulaire ne défile pas : « 04 Valorisation », « 05 Publication » et « Preuves » sont hors écran (à droite de 390 px) et ne sont atteignables que par « Page suivante ». | Mesuré | Barre d’onglets défilante avec indice de débordement, ou menu de pages sur mobile. |
| D4 | Sur téléphone, la page Valorisation déborde horizontalement (419 px pour 390) : en-têtes des tableaux de dépenses et de sensibilité. | Mesuré | Envelopper ces tableaux dans un conteneur à défilement horizontal. |
| D5 | Sur téléphone, le Registre montre une barre de huit icônes sans libellé, la dernière rejetée seule sur une deuxième ligne ; « Site d’accueil » est présent deux fois ; l’en-tête occupe environ 700 px avant le contenu. | Observé | Libellés courts sous les icônes, un seul lien d’accueil, en-tête compacté. |
| D6 | Sur téléphone, l’accueil laisse environ 480 px de bandeau avant le titre ; les onglets de la maquette de démonstration dépassent la largeur de l’écran. | Mesuré | Réduire les marges du bandeau ; rendre les onglets de la maquette défilants. |
| D7 | Cibles tactiles : 21 liens ou boutons de moins de 32 px de haut sur l’accueil bureau (navigation à 21 px, liens secondaires à 24 px), 20 sur mobile. | Mesuré | Hauteur minimale de 44 px pour les liens de navigation et d’action. |
| D8 | Structure de titres du Cartulaire : trois `h1` (deux « RolexSubmariner » sans espace, un « Submariner »). Un lecteur d’écran lit « RolexSubmariner ». | Mesuré | Un seul `h1` par page, marque et modèle séparés par un espace. |
| D9 | Bascule EN : onglets et libellés traduits, mais la bannière « Démonstration en lecture seule », « CARTULAIRE » et les intitulés de sections restent en français ; l’accueil public n’a pas de bascule. | Observé | Compléter la traduction ou masquer la bascule tant qu’elle est partielle. |
| D10 | « Publiez un mini -site » : espace parasite avant le trait d’union, visible dans le titre de la page Publication et dans le contrat de présentation. | Observé | Corriger « mini-site ». |

## E. Points conformes relevés

- Accueil : un seul `h1`, hiérarchie de titres cohérente, `lang="fr"`, description de page, FAQ en éléments `details` accessibles, champs de formulaire tous étiquetés, aucun bouton sans nom, styles de focus visibles.
- Page 404 claire avec retour à l’accueil.
- Page de connexion : champs avec `autocomplete` correct, bouton désactivé tant que le formulaire est vide, chemin démo clairement séparé.
- Galerie : chargement paresseux des photos, aucune image cassée.
- Preuves du Registre : cinq chaînes vérifiées, explication de ce que la preuve établit et n’établit pas.
- Déconnexion immédiate, retour à l’écran d’accès.

## F. Non testé

Création d’un Cartulaire, téléversement, publication réelle, rapport PDF, Coffre personnel, invitations, cession, navigation clavier complète, lecteur d’écran, autres navigateurs, réseau lent.

## G. Ordre de traitement proposé

1. A1, A2 : déploiement des pages de service et réparation d’App Check (risque fonctionnel réel).
2. A3, A4, A5, C1, C2 : rendre la démonstration cohérente avec ce que l’accueil promet.
3. D3, D4, D5 : mobile.
4. B1, B2, B3 : poids et vignettes.
5. D1, D2, C3, C4 : mode lecture du Cartulaire et page Publication.
6. D7 à D10, B5, B6 : finitions.
