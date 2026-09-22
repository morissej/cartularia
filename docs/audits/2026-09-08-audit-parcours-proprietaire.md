# Cartularia — Audit du parcours propriétaire (compte réel, production)

Date : 8 septembre 2026 · Site : [https://studio-2614005370-a3e51.web.app/](https://studio-2614005370-a3e51.web.app/) (production, bundle `index-2M4rMv2X.js`) · Complète l’audit visiteur du même jour (`2026-09-08-audit-navigateur-ux.md`).

Statut de chaque constat au 16 septembre 2026 (avant V7) et recette V7 : § H, en fin de document (les tableaux A-E restent le relevé daté du 8 septembre).

## Périmètre et méthode

Session ouverte par Jérôme dans Chrome sur le compte « Propriétaire pilote » (Registre privé pilote, organisation « Collection pilote Cartularia »), puis pilotée par Claude in Chrome à 1728 × 906. Aucun identifiant saisi par l’auditeur. Le Coffre personnel n’a pas été ouvert (mot de passe distinct) et n’est donc pas couvert.

Parcours exercé : création d’un Cartulaire fictif avec quatre fichiers générés pour l’audit (trois images PNG, un PDF), lecture des six pages en mode propriétaire, ajout d’une tâche, ajout d’une spécification, activation du mini-site, horodatage du carnet local, panneau Preuves, puis côté Registre : catalogue, galerie, suivi, comparaison, preuves, accès (formulaire ouvert sans envoi), collections, vue d’ensemble, administration, mini-site de Collection public, mini-site d’objet en anonyme.

Non exercé, volontairement : envoi d’une invitation (message à un tiers), publication dans le Cercle, téléchargement du rapport PDF, suppression de données, Coffre personnel.

**Objet de test laissé en place, à supprimer ou archiver par Jérôme :** Cartulaire « Audit Cartularia · Parcours propriétaire 2026-09-08 », code `AUD-A3DA4019`, identifiant `cart_audit_cartularia_parcours_proprietaire_2026__d2adb72533ad`, avec une tâche « Audit : tâche de test à supprimer », une ligne de spécification vide et un reçu d’horodatage. Le mini-site a été désactivé en fin d’audit.

Niveaux de preuve : **Observé** · **Mesuré** · **Amélioration UX**.

## Appréciation générale

Le cœur du produit tient : création en une quarantaine de secondes sans erreur, données reprises fidèlement sur les six pages, tâche visible dans le Suivi, chaîne de preuves vérifiée dès la création, horodatage externe obtenu en dix secondes, comparaison fonctionnelle. Les deux défauts majeurs sont la publication du mini-site, qui n’existe qu’en aperçu local alors que l’interface annonce « Publication active », et la Galerie du Registre, qui télécharge des dizaines d’originaux privés sans jamais afficher d’aperçu.

## A. Bloquant ou majeur

| # | Constat | Preuve | Recommandation |
|---|---|---|---|
| A1 | **Le mini-site n’est pas publié.** Cocher « Publication du mini-site de l’objet » affiche aussitôt « Publication active » et une « adresse dédiée (aperçu local) » qui contient `preview=local`. Aucun appel serveur n’est émis. L’adresse publique `watch-website?publicCode=AUD-A3DA4019` répond « Aucun contenu publié » ; celle de l’IWC, pourtant liée depuis le mini-site de Collection public, répond « Aucun contenu validé » à un visiteur anonyme. Le QR code du panneau Preuves pointe vers cette adresse vide. | Observé, réseau | Déployer la version du dossier de travail (panneau de publication serveur, fonctions `publishCartularyWebsite`) ; ne jamais afficher « Publication active » sans confirmation serveur ; distinguer visuellement aperçu et publication. |
| A2 | **Aperçu du propriétaire trompeur.** Connecté, l’adresse publique de l’IWC affiche « Aperçu local du mini-site » avec des blocs Propriétaire, Provenance privée et Transmission. Le propriétaire croit voir ce que verra le public. | Observé | Rendre l’aperçu strictement identique à la projection publique, blocs personnels exclus. |
| A3 | **Galerie du Registre inutilisable pour les objets privés.** Au chargement, la page télécharge les originaux privés depuis Firebase Storage (56 requêtes en moins de dix secondes, dont 32 photos plein format de l’IWC), et les trois aperçus restent vides (« Original privé lu depuis Firebase Storage », images jamais complètes). | Mesuré | Servir des dérivés de présentation générés côté serveur (`generate-presentation-derivatives`) et ne charger qu’une vignette par Cartulaire. |
| A4 | Le catalogue du Registre n’a aucune vignette, même pour l’objet qui vient d’être créé avec une photo de couverture. | Observé | Reprendre la vignette de présentation dans la projection Registre. |

## B. Fluidité et performance

| # | Constat | Preuve | Recommandation |
|---|---|---|---|
| B1 | Création : 45 Ko de fichiers téléversés en 13 s (vérification serveur par fichier), puis « Création autoritaire et raccordement au Registre… » jusqu’à environ 40 s au total, sans message intermédiaire pendant la phase serveur. | Mesuré | Afficher les étapes serveur (vérification, création, projection) et une estimation ; paralléliser la vérification des fichiers. |
| B2 | Ouverture du Cartulaire IWC (32 photos) : 104 requêtes, rendu prêt en 200 ms grâce aux médias du bundle Hosting. Le nouvel objet charge ses originaux privés en `blob:` depuis Storage, sans dérivé. | Mesuré | Bon pour l’IWC ; généraliser les dérivés à tout objet. |
| B3 | Horodatage RFC 3161 du carnet local : « Horodatage externe vérifié et conservé » en 10 s. | Mesuré | Bon niveau ; afficher un état d’attente pendant les dix secondes. |
| B4 | Console : « État persistant réparé pour cartularia-specification-groups (invalid-shape) » répété six fois à chaque ouverture, y compris pour l’IWC. Les valeurs survivent à la réparation. | Observé | Aligner la forme écrite à la création et par le seed sur celle attendue par le lecteur. |

## C. Fonctionnalités

| # | Constat | Preuve | Recommandation |
|---|---|---|---|
| C1 | Données de création fidèlement reprises : identité, année, calibre, description, état, prix d’achat, fourchette de valeur, comparaison, prix de revient, valeur nette après frais (10 % par défaut). | Observé | — |
| C2 | Tâche ajoutée depuis le Cartulaire visible dans le Suivi du Registre avec sa catégorie et son échéance ; badge de compteur mis à jour. | Observé | — |
| C3 | Chaîne de preuves vérifiée pour les trois Cartulaires (25 événements), aucun ancrage public. | Observé | — |
| C4 | Ajouter une spécification crée une ligne « Nouvelle donnée » vide, sans action de suppression trouvée ; la ligne vide reste enregistrée. | Observé | Ne créer la ligne qu’à la validation d’un libellé ; offrir la suppression. |
| C5 | Le Registre affiche « À revoir 3 · Import à vérifier » et « État du dossier : à vérifier » pour tout Cartulaire, y compris celui que le propriétaire vient de documenter, sans action possible pour lever ce statut. | Observé | Proposer une action « marquer comme revu » ou expliquer ce qui lève le statut. |
| C6 | Le mini-site de Collection « Pilots » est réellement publié et expose IWC et Rolex, avec des liens « Voir le mini-site » qui aboutissent à des pages vides (A1). | Observé | Ne lier un objet depuis une Collection publique que si son mini-site est publié. |
| C7 | Invitation : formulaire clair (destinataire, portée, élément, expiration, lien sans mot de passe). Non envoyée. | Observé | — |
| C8 | Coffre personnel : écran de connexion dédié, même identifiant, mot de passe distinct. Non testé. | Observé | — |

## D. Expérience utilisateur

| # | Constat | Preuve | Recommandation |
|---|---|---|---|
| D1 | Le panneau Preuves expose côte à côte « Synchroniser maintenant », « Supprimer mes données », « Proposer la cession », « Horodater le carnet local » et un bouton « ⚡ Simulation technique » sans explication. | Observé | Retirer la simulation technique de l’interface de production ; isoler la suppression des données derrière une section dédiée. |
| D2 | Le tableau « À faire » s’ouvre dans une fenêtre étroite où le titre d’une tâche s’affiche sur quatre lignes à côté de trois boutons. | Observé | Élargir le panneau ou passer en pleine hauteur. |
| D3 | Sur la page Médias du propriétaire, les sections vidéo et 360° affichent « Accès restreint » alors que l’objet n’en a simplement pas. | Observé | « Aucune vidéo ajoutée » et un bouton d’ajout. |
| D4 | Page Publication : 108 cases à cocher sur une page, quatre listes identiques ; les cases n’ont pas de nom accessible (« on »). | Mesuré | Une liste unique avec destinations en colonnes ; libellés accessibles. |
| D5 | Identifiant généré `cart_audit_cartularia_parcours_proprietaire_2026__d2adb72533ad` : troncature du slug à 44 caractères qui laisse un double soulignement. | Observé | Tronquer sur une frontière de mot. |
| D6 | Fiche de spécifications rendue en champs de saisie permanents : les valeurs n’apparaissent pas dans le texte de la page ni pour un lecteur d’écran en mode lecture. | Mesuré | Rendu texte par défaut, édition à la demande. |
| D7 | Formulaire de création : champs correctement étiquetés, bouton désactivé tant que la photo de couverture manque, récapitulatif des fichiers. Bon niveau. | Observé | — |

## E. Ordre de traitement proposé

1. A1, A2, C6 : publication réelle du mini-site et aperçu fidèle.
2. A3, A4 : dérivés de présentation pour la Galerie et le Catalogue.
3. B1, D1 : progression de la création et nettoyage du panneau Preuves.
4. C4, C5, D2, D3, D4, D6 : finitions du Cartulaire propriétaire.
5. B4, D5 : hygiène technique.

## H. Statut des constats (recette V7)

Mis à jour le 16 septembre 2026 — état au 16 septembre 2026 (avant V7, colonne 2) ; les deux colonnes de recette seront remplies après le déploiement V7 (R1 : assistant, visiteur anonyme, pour les quelques constats vérifiables sans compte ; R2 : Jérôme, propriétaire dans Chrome et téléphone réel — session verrouillée à 15 min onglet masqué / 30 min d'inactivité, travailler par blocs courts ; un objet de test neuf est nécessaire, `AUD-A3DA4019` ayant été purgé, à purger ensuite par `npm run purge:test-cartulary`), commit C6.
Sources : `docs/audits/2026-09-16-execution-v7.md`, journaux V0-V6, scratchpad `v7/statut-49-constats.md` (preuves détaillées, `fichier:ligne`).
Bilan avant V7 (23 constats) : 15 clos (dont B1 et C5 avec recette propriétaire encore due), 1 clos partiellement (B2), 5 à recetter sans action (B3 non traité — état d'attente déjà présent — ; C1, C2, C3, D7 conformes à rejouer en non-régression après V5), 2 hors périmètre déclaré (C7 envoi réel, C8 Coffre).

| # | Statut au 16 sept. (avant V7) | Vague · preuve (journal, test) | Recette V7 : visiteur (assistant, à remplir) | Recette V7 : propriétaire / téléphone (Jérôme, à remplir) | Suite |
|---|---|---|---|---|---|
| A1 | clos (recette propriétaire due) | V1 (fonctions) puis V4 (états) · cinq fonctions créées (journal V1 § 6), publication puis retrait de `AUD-A3DA4019` vérifiés en anonyme ; QR sous `publishedWebsiteUrl` seulement ; `website-publication-panel`, `website-request-session`, `published-website-qr` ; V4 § 6 : recette § 7 non faite (session verrouillée) | — | à recetter (objet de test neuf, V4 § 7 étapes 3, 5, 7) : « Publier » → « demandée · en cours » → « Mini-site publié », QR et adresse ; anonyme = aperçu ; « Retirer » → « Publication absente ou révoquée » ; rechargement pendant la demande → « demandée · non confirmée » + Revérifier | objet de test à purger ensuite |
| A2 | clos | V4 · `websiteDraft.ts` (`filterRequestedWebsiteBlocks`), `ProjectedPublicBlock` par variantes V3, jamais l'original ; contrat l. 471, `website-preview-media.test.tsx` ; production V4 § 6 | à recetter (partiel) : mini-site démo en `presentation-v3-*` seuls, aucun « Afficher l'original » | à recetter : aperçu local sans bloc personnel, aucun « Télécharger », `blocks=` forgé ignoré | — |
| A3 | clos | V3 · K5 `registryGallery.ts` (aucune lecture d'assets ni Storage au chargement) ; V3 § 13.2 (Galerie pilote 0 `firebasestorage`) ; contrat K5, `registry-gallery.test.mjs` | — | à recetter : Galerie privée 0 `firebasestorage` au chargement ; carte → `presentation-v3-768/1200`, 0 `%2Foriginal` ; membre non propriétaire → « Photos privées non accessibles avec ce compte » | — |
| A4 | clos | V3 · miroir posé à la création (`create-cartulary-command.mjs`), `thumbnail` écrit par `live-sync-command.mjs` ; fonctions P2 déployées (hash `de9e5daa`) ; recette P8 (objet neuf) non faite | — | à recetter : objet neuf avec couverture → « Vignette en préparation » puis vignette après vérification ; IWC et Rolex avec vignette | — |
| B1 | clos (recette création due) | V5 · pipeline borné à deux fichiers en vol (`cartularyCreation.ts:260,376`), « Créé en N s », étapes, garde `beforeunload` ; `cartulary-creation-pipeline`, `cartulary-creation-wait`, `new-cartulary-progress` | — | à recetter : création avec cinq fichiers, étapes visibles, jamais « 100 % » en phase serveur, « Créé en N s » ; durée comparée aux 40 s ; formulaire utilisable à 390 | — |
| B2 | clos partiellement | V3 · K4 `privateMedia.ts` (variantes par `getBlob`, original sur action explicite) ; V3 § 13.2 (Médias Rolex 0 `firebasestorage` sur l'appareil d'origine) ; second appareil non mesuré (§ 13.3.1) | — | à recetter : second navigateur ou appareil, Médias Rolex → `presentation-v3-*` seuls, 0 `%2Foriginal` avant « Afficher l'original » ; objet neuf : variantes dès la fin de la vérification | — |
| B3 | à recetter (non traité ; état d'attente déjà présent) | aucune vague · `AuditPanel.tsx:521-531` : bouton désactivé et libellé « Horodatage en cours… » pendant l'appel (`a05f29c`, antérieur à l'audit) ; supposé : volet masqué pendant les 10 s | — | à recetter : « Horodater le carnet local » → libellé pendant l'attente, puis notice `role="status"` | si l'attente reste invisible : ouvrir un constat (barre ou chronomètre) |
| B4 | clos (résidu : brouillons antérieurs) | V0 · `cartularyCreation.ts:94` (`title` écrit) ; `cartulary-create-wiring.test.mjs` ; V0 § 4 (les six messages venaient de l'objet de test) | — | à recetter : IWC, Rolex, objet neuf → console sans « État persistant réparé » | un brouillon d'avant le 8 septembre peut l'émettre une fois |
| C1 | à recetter (conforme ; non-régression après V5) | aucune action · V5 a réécrit la lecture (`CartularyReadOnlyBlocks`), V0 la forme des spécifications ; contrat, `cartulary-presentation.test.tsx` | — | à recetter : après création, identité, année, calibre, état, prix d'achat, fourchette, prix de revient, valeur nette présents en texte sur les six pages | — |
| C2 | à recetter (conforme ; non-régression) | aucune action · V5 popover ; `follow-up-coordination.test.mjs`, `barre-dossier-read-only-editing` | — | à recetter : tâche ajoutée → Suivi du Registre avec catégorie, échéance, badge ; popover ≤ 480 px sur téléphone | — |
| C3 | à recetter (conforme ; non-régression) | aucune action · chaîne remontée en 1.6.0 (V1 § 10 : IWC révision 8, Rolex révision 16), lot B revue ; `integrity-convergence`, `live-sync-review` ; contrôle visuel « Preuves vérifiée » non refait | — | à recetter : Registre → Preuves « vérifiée » pour IWC et Rolex, Objets = 2 ; après « Marquer comme revu », événement « Revue du propriétaire confirmée » | — |
| C4 | clos | V5 · `4d6f9f6` (libellé non vide et unique, « Retirer », lignes d'identité protégées ; lignes ajoutées conservées au rechargement) ; `specification-groups`, `specification-add-form` | — | à recetter : « Ajouter une donnée » → formulaire, aucune ligne sans libellé ; « Retirer » ; F5 conserve | dette : libellé vidé par renommage en place (relecture V5 H7) |
| C5 | clos (clic « Marquer comme revu » à recetter) | V5 · `cartulary-review-policy.mjs`, lot B serveur (`f60e602`) + client (`d64df64`) ; production V5 § 7 (« Déclaré, non revu » visible) ; `live-sync-review`, `cartulary-review-status`, `registry-catalog`, `registry-aggregates` | — | à recetter : « Marquer comme revu » → « Confirmation en cours… » puis « Revu par le propriétaire le … · Partiel », badge disparu, « À revoir » décrémenté après synchro, événement aux Preuves ; carte « À revoir » navigable | — |
| C6 | clos | V1 (fonctions) + V4 · `websiteHasPublishedContent` (`CollectionWebsitePage.tsx:14,65,255`), adresse forgée `preview=local` inerte ; production V4 § 6 ; `collection-website-links.test.tsx` | à recetter : `/collection-website?publicationId=reg_collection_privee--col_pilots` → aucun lien vers une page vide | à recetter : Collection de test avec un objet publié → « Voir le mini-site » | — |
| C7 | hors périmètre déclaré (envoi réel) | V4 D8 · aucune extension mail (`firebase ext:list`), `mail/{id}` sans consommateur ; `invitation-community-corrections.test.tsx` | — | à recetter : formulaire ouvert, champs étiquetés, pas d'envoi | décision produit : extension de courriel ou retrait de la promesse |
| C8 | hors périmètre déclaré | plan § 4 · aucun journal V0-V7 n'exerce le Coffre ; `PersonalVaultApp-*.js` embarque reCAPTCHA | — | — | audit propriétaire du Coffre à planifier (mot de passe distinct) |
| D1 | clos | V5 · tiroir « Simulation technique » retiré, « Supprimer mes données » isolé en dernière section ; ADR-024 amendé ; production V5 § 7 ; contrat l. 549 | — | à recetter : Preuves → actions courantes, puis section « Suppression des données » séparée | — |
| D2 | clos | V5 · `index.css:265` (`width: min(480px, calc(100vw - 32px))`), lignes à deux rangées ; contrat l. 571 | — | à recetter : titre long sur sa rangée, trois boutons sur la seconde ; popover ≤ largeur − 32 px sur téléphone | résidu : `.todo-action` 36 × 36 px (V-D7) |
| D3 | clos | V5 · `EmptyMediaSlot` (`App.tsx:2478,2490`) « Aucune vidéo ajoutée » / « Aucune séquence 3D ajoutée » + bouton d'ajout ; contrat l. 584, `empty-media-slot.test.tsx` ; production V5 § 7 | à recetter : 0 « Accès restreint » sur la démo | à recetter : Médias d'un objet sans vidéo → « Aucune vidéo ajoutée » + bouton fonctionnel | hors constat : valeur « Emplacement · Accès restreint » dans la fiche (`App.tsx:345`) |
| D4 | clos (recette propriétaire due) | V4 · `PublicationSelectionTable` (une table 23 lignes × 3 destinations, 57 cases nommées, `role="region"`, label 44 px) ; `publication-selection-table.test.tsx` ; production V4 § 6 en lecture seulement | — | à recetter : 57 cases, noms accessibles, pieds n/14, n/20, n/23 ; à 375 px : table défilante, pas de défilement de page | — |
| D5 | clos | V0 · `slugifyCartularyLabel` (`cartularyCreation.ts:22`) coupe sur une frontière de mot ; même règle pour les Collections ; `new-cartulary-validation.test.mjs` | — | à recetter : objet à libellé long → identifiant sans `__` ni `_` final | — |
| D6 | clos | V5 · fiche en `dt/dd`, champs sous le crayon seulement ; V5 § 7 (démo 6 `dl` / 38 `dt`) ; contrat l. 617, `cartulary-read-only-blocks.test.tsx` | à recetter : fiche en texte sans crayon | à recetter : crayon → champs, « Terminer » ; lecteur d'écran lit les valeurs | — |
| D7 | à recetter (conforme ; non-régression après V5) | aucune action · `248d96f` a modifié `NewCartularyPage` (étapes, `beforeunload`) ; `new-cartulary-progress.test.tsx`, `new-cartulary-validation.test.mjs` | — | à recetter : bouton désactivé sans couverture, récapitulatif des fichiers, champs étiquetés ; formulaire à 390 | — |
