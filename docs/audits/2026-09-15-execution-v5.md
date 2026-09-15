# Exécution V5 — « Cartulaire propriétaire » (15 septembre 2026)

Plan : `docs/audits/2026-09-08-plan-actions-par-vagues.md` § V5 (V-D1, P-B1, P-C4, P-C5, P-D1, P-D2, P-D3, P-D6 ; P-D5 corrigé en V0). Branche `feat/lecteur-unique-adr-028-031`, ouverture à `f78220e` (V4 déployée). Analyse du 15 septembre : sept lectures, deux propositions par point, un juge par point, une critique de cohérence (scratchpad `v5/` : `lecture-*.md`, `proposition-*.md`, `brief-*.md`, `coherence.md`).

## 1. Constat et périmètre retenu

Vérifié par les lecteurs (`fichier:ligne` dans `v5/lecture-*.md`) :
- Point 1 (V-D1, P-D6) : le mode édition des pages 00-04 est décidé par `canEdit = !isDemoCartulary` (`App.tsx:682`), pas par le droit serveur `authoritative.canManage` (qui ne pilote que la page 05, les sections génériques et « Afficher l'original »). Un membre non gérant connecté reçoit l'éditeur complet sur une copie fantôme de son propre coffre ; la démo reçoit un rendu mixte (deux `fieldset disabled` sur ≈ 100 contrôles, 3 `select disabled`, crayons grisés, zones `role="button"` inertes, fiche de spécifications en 120 contrôles permanents). `showCompleteContent` est une tautologie ; `AccessRestricted` est inatteignable.
- Point 2 (P-B1) : la vérification des fichiers est séquentielle côté client (`cartularyCreation.ts:238-245`) alors que `verifyPrivateDraftUpload` accepte deux originaux à la fois (`maxInstances: 2`) ; la phase serveur est observable sans nouvelle fonction (`cartularyCreateRequests/{id}` : `requestedAt`, `processingStartedAt`, `processedAt`) mais le client la sonde par `getDoc` toutes les 1,5 s sans rien afficher.
- Point 3 (P-C4) : `addSpecification` crée et persiste une ligne « Nouvelle donnée » vide ; la suppression existe déjà (corbeille) contrairement au constat ; défaut plus grave vérifié : les lignes ajoutées sont perdues au rechargement (rechargement des groupes depuis le catalogue, depuis `302b1b0` pour IWC).
- Point 4 (P-C5) : `lifecycleStatus 'review'` et `completenessLevel 'imported_unreviewed'` sont posés à la création, recopiés par projection et synchro, et jamais levés par personne (aucun écrivain hors création et seed démo) ; trois interprétations divergentes dans le Registre.
- Points 5-6 (P-D1, P-D2, P-D3) : tiroir « ⚡ Simulation technique » (falsification, fixture) en production ; « Supprimer mes données » parmi les actions courantes ; popover « À faire » à largeur contrainte ; « Accès restreint » affiché quand l'objet n'a simplement pas de vidéo ou de séquence 3D.

Aucune fonction, règle, index ni migration pour les points 1, 2, 3, 4A, 5, 6 ; un seul changement serveur facultatif : le lot B du point 4 (`syncCartularyToRegistry`).

## 2. Décisions

Réglées par défaut (consignées dans `v5/coherence.md` § 4.2) : édition à la demande par crayon de bloc (`editingBlock`), structures communes en lecture dès le point 1, bandeau d'accès sur `signed-out` / `denied`, « Valeur retenue » toujours affichée, lot C « aucune écriture en lecture » différé (V6), lignes de spécifications protégées `brand, model, reference, year, caliber`, libellé enregistré faisant foi, unicité du libellé par groupe, suppression « Retirer » explicite, tiroir « Simulation technique » supprimé (méthodes conservées), « Migrer la chaîne rompue » rendu seulement si la chaîne est rompue, bouton d'ajout Médias = sélecteur direct avec tag imposé, popover À faire 480 px en CSS seul, `AccessRestricted` retiré.

| # | Décision | Retenu |
|---|---|---|
| D1 | Lot B du point 4 (« Marquer comme revu », une fonction : `syncCartularyToRegistry`) | (b) dans V5, en dernier (I6) : commit serveur → suites émulateur → déploiement filtré par Jérôme → contrôle du hash → commits client → Hosting. Sans déploiement, le lot A (explication) suffit à C5 mais « À revoir » reste > 0 indéfiniment. |
| D2 | Palier posé par la revue | (b) « Revue partielle » (`partial`, défaut) ou « Dossier complet » (`complete`) |
| D3 | Débit de vérification des fichiers | (a) borne client 2 = `maxInstances` actuel, aucune fonction ; (b) réévalué après mesure |
| D4 | Reprise de la création après rechargement | (a) reportée (garde `beforeunload`, message renvoyant au Catalogue) |
| D5 | Propriétaire hors session ou hors ligne | (a) lecture seule avec bandeau « Lecture seule · connectez-vous… », crayons de retour à la connexion sans rechargement — généralisation de V2 (b) à tout le lecteur ; **à confirmer par Jérôme** (change son usage quotidien quand la session Chrome se verrouille) |
| D6 | Déploiements Hosting | (a) un seul après I4, puis un second après le lot B |

## 3. Ordre d'intégration

Socle parallèle (fichiers distincts, jamais `App.tsx`, contrat, `package.json`) : S1 création, S2 statut lot A, S3 spécifications (domaine, formulaire), S4 médias (emplacements vides, import), S5 À faire (CSS), S6 Preuves (`AuditPanel`). Intégration séquentielle par un responsable unique : I1 points 5-6 (+ `test:v5`), I2 spécifications, I3 lecture 1/2 (`canEdit = authoritative.canManage`, texte pur, crayons, fiche), I4 lecture 2/2 (structures communes, bandeau d'accès), I5 journal, I6 lot B (conditionnel).
