# Cartularia — Audit du parcours propriétaire (compte réel, production)

Date : 8 septembre 2026 · Site : [https://studio-2614005370-a3e51.web.app/](https://studio-2614005370-a3e51.web.app/) (production, bundle `index-2M4rMv2X.js`) · Complète l’audit visiteur du même jour (`2026-09-08-audit-navigateur-ux.md`).

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
