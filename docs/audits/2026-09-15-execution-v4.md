# Exécution V4 — « Publication honnête » (15 septembre 2026)

Plan : `docs/audits/2026-09-08-plan-actions-par-vagues.md` § V4 (P-A2, V-C4, P-C6, P-D4 ; point 2 « états » livré en partie par V2). Branche `feat/lecteur-unique-adr-028-031`, ouverture à `367b9af` (V3 close). Analyse du 15 septembre : six lectures, deux propositions par point, un juge par point, une critique de cohérence (scratchpad `v4/` : `lecture-*.md`, `proposition-*.md`, `brief-*.md`, `coherence.md`).

## 1. Constat et périmètre retenu

Ce qui est déjà en place à l'ouverture (vérifié par les lecteurs, `fichier:ligne` dans `v4/lecture-*.md`) :
- V-C4 : les blocs Propriétaire, Transmission et Stockage ne sont proposés à aucune destination (`publication.ts:101-105, 225-227`) ; ils subsistent comme définitions inertes et comme `case` morts du renderer.
- P-A2 : sur `/watch-website`, propriétaire et visiteur voient le même rendu (`ProjectedPublicBlock` seul, session et coffre désactivés) ; l'aperçu local est construit par `buildWebsiteDraft` (liste blanche + politique des textes). Écart restant : tout média téléversé y arrive sans adresse (« Une référence de copie publique est absente… »), et trois chemins offrent encore l'original.
- P-C6 : depuis `fe3aa90`, la page publique de Collection ne lie un objet que si `publications/{code}` est publié ; cas résiduels : publication sans bloc Web admis, échec de lecture des statuts qui met toute la page en erreur, adresse forgée `preview=local`, aperçu propriétaire sans statuts.
- États (V2) : « Publication absente ou révoquée » sans Réessayer, lecture seule pour tout non-éditeur, « publié » constaté à l'exécution. Restent : QR propriétaire affiché quel que soit l'état, constat relu seulement au montage, « Non émis » possible sur le code public, aucun état « demandée ».
- P-D4 : 71 cases (pas 108) en quatre listes repliées homonymes ; cases nommées par `<label>` mais sans destination dans le nom ; colonne Collection sans consommateur ; colonne Cercle sans commande serveur.

Aucune fonction à redéployer, aucune règle, aucune migration : V4 est entièrement côté client (Hosting seul).

## 2. Décisions

Réglées par défaut (ne changent ni le produit vu par un tiers ni la production) : `filterRequestedWebsiteBlocks` branché (aperçu ⊆ sélection) ; CSS orphelin nettoyé ; rafraîchissement après action par relecture Firestore ; critère du Registre privé inchangé ; statuts publics lus aussi dans l'aperçu de Collection ; ligne d'écart sélection / en ligne dans le panneau ; pas de bump du contrat `cartulary-presentation`.

| # | Décision | Retenu |
|---|---|---|
| D1 | Original d'un média téléversé dans l'aperçu local | (a) jamais : liens de téléchargement, visionneuse et lecteur retirés pour un binaire privé, phrase d'état ; l'original reste sur la page Médias |
| D2 | Étendue de « publication demandée » | (B) lot A (libellé pendant l'appel, alerte « Demande conservée ») + lot B (demande persistée par onglet en `sessionStorage`, « demandée · non confirmée » après rechargement, Revérifier / Reprendre / Abandonner) ; lot S serveur (`pendingRequest` horodaté, trois fonctions) reporté |
| D3 | Sélection démo du mini-site (14 blocs) vs mini-site démo publié (8) | (a) aligner sur les 8 blocs publiés (constante partagée, aucun rejeu de publication) |
| D4 | Colonne « Collection » de la table de sélection (14 cases sans consommateur) | (B) retirer : trois destinations Mini-site / Le Cercle / Rapport PDF ; la Collection renvoie au mini-site de l'objet |
| D5 | Dialogue de décision par bloc devenu inatteignable (≈ 300 lignes, 42 règles CSS) | oui, commit séparé, dernier, abandonnable |
| D6 | Colonne « Le Cercle » (20 cases) sans commande serveur | (a) conservée avec la note « Publication dans Le Cercle non disponible : aucune commande serveur reliée ; la sélection sert à l'aperçu local » ; chantier serveur du Cercle hors V4 |
| D7 | Objet du cycle de recette | (a) `AUD-A3DA4019` s'il existe encore avec une image « Tous » à variantes V3 ; sinon objet de test neuf ; le pilote Rolex n'est mis en ligne que sur décision explicite |
| D8 | Invitations réelles (plan § 4) | (a) Jérôme lance `firebase ext:list` ; recette avec un compte destinataire de test si une extension d'envoi existe, sinon « envoi réel non disponible » consigné |

## 3. Ordre d'intégration (un commit par lot, barrière verte avant chaque commit)

1. Collection (P-C6) — pose `npm run test:v4`.
2. Aperçu (P-A2 / V-C4) — `websiteDraft.ts`, `MediaCarousel.tsx`, `ProjectedPublicBlock.tsx`, `App.tsx` (−42), démo G4, contrat (+1).
3. États lot A — `PublishedWebsiteQr.tsx`, `AuditPanel.tsx`, `PublicWebsitePublicationPanel.tsx`, `App.tsx` (±0), contrat.
4. Page Publication (P-D4) — `publicationSummaryModel.ts`, `PublicationSelectionTable.tsx`, `PublicationReadOnlySummary.tsx`, `App.tsx` (−45), contrat (tranche du sélecteur réécrite).
5. États lot B — `websiteRequestSession.ts`, panneau ; aucune ligne `App.tsx`.
6. Chemin mort (D5) — `App.tsx` (−300), CSS, contrat.
7. Journal, mémoire, Hosting (une fois), recette unique, nettoyage.

Responsable unique de `App.tsx`, du contrat, de `index.css` et de `package.json` : l'intégrateur de la vague.
