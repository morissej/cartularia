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

## 4. Implémentation (15 septembre) — six commits, aucun serveur

| Commit | Lot | Contenu | Barrière |
|---|---|---|---|
| `3730f11` | Collection (P-C6) | `websiteHasPublishedContent` (domaine) ; `CollectionWebsitePage` : lien ssi `publications/{code}` publié ET bloc Web admis, « État du mini-site indisponible » par carte sans mettre la page en erreur, adresse publique insensible à `preview=local` / `cartularyId` / `cartularyUrl`, aperçu propriétaire lisant les mêmes statuts (G1) ; `npm run test:v4` (définition C1) | 10 tests vitest neufs, +7 assertions node, 7 mutants tués |
| `8dbb74d` | Aperçu (P-A2 / V-C4) | `websiteDraft.ts` : source privée d'aperçu par `binaryId` sans URL ni chemin, `filterRequestedWebsiteBlocks` (aperçu ⊆ sélection) ; `ProjectedPublicBlock` : images par variantes V3 (`PrivateMediaImage`, rôle explicite), jamais l'original (D1 (a) : ni téléchargement, ni visionneuse, ni lecteur vidéo pour un binaire privé), message « référence de copie publique absente » réservé aux médias sans `binaryId` ni bundle ; `App.tsx` −38 (trois `case` personnels supprimés du renderer, G4) ; D3 (a) : `DEMO_WEBSITE_BLOCK_IDS` partagé client / `demo-publication-command.mjs` (8 blocs) ; contrat +1 test | `website-preview-media` (neuf), `website-draft` +3, démo inchangée |
| `86a51c4` | États (lots A + B) | `PublishedWebsiteQr` monté sous `publishedWebsiteUrl` dans les deux branches des Preuves, note propriétaire sinon ; « Code public du Cartulaire » = code réel (« Non émis » impossible) ; panneau : états priorisés (C5), alerte « Demande conservée… », note d'écart sélection / en ligne, `onStateChanged` → relecture par `loadPublicPublicationStatuses` après chaque action ; lot B : `websiteRequestSession.ts` (demande persistée par onglet, « demandée · non confirmée (le {date} à {heure}) », Revérifier / Reprendre / Abandonner) ; `App.tsx` ±0 ; contrat +20 assertions | 43 tests vitest du lot, 5 mutants App.tsx tués |
| `8112ce3` | Page Publication (P-D4) | `publicationSummaryModel.ts` (modèle partagé éditeur / lecture), `PublicationSelectionTable` (une table « Contenus par destination », 23 lignes, 5 groupes, D4-B trois destinations, cases nommées « {titre} {destination} », « Tout sélectionner — {destination} », note V-C4, note Cercle D6 (a), EN complet) ; `PublicationReadOnlySummary` sur le même modèle (carte 02 : « la Collection renvoie au mini-site de l'objet ») ; `App.tsx` −51 (sélecteur et quatre appels supprimés) ; `index.css` −12 ; contrat : tranche du sélecteur réécrite (18 assertions) | 20 tests vitest neufs, 4 mutants App.tsx tués ; 57 cases (71 avant, 108 dans l'audit) |
| `4420730` | Chemin mort (D5) | Dialogue de décision par bloc inatteignable depuis `755c5b5` (21 août) retiré : `App.tsx` −310, `CartularyPresentation.tsx` −9, `index.css` −73 (47 règles), contrat `logEvent` 6 → 5 ; tranches `decisions` / `source` et `integritySnapshot` inchangées | tsc refuse tout marqueur réintroduit (type) ; 3 mutants tués |
| `cfd544e` | Relecture (§ 5) | 22 fichiers, +489/−60 | 19 tests neufs rouges sur `4420730` |

Totaux : `App.tsx` 3 924 → 3 525 lignes ; vitest 321 → 391 ; node `test:v3` 164 → 165 + bloc V4 46 + démo 15 ; suites émulateur (`test:v3:emulator`, `test:security-wave2`, `test:demo-account:full`) inchangées et vertes ; build `index-CjgftblJ.js`. Aucune fonction, règle ni migration ; `websiteDraftRequest` identique octet pour octet à V3 (test d'équivalence) ; clés de persistance locale et `integritySnapshot` inchangés ; seule nouveauté persistée : `sessionStorage` `cartularia-website-request:<id>` (aucun jeton, aucune donnée sensible).

## 5. Relecture adversariale (15 septembre)

Quatre angles (honnêteté vis-à-vis de l'audit, régression et contrat avec 39 mutants, accessibilité / textes / mobile 375 px, sécurité et données) : 28 constats, 21 confirmés par deux réfutateurs indépendants, 0 bloquant, 5 importants (H1 vidéo promise à tort en aperçu, H4 source du « publié » non verrouillée, A1 débordement horizontal de la page Publication à 375 px, A2 messages bruts du SDK dans l'alerte, A9 lien de titre de Collection cassé en largeur), 16 mineurs. Corrigés dans `cfd544e` (table complète : scratchpad `v4/journal-notes-correction.md`, rapports `v4/review/*.md`). Vérifié sans succès d'attaque : aperçu sans original ni lien de téléchargement dans les quatre blocs média, page publiée rendue uniquement depuis la projection, `sessionStorage` d'un autre objet ou d'une autre révision ignoré, adresse de Collection forgée sans lien d'aperçu, charge utile de publication inchangée, V2 et V3 intacts, noms accessibles des 57 cases uniques, focus visible, défilement interne de la table.

Constats confirmés non traités (dette consignée) : H8 « contenu modifié depuis la mise en ligne » (exige un hash du payload publié côté serveur, lot S) ; H9 relecture sur retrait depuis un autre appareil (lot S) ; F1 volet serveur (`callableError` replie les refus en `internal` : dette fonctions) ; F6 `public-text-policy` laisse passer un chemin `private-derivatives/…` en texte libre (module partagé client / fonctions, V5) ; A4 troisième occurrence (`RegistryComparison.tsx`, V6).

## 6. Production (15 septembre)

| Étape | Résultat |
|---|---|
| Vérifications lecture seule | D3 : `publish-demo-website.mjs --allow-remote` (simulation) → `alreadyPublished true`, 8 blocs identiques à la publication en ligne (`cover-watch`, `media-hero`, `media-library`, `reference-history`, `reference-specs`, `reference-checks`, `condition-description`, `condition-summary`), 0 écriture. D8 : `firebase ext:list` → aucune extension installée : **envoi réel d'invitations non disponible** (le document `mail/{id}` n'a aucun consommateur), consigné, recette D8 sans objet. Collections publiées : `reg_collection_privee--col_pilots` (2 objets, aucun code public) ; publications : `DEMO-ROL-124060` publiée, `AUD-A3DA4019` révoquée (objet purgé en V1 : D7 → objet de test neuf). |
| Référence avant Hosting (anonyme) | `/collection-website?publicationId=reg_collection_privee--col_pilots` : 2 cartes « Mini-site de l'objet non publié », aucun lien (P-C6 déjà effectif dans le bundle V3). |
| Hosting | Commits `3730f11` … `cfd544e` + journal `9fa179a`, poussés ; build sans émulateurs ; `firebase deploy --only hosting` : 550 fichiers, 76 nouveaux, bundle `index-CjgftblJ.js`. |
| Recette anonyme après Hosting | Mini-site démo `DEMO-ROL-124060` : « Mini-site publié · DEMO-ROL-124060 », 4 pages, pied `DEMO-ROL-124060 · S-05BB8C0F`, aucun « Afficher l'original ». Collection Pilots : 2 × « Mini-site de l'objet non publié », 0 lien, 0 « État indisponible », largeur de page sans débordement ; adresse forgée (`preview=local&cartularyId=…&cartularyUrl=…`) : 0 « Aperçu local », 0 « Ouvrir le Cartulaire », 0 lien. Page 05 démo (lecture) : une table « Contenu / Mini-site / Le Cercle / Rapport PDF », 0 case, « Publié : 8 contenus en ligne », carte 02 « la Collection renvoie au mini-site de l'objet », note Cercle, note « Propriétaire, Transmission et Stockage restent privés… », `role="region"` sur le conteneur défilant, lien d'aperçu local aux 8 blocs publiés (D3). Preuves démo : « Code public du Cartulaire DEMO-ROL-124060 », QR « QR code vers le mini-site publié » vers `/watch-website?publicCode=DEMO-ROL-124060`, aucun « Non émis ». |
| Session propriétaire | Chrome de Jérôme reverrouillé entre-temps (bandeau « Se connecter ») : la page 05 du Rolex s'est rendue en lecture seule (« Votre accès ne permet pas de publier cet objet », décision V2 (b) : comportement attendu hors session), table à 23 lignes / 3 destinations conforme. Recette propriétaire (§ 7) à faire par Jérôme. |

## 7. Recette propriétaire (Jérôme, Chrome connecté, écritures via l'interface uniquement)

Objet : un objet de test neuf (D7 (b), `AUD-A3DA4019` purgé en V1) avec au moins une image « Tous » (les variantes V3 sont produites à la vérification) ; ou, pour la seule comparaison aperçu / publié, le pilote Rolex puis retrait immédiat (décision explicite).

1. Page 05 : une table, 57 cases (23 lignes × 3 destinations moins les cellules « Non proposé »), noms « {titre} {destination} » (lecteur d'écran ou inspecteur), pieds « n/14 », « n/20 », « n/23 », « Tout sélectionner — Mini-site ». Mobile 375 px : aucun défilement latéral de page, défilement interne de la table.
2. « Ouvrir l'aperçu local du mini-site » : images par variantes (filtre réseau `firebasestorage` : `presentation-v3-…webp` seulement, aucun `%2Foriginal`), aucun lien « Télécharger », visionneuse sans « Afficher l'original », vidéo : « Cette vidéo n'a pas de copie publique vérifiée… » ; `blocks=` forgé dans l'adresse : ignoré.
3. Preuves avant publication : « Code public du Cartulaire » = code réel, pas de QR, note « Aucun mini-site publié : le QR code de partage apparaît une fois la publication confirmée… ».
4. Collection de test « Recette V4-C6 » publiée avec l'objet non publié : page publique anonyme « Mini-site de l'objet non publié ».
5. « Publier le mini-site » : « Publication demandée · en cours (10 à 30 s)… » puis « Mini-site publié », QR et adresse sans rechargement ; page publique anonyme = aperçu ; Collection de test : « Voir le mini-site ». Rechargement pendant la demande : « demandée · non confirmée (le … à …) » puis Revérifier.
6. Modifier la sélection : note « Sélection différente des contenus en ligne : n en ligne, m sélectionnés ». « Mettre à jour le mini-site ».
7. « Retirer le mini-site » : « Retrait demandé · en cours… » puis « Mini-site retiré », QR disparu, page publique « Publication absente ou révoquée », Collection : « Mini-site de l'objet non publié ».
8. Nettoyage : suppression de la Collection de test ; sort de l'objet de test (purge par script, journal V1 § 9, sur demande).

## 8. Hors périmètre déclaré (repris de `v4/coherence.md` § 6 et de la relecture)

Chantier serveur du Cercle (callables, admission, retrait) ; lot S serveur des états (`pendingRequest` horodaté, hash du payload publié pour « contenu modifié depuis la mise en ligne », relecture multi-appareils) ; `callableError` repliant les refus en `internal` ; `public-text-policy` et les chemins `private-derivatives/…` en texte libre (V5) ; trace locale `ACCESS_CARTULARY` sur la page publique ; projection de Collection figée à l'archivage d'un objet ; `GenericCartularyView` page Publication (ADR-028) ; mobile V-D3/V-D4 et `RegistryComparison` (V6) ; version anglaise de `CollectionWebsitePage` et `RegistryItems` ; vitrine démo de Collection ; l'aperçu démo montre plus de contenu (18 médias, 6 groupes) que le mini-site démo publié (D3 ne porte que sur la sélection de blocs).

V4 est close pour ce qui relève de l'assistant. Restent la recette propriétaire (§ 7) et le nettoyage par Jérôme.
