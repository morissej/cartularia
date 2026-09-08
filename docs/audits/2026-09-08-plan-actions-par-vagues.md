# Cartularia — Plan d’action par vagues

Date : 8 septembre 2026. Statut : **proposition, en attente de décision**.

Base : les deux audits du 8 septembre, [parcours visiteur](2026-09-08-audit-navigateur-ux.md) (26 constats, notés V-A1 à V-D10) et [parcours propriétaire](2026-09-08-audit-parcours-proprietaire.md) (23 constats, notés P-A1 à P-D7), plus les travaux d’architecture livrés dans le dossier de travail mais non commités ni déployés (ADR-028 à ADR-031, [note de passation](../NOTE_PASSATION_AUDIT_2026-09-08.md)).

## 1. Résultat recherché

Un visiteur doit pouvoir : lire les pages légales, découvrir la démonstration et voir un mini-site réellement partagé. Un propriétaire doit pouvoir : créer un objet, le documenter, voir ses médias dans le Registre, publier un mini-site que le public voit tel quel, et suivre ses échéances. Tout cela sur téléphone comme sur ordinateur, et sur une base de code unique pour tous les Cartulaires.

Le plan comporte **8 vagues, de V0 à V7**. Chaque constat a une vague responsable de sa clôture. Le nombre de vagues n’est pas une durée : V0 et V1 sont courtes, V3 et V4 sont les plus lourdes. Taille indicative : S (moins d’un jour), M (quelques jours), L (une à deux semaines).

| Vague | Résultat attendu | Constats à clôturer | Taille | Prérequis |
|---|---|---|---|---|
| V0 | Base saine, sécurisée et déployable | V-A2, V-B6 (requalifié : sonde d’audit et garde-fou), P-B4 + commit des ADR-028 à 031 | S | Aucun |
| V1 | Déploiement des correctifs déjà réalisés | V-A1, P-A1, P-A2 (partie), pages de service | S | V0 |
| V2 | Démonstration cohérente avec la promesse de l’accueil | V-A3, V-A4, V-A5, V-C1, V-C2, V-C3, V-C5, V-D2 | M | V1 |
| V3 | Médias : dérivés de présentation partout, Galerie et Catalogue utilisables | P-A3, P-A4, V-B1, V-B3, P-B2 | L | V1 |
| V4 | Publication honnête : aperçu fidèle, mini-site d’objet et de Collection cohérents | P-A2, P-C6, V-C4, P-D4 | M | V1, V3 |
| V5 | Cartulaire propriétaire : lecture claire, édition sûre, création guidée | V-D1, P-B1, P-C4, P-C5, P-D1, P-D2, P-D3, P-D6, P-D5 | M | V1 |
| V6 | Mobile et accessibilité | V-D3, V-D4, V-D5, V-D6, V-D7, V-D8, V-D9, V-D10 | M | V5 pour le Cartulaire ; indépendant sinon |
| V7 | Performance, hygiène et recette finale | V-B2, V-B4, V-B5, recette des 49 constats | M | Toutes |

## 2. Détail des vagues

### V0 — Base saine, sécurisée et déployable

Objectif : ne plus déployer sur une base qui échoue silencieusement.

1. **App Check.** Diagnostiquer le 403 : clé `VITE_FIREBASE_APP_CHECK_SITE_KEY` (fournisseur reCAPTCHA Enterprise dans `src/firebase.ts`), domaine `studio-2614005370-a3e51.web.app` autorisé sur la clé, application enregistrée dans la console App Check, mode « appliqué » ou « surveillance » des fonctions. Décider si reCAPTCHA (346 ko) doit se charger sur les surfaces publiques ; sinon, ne l’initialiser qu’après connexion. Clôt V-A2.
2. **Commit des travaux d’architecture** sur une branche dédiée (`feat/lecteur-unique-adr-028-031`), après relecture de la note de passation. Aucun code nouveau.
3. **Environnement de recette local** : réinstaller un JDK 21 pour les émulateurs, rétablir `VITE_USE_FIREBASE_EMULATORS=true` dans `.env`, rejouer la séquence de seed avec `import:rolex`, puis `test:create`, `test:cartulary`, `test:import`, `test:live-sync`, jamais exécutés depuis les ADR-028 à 031.
4. **Hygiène de base** : V-B6 requalifié le 8 septembre 2026 : l’avertissement « Deprecated API for given entry type » venait du script de mesure de l’audit (`performance.getEntriesByType('largest-contentful-paint')` et `('layout-shift')`, refusés par Chromium hors `PerformanceObserver`), pas du site, qui n’instancie aucun observateur de performance ; livrable : sonde d’audit `scripts/lib/web-vitals-probe.mjs` (`observe({ type, buffered: true })` par type, protégé par `supportedEntryTypes`, jamais `entryTypes`) et garde-fou `tests/performance-api-hygiene.test.mjs`, à mesurer dans un onglet neuf par page ; forme de `cartularia-specification-groups` alignée entre création, seed et lecteur pour supprimer l’avertissement de réparation (P-B4) ; troncature du slug d’identifiant sur une frontière de mot (P-D5).

Vérification : aucune erreur 403 en console sur accueil, démo, Registre (onglet neuf par page) ; `npm run test:performance-hygiene` au vert (sans émulateur) ; `npm run test:wave8` au vert avec émulateurs ; branche poussée.

### V1 — Déploiement des correctifs déjà réalisés

Objectif : livrer ce qui existe déjà dans le dossier de travail et qui corrige des constats majeurs.

1. Build de production sans le drapeau émulateurs, déploiement Hosting uniquement, après autorisation explicite.
2. Vérifier en production : pages `/conditions`, `/confidentialite`, `/service`, `/accessibilite` (V-A1) ; panneau de publication serveur du mini-site présent sur la page Publication (P-A1) ; lecteur unique et sections génériques (ADR-028) ; absence de branche par marque (ADR-029).
3. Rejouer en distant, sur autorisation, `update:iwc-profile-keys` (trois clés et `originTitle`, sans médias) et `import:rolex` (racine existante : seul le brouillon privé du propriétaire est complété, sans toucher aux montants), chacun précédé de sa simulation `--dry-run`, puis `schema:upgrade --dry-run` sur le pilote IWC avant toute remontée réelle.

Vérification : parcours visiteur rejoué sur les liens du pied de page ; parcours propriétaire rejoué jusqu’à la publication serveur d’un mini-site de test.

### V2 — Démonstration cohérente avec la promesse de l’accueil

Objectif : chaque promesse de l’accueil aboutit à un écran qui la tient.

1. Publier réellement le mini-site d’au moins un Cartulaire de démonstration via la fonction serveur, et retirer « Voir le mini-site » des objets non publiés (V-A3).
2. Retour par défaut d’un Cartulaire `cart_demo_*` vers le Registre démo ; Cercle et Collection sans Registre orientent vers la démo ou l’accueil (V-A4, V-A5).
3. Seed du compte démo enrichi : rappels, une invitation fictive, statuts « revu » pour supprimer les « Import à vérifier » (V-C1, V-C2).
4. Page Publication en lecture seule : résumé de ce qui serait publié, sans erreur de connexion (V-C3) ; comparaison signalée dans la navigation (V-C5).
5. Messages techniques masqués en démo : synchronisation, copie cloud, panneau Preuves adapté (V-D2).

Vérification : parcours visiteur complet sans écran vide ni message technique.

### V3 — Médias : dérivés de présentation partout

Objectif : ne jamais télécharger un original privé pour afficher une vignette.

1. Étendre `generate-presentation-derivatives` et le pipeline serveur de dérivés (`presentationDerivative` sur les assets) à tout Cartulaire, pas seulement à l’IWC : génération à la vérification du téléversement, tailles 240/480/768/1200, WebP.
2. Galerie et Catalogue du Registre lisent uniquement la vignette de présentation ; suppression du chargement des originaux à l’ouverture (P-A3, P-A4).
3. Cartulaire : médias chargés par page, séquence 360° à l’ouverture du bloc, dérivés pour les démos (V-B1) ; vignettes de catalogue reprises de la Galerie (V-B3).
4. Nouvel objet : ses images s’affichent depuis les dérivés dès la fin de la création (P-B2).

Vérification : ouverture de la Galerie avec trois objets sous 500 ko et trois vignettes visibles ; page Accueil de la démo sous 1 Mo.

### V4 — Publication honnête

Objectif : le propriétaire voit exactement ce que verra le public, et « publié » signifie publié.

1. Aperçu strictement identique à la projection publique, blocs personnels exclus (P-A2) ; retrait des blocs Propriétaire, Transmission et Stockage des cibles publiables ou renommage explicite (V-C4).
2. « Publication active » uniquement après confirmation serveur ; états distincts « aperçu local », « publication demandée », « publiée », « révoquée » ; QR code affiché seulement lorsque la page publique existe. Après retrait, la page publique doit dire « Publication absente ou révoquée » et non « Publication indisponible » avec un bouton Réessayer : `loadPublicProjection` (`src/services/projections.ts`) doit traiter `permission-denied` comme « non publié », comme le fait déjà `loadPublicPublicationStatuses` (constat V1, journal §6).
3. Mini-site de Collection : ne lier un objet que si son mini-site est publié (P-C6).
4. Page Publication : une seule liste de contenus avec destinations en colonnes ; cases nommées (P-D4).

Vérification : mini-site de test publié puis révoqué, contrôlé en navigation anonyme à chaque état.

### V5 — Cartulaire propriétaire

Objectif : lire sans bruit, éditer sans surprise, créer avec un retour d’état.

1. Rendu « lecture » en texte pur pour tout lecteur non éditeur et pour la démo ; édition à la demande, y compris la fiche de spécifications (V-D1, P-D6).
2. Création : étapes serveur affichées (vérification, création, projection) avec estimation ; vérification des fichiers en parallèle (P-B1).
3. Spécifications : ligne créée seulement à la validation d’un libellé, suppression possible (P-C4).
4. Statut « à vérifier » : action « marquer comme revu » ou explication de ce qui le lève (P-C5).
5. Panneau Preuves : retrait de « Simulation technique » de la production, suppression des données isolée dans une section dédiée (P-D1).
6. Tableau « À faire » élargi (P-D2) ; « Aucune vidéo ajoutée » et bouton d’ajout à la place de « Accès restreint » (P-D3).

Vérification : parcours propriétaire rejoué ; tests `test:ui` et contrat de présentation au vert.

### V6 — Mobile et accessibilité

1. Barre d’onglets du Cartulaire défilante avec indice de débordement ; tableaux de la page Valorisation dans un conteneur à défilement (V-D3, V-D4).
2. Registre mobile : libellés sous les icônes, un seul lien d’accueil, en-tête compacté (V-D5) ; accueil mobile : bandeau réduit, onglets de la maquette défilants (V-D6).
3. Cibles tactiles à 44 px pour la navigation et les actions (V-D7) ; un seul `h1` par page avec espace entre marque et modèle (V-D8) ; traduction EN complète ou bascule masquée (V-D9) ; « mini-site » sans espace parasite (V-D10).

Vérification : passe à 390 px sur accueil, démo, Registre, Cartulaire propriétaire ; aucun débordement horizontal ; audit automatique d’accessibilité sans erreur.

### V7 — Performance, hygiène et recette finale

1. Regroupement des icônes dans les bundles, préchargement du Registre depuis la connexion (V-B2) ; polices hébergées avec le site (V-B5) ; routeur client unique si le budget le permet (V-B4).
2. Décisions en attente : activer une version automobile dans le manifeste ; sortir la correspondance des codes publics de `cartularyIds.ts` ; supprimer ou archiver les 174 copies « 2 » ; remonter le pilote IWC vers `watch@1.6.0` avec `schema:upgrade`.
3. Recette transversale des 49 constats, en visiteur puis en propriétaire, sur ordinateur et téléphone ; mise à jour des deux audits avec le statut de chaque constat.

## 3. Ordre d’exécution et parallélisation

Avec une seule personne : V0, V1, puis V2 et V3 en alternance, V4 après V3, V5, V6, V7. Avec deux personnes : l’une prend V3 puis V4 (médias et publication, chantiers serveur), l’autre V2 puis V5 puis V6 (interface). V0 et V1 restent séquentielles et prioritaires : rien ne doit être déployé tant qu’App Check échoue.

Les corrections courtes ne doivent pas attendre les chantiers lourds : pages légales, retours de la démo, « mini -site », `h1` doublés, bouton « Simulation technique », onglets mobiles inaccessibles.

`App.tsx`, le contrat de présentation et les styles ont un seul responsable d’intégration par vague. Les tests du contrat de présentation (ADR-026 durci, ADR-028) restent la barrière : toute vague qui touche un lecteur les fait passer avant livraison.

## 4. Ce que ce plan ne décide pas

- Le sort du Cartulaire de test `AUD-A3DA4019` créé pendant l’audit : suppression ou archivage par Jérôme.
- L’usage du Coffre personnel, non audité ; une vague dédiée sera nécessaire après un audit propriétaire du Coffre.
- L’envoi réel d’invitations et la publication dans le Cercle, non exercés, à recetter en V4 avec un compte destinataire de test.
