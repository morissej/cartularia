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

## 4. Relecture adversariale des cinq commits (e035257 → 68ae757)

Quatre angles (honnêteté, régression, accessibilité, sécurité-données), chaque constat rejoué et voté deux fois sur copie. Un correcteur unique applique les constats confirmés (« mineur » courts et sûrs ; les deux constats d'abord classés « important », H1 et C2, ont été ramenés à « mineur » par les deux votes et renvoyés à la dette V6 `rightsResolved`, décision 1-D3 « hook intact »). Chaque correctif est accompagné d'un test rouge sans lui (25 mutants tués, copie `v5/review/fix-verify`).

| Point | Défaut | Correctif | Preuve |
|---|---|---|---|
| H2 | Visionneuse en lecture : sept boutons de catégories `disabled` (motif V-D1) | `CartularyModals.tsx` : fieldset non monté en lecture, catégories actives en ligne de texte du `<dl>` (ancre `media.assets[].tags`) | `tests/ui/cartulary-modals.test.tsx` (M5 réécrit : 0 `button[disabled]`, texte présent ; cas site public sans catégorie) ; contrat |
| H5 | Édition d'une tâche du popover À faire survivant à `readOnly` (verrouillage de session, D5 (a)) | `BarreDossier.tsx` : `useEffect` fermant l'édition sur `readOnly`, garde de rendu `!readOnly &&`, garde dans `saveTodo` | `tests/ui/barre-dossier-read-only-editing.test.tsx` (3 cas) ; contrat |
| R-02 | Ancres IA du rendu texte non figées (M49/M50 survivants) | Aucun (code correct) | `tests/ui/cartulary-read-only-blocks.test.tsx` : liste exacte des ancres des neuf blocs |
| R-04 | Garde `retrying` et annulation du délai global non prouvées (M19/M21) | Aucun | `tests/ui/cartulary-creation-wait.test.ts` : 0 minuterie après `processed`, une seule transaction après 3 s |
| R-07 | Export du carnet rompu désactivé par la seule révision 0 (M39) | Aucun | `tests/ui/audit-panel-demo-read-only.test.tsx` : carnet rompu à révision 3 |
| R-08 | `input.value = ''` non testé (assertion vacuiste sous jsdom, M30) | Aucun | `tests/ui/empty-media-slot.test.tsx` : espion du setter `value` posé avant le rendu |
| R-09 | Case des points à contrôler en lecture décalée de 10 px et glyphe à 10 px (`article > span`) | `index.css` : `.identification-list article > span:not(.control-check)` | contrat (règle figée) |
| R-11 | ADR-024 et vague corrective 4 décrivant encore le tiroir « Simulation technique » | Amendement daté dans ADR-024 (§ dédié, vocabulaire, option rejetée) ; note datée dans la vague 4 | `tests/integrity-convergence.test.mjs` |
| A1 | Nom accessible « Supprimer X » sous un libellé visible « Retirer » (WCAG 2.5.3) | `App.tsx` : `aria-label` « Retirer X / Remove X », titres alignés | `tests/specification-groups.test.mjs` test 13 (ancre, absence de « Supprimer ${item.label} ») |
| A2 | Focus sur `<body>` à la fermeture du formulaire d'ajout (WCAG 2.4.3) | `SpecificationAddForm` : `close()` rend le focus au bouton `.specification-add` de l'hôte (rAF) | `tests/ui/specification-add-form.test.tsx` : Échap et « Terminer » au clavier → focus sur « Ajouter une donnée » |
| A3 | `EditableFact` activable sans nom si la valeur est vide, sans indication d'action | `aria-label={value ? undefined : label}`, `title` « Cliquer pour modifier » bilingue, `language` passé par `App.tsx` | `tests/ui/cartulary-presentation.test.tsx` ; contrat |
| A4 | Registre de documentation en lecture sans en-têtes de colonnes | `DocumentationRegisterReadOnly` : `role="table"`, rangée d'en-tête `.sr-only` (columnheader), `row`/`cell` | `tests/ui/cartulary-read-only-blocks.test.tsx` ; contrat |
| A6 | Sous 768 px, `display: none` retirait les `columnheader` de la synthèse d'analyse | `index.css` : en-tête masqué visuellement (clip) au lieu de `display: none` | contrat (règle mobile figée) |
| A9 | Six mutants d'accessibilité survivants (MA2, MA3, MA4, MA8, MA12, MA15) | Aucun | verrous : chronomètre hors `aria-live` (`> small`), 3 `columnheader`, `EditableParagraphs` sans rôle bouton hors droit, règles mobile au contrat, cas EN du crayon |
| C5 | `hasGenericCartularyPermission`, pivot de `canEdit`, sans test (mutant « titulaire » survivant) | Aucun | `tests/ui/generic-cartulary-permission.test.ts` : table de vérité (11 cas) |
| C7 | Garde de `deleteSpecification` et `disabled` du bouton non figés | Aucun | `tests/specification-groups.test.mjs` test 13 : deux ancres |

Écartés (à consigner en dette) : H1 et C2 (droit indéterminé ≠ refusé, relance après retour du réseau : dette V6 `rightsResolved`, hook intact par 1-D3 ; le bandeau ne porte aucun bouton par contrat) ; H6 (barre à 100 % pendant la vérification des deux derniers fichiers : conforme au brief création § 2, « jamais 100 % » scopé à la phase serveur) ; H7 (libellé vidé ou doublon par renommage en place : dette V6 déclarée, `coherence.md` § 7) ; H8 (explication « À revoir » sur les cartes du catalogue : lot A retenu par D1, note unique par page ; ergonomie à revoir avec le lot B) ; A8 (région vivante insérée déjà remplie : motif commun à toute l'application, harmonisation V6).
