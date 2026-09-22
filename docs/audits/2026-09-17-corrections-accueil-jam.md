# Corrections de l’accueil Cartularia — exécution C01 à C14

Date de recette : 17–18 septembre 2026  
Source de la demande : `../Prompt_corrections_accueil_Jam_2026-09-14.md` et dossier Jam « Commentaires Page accueil »  
Périmètre : implémentation, recette locale et publication du build web dans `04_Application/Prototype Antigravity`  
Déploiement : **Firebase Hosting uniquement**, le 18 septembre 2026, sur `studio-2614005370-a3e51`

## Résultat

Les quatorze corrections ont été implémentées, validées localement puis publiées sur Firebase Hosting. L’accueil présente désormais le positionnement patrimonial demandé, cinq usages, huit livrables ouvrant chacun une page dédiée, une vraie capture du Cartulaire, une page Objets, un parcours d’aide photo/vidéo et la politique RGPD complète. Le Registre, le Coffre, les Collections, les Cartulaires et les surfaces publiques partagent en outre des garde-fous typographiques pour éviter les ruptures et débordements prématurés.

La fiche standard générique pour les catégories autres que montre et voiture n’a pas été inventée : son absence reste explicitement indiquée dans la FAQ et sur la page Objets. La politique RGPD reste un projet de version 1.0 soumis à revue juridique ; la page distingue le texte source des constats techniques actualisés.

## Matrice C01–C14

| Point | Résultat | Fichiers principaux | Preuve | Limite restante |
|---|---|---|---|---|
| C01 | Surtitre remplacé par `DOSSIER PATRIMONIAL POUR OBJET D'EXCEPTION`. | `src/features/public/HomePage.tsx` | Test UI `public-site`; captures `accueil-*`. | Aucune. |
| C02 | H1 exact, fluide et sans saut décoratif imposé. | `HomePage.tsx`, `public-site.css` | Tests UI et captures 390/768/1440/1728. | Les coupures exactes varient normalement avec la police et la largeur. |
| C03 | La simulation a été remplacée par une capture WebP de la vraie démo Submariner, avec agrandissement, texte alternatif et accès direct. | `HomePage.tsx`, `publicContent.ts`, `public/assets/public/captures/cartulaire-accueil.webp` | Capture générée depuis `/cartulary-demo?...#cover`; manifeste : titre et H1 attendus, données fictives ; fichier distant identique au build local. | Données de démonstration fictives uniquement. |
| C04 | Les sept bénéfices demandés sont présents. Les textes précisent que l’IA n’effectue pas de diagnostic automatique et que le Sceau vérifie l’intégrité sans certifier l’authenticité. La phrase à supprimer a disparu. | `publicContent.ts`, `HomePage.tsx` | Test UI des sept libellés et de leurs limites. | Capacités IA encore éditorialement cadrées, sans nouveau moteur ajouté. |
| C05 | Phrase de positionnement remplacée mot pour mot. | `HomePage.tsx` | Capture d’accueil aux quatre largeurs. | Aucune. |
| C06 | Cinq cartes homogènes : sinistre, transmission/cession, vision globale, actions d’entretien, décision achat/vente. | `HomePage.tsx` | Test UI comptant et nommant les cinq usages. | L’aide achat/vente reste documentaire et analytique, sans transaction ni recommandation automatisée. |
| C07 | Règle durable ajoutée au design system ; deux sauts forcés supprimés ; paliers et garde-fous `min-width`, wrapping et grilles ajustés sur public, Registre, Cartulaire, Collection, mini-site, Cercle, accès et Coffre. | `src/styles/variables.css`, `src/index.css`, `src/features/public/public-site.css`, `src/features/registry/registry.css`, `src/personalVault/personalVault.css`, `src/App.tsx` | 52 captures publiques à 390/768/1440/1728 : 0 débordement. [Audit axe du 18 septembre](a11y/2026-09-18.md) à 390, 1440 et reflow 720 CSS px à DPR 2 (équivalent zoom 200 %) : 0 violation bloquante, 0 assertion en échec. Tests de contrat C07 et menu clavier Échap. | Registre et Collection authentifiés inspectés visuellement à 1440 sur émulateurs ; leurs états mobiles, ainsi que le Coffre authentifié, restent couverts par CSS/tests et non par une session visuelle authentifiée complète. Les 644 nœuds `incomplete` d’axe restent un canal de revue manuelle, sans revendication de conformité. |
| C08 | Huit cartes dans l’ordre demandé et huit pages de détail mutualisées. Chaque détail contient utilité, fonctions effectives, exemple fictif, capture, accès direct et retours. | `publicContent.ts`, `PublicEditorialPage.tsx`, `public-site.css`, `App.tsx` | Tests des huit routes et des accès directs ; captures des huit pages aux quatre largeurs ; huit captures produit distinctes, dont l’aperçu Mini Site réellement rendu, le panneau Preuves et le Registre/Collection authentifiés sur émulateurs. | Le Mini Site capturé est un aperçu local explicitement non publié ; le rapport montre sa commande réelle de préparation sans produire de PDF ; la chaîne du Sceau est explicitement fictive. Aucune publication n’a été déclenchée. |
| C09 | Pages `/aide-documentaire` et `/conseils-photo-video` créées avec liste photo/vidéo, prudence sur le mouvement, parcours autonome et professionnel. Motif professionnel présélectionné et conservé dans l’e-mail préparé/copier. | `PublicEditorialPage.tsx`, `publicContent.ts`, `HomePage.tsx` | Tests UI des contenus, du paramètre `motif` et du message préparé ; captures aux quatre largeurs. | Aucun message envoyé ; le formulaire continue d’ouvrir/préparer la messagerie de l’utilisateur. |
| C10 | FAQ réécrite avec les sept catégories et les trois niveaux de disponibilité. | `publicContent.ts`, `HomePage.tsx` | Test UI de la réponse et de l’avertissement pilote. | Seuls montre et voiture ont un parcours dédié. La fiche standard générique doit encore être conçue et ouverte avant de pouvoir créer bijoux, or, vin, peinture ou sculpture. |
| C11 | Page `/objets` créée, illustrée par sept pictogrammes cohérents et alimentée par la même source que la FAQ. Navigation desktop/mobile mise à jour. | `PublicEditorialPage.tsx`, `PublicChrome.tsx`, `publicContent.ts` | Test UI des sept catégories et statuts ; captures 390/768/1440/1728. | Les pictogrammes illustrent les catégories ; ils ne simulent pas des Cartulaires indisponibles. |
| C12 | Signature exacte : `Le dossier vivant de vos objets patrimoniaux.` | `PublicChrome.tsx` | Test UI et captures du pied de page. | Aucune. |
| C13 | Bloc de neuf liens retiré ; logo, signature, copyright et liens légaux conservés dans un pied compact partagé. | `PublicChrome.tsx`, `public-site.css` | Test d’absence de la navigation de pied et captures. | Aucune. |
| C14 | Le document juridique v1.0 du 21 août 2026 est rendu intégralement en HTML avec sommaire, quatre parties, annexes et tableaux. Un bloc distinct expose l’état local actuel et les contradictions. | `PrivacyPolicyPage.tsx`, `privacyPolicyData.ts`, `public-site.css`, routage `RootPage.tsx` / `interfaceState.ts` | Comparaison automatisée ponctuelle de l’extrait source : 0 fragment manquant ; égalité exacte des tableaux de 14 traitements, 9 prestataires, 16 écarts, 10 actions et 12 références. Six tests UI ; captures du premier écran aux quatre largeurs ; lien depuis footer, contact et création de compte. | Source interne non adoptée. Identité juridique, référent, canal vie privée et plusieurs décisions restent à compléter ; aucune validation juridique n’est revendiquée. Le contrôle intégral DOCX/HTML a été exécuté pendant la recette, mais n’est pas un garde CI versionné. |

## Routes ajoutées ou remplacées

- `/objets`
- `/aide-documentaire`
- `/conseils-photo-video`
- `/livrables/cartulaire`
- `/livrables/registre`
- `/livrables/collection`
- `/livrables/mini-site`
- `/livrables/rapport-pdf`
- `/livrables/sceau-integrite`
- `/livrables/cercle`
- `/livrables/todo-list`
- `/confidentialite` — remplace la notice courte par la politique complète.

Chaque route directe et son rechargement sont reconnus par `applicationRouteFromPathname`; le serveur statique de recette applique le même repli vers `index.html` que l’hébergement SPA.

## Preuves visuelles

Le manifeste [capture-report.json](2026-09-17-corrections-accueil/capture-report.json) consigne **60 captures réussies et 0 échec** : 13 scènes publiques à 390, 768, 1440 et 1728 px, plus huit surfaces produit distinctes. Pour les pages longues, les captures sont pleine page ; la politique RGPD conserve une capture du premier écran afin d’éviter un bitmap démesuré. Aucune des 52 scènes publiques ne présente de `scrollWidth` supérieur au `clientWidth`.

Exemples :

- [Accueil 390 px](2026-09-17-corrections-accueil/screenshots/accueil-390.webp)
- [Accueil 1440 px](2026-09-17-corrections-accueil/screenshots/accueil-1440.webp)
- [Objets 1440 px](2026-09-17-corrections-accueil/screenshots/objets-1440.webp)
- [Aide documentaire 768 px](2026-09-17-corrections-accueil/screenshots/aide-documentaire-768.webp)
- [Détail Registre 1440 px](2026-09-17-corrections-accueil/screenshots/livrable-registre-1440.webp)
- [Détail Collection 1440 px](2026-09-17-corrections-accueil/screenshots/livrable-collection-1440.webp)
- [Politique RGPD 390 px](2026-09-17-corrections-accueil/screenshots/confidentialite-390.webp)
- [Politique RGPD 1440 px](2026-09-17-corrections-accueil/screenshots/confidentialite-1440.webp)

Les captures produit sont régénérables par `scripts/capture-home-corrections.mjs`. Le Registre et la Collection ont été obtenus par leur vrai parcours de connexion sur Auth et Firestore émulés, après seed du compte fictif `read_only`. Le script bloque le réseau hors `127.0.0.1`.

Commande reproductible depuis la racine de l’application :

```sh
FIREBASE_CLI_DISABLE_UPDATE_CHECK=true firebase emulators:exec --config firebase.demo-test.json \
  --project cartularia-demo-test --only auth,firestore \
  "npm run schema:check && npm run seed:foundations && npm run seed:demo-account && VITE_USE_FIREBASE_EMULATORS=true VITE_FIREBASE_PROJECT_ID=cartularia-demo-test VITE_FIREBASE_EMULATOR_HOST=127.0.0.1 VITE_FIREBASE_AUTH_EMULATOR_PORT=19099 VITE_FIREBASE_FIRESTORE_EMULATOR_PORT=18087 npm run build && node scripts/capture-home-corrections.mjs"
```

Cette commande construit explicitement la variante émulateur avant la capture. Le build final de livraison est ensuite régénéré avec `VITE_USE_FIREBASE_EMULATORS=false`.

## Vérifications

| Contrôle | Résultat |
|---|---|
| `npm run test:ui` | 95 fichiers, 556 tests réussis |
| Tests Node ciblés interface/C07/tactile | 26/26 réussis |
| `npm run validate:ai` | 85 postes et 85 identifiants reliés |
| `npm run lint` | réussi |
| `npm run build` avec `VITE_USE_FIREBASE_EMULATORS=false` | réussi |
| `npm run audit:a11y` | 0 violation serious/critical bloquante, 0 assertion en échec, 3 conditions de fenêtre dont reflow équivalent à 200 % |
| `git diff --check` | réussi |
| Recette visuelle | 60/60 captures, 0 débordement horizontal public |
| Firebase Hosting | déploiement `hosting` réussi ; huit routes HTTP 200 ; HTML, modules publics, CSS et huit captures identiques au build local par SHA-256 |

L’avertissement jsdom `Not implemented: navigation to another Document` provient du test du lien `mailto:` ; il n’empêche aucun test et confirme qu’aucun message n’a été expédié.

## Niveaux de validation

| Niveau | État |
|---|---|
| Local anonyme | Accueil, Objets, aide, guide, huit détails et confidentialité rendus et capturés aux quatre largeurs. |
| Local authentifié | Registre et Collection démo ouverts avec Auth/Firestore émulés ; compte fictif strictement `read_only`. |
| Production | Build web publié sur [Firebase Hosting](https://studio-2614005370-a3e51.web.app/) et vérifié par HTTP et empreintes. Aucun déploiement de Functions, règles/index Firestore, règles Storage, seed distant, publication de dossier, envoi de message ou changement de données. Les parcours métier authentifiés de production n’ont pas été rejoués. |

## Source RGPD retenue

Source unique trouvée : `07_Cadre juridique et règlementaire/Politique_RGPD_Cartularia_v1.0.docx`, version 1.0 du 21 août 2026, 18 pages, SHA-256 `0984a411b78d0a299153d86813cc7739e50998c594bbb6f23b93bc723f293f1c`. Aucune version validée plus récente n’a été trouvée. Les placeholders du document sont conservés au lieu d’inventer des coordonnées ou engagements.
