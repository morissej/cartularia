# Nouvel audit de fonctionnement — médias, téléchargements, mini-sites et PDF

Date : 6 septembre 2026, nouveau passage exécuté vers 21 h 41–21 h 48 (Europe/Paris).

Périmètre : code local actuel de `04_Application/Prototype Antigravity`, HEAD `94bba9c` avec changements non commités. Ce rapport ne certifie pas que ce code correspond au site déployé. Aucun compte réel, publication distante, original, droit, infrastructure ou source applicative n’a été modifié pendant ce passage.

## Résultat

Trois défauts fonctionnels reproductibles restent présents : rapport montre bloqué avec certains médias mixtes, absence de reprise pour une image 360° cassée, extension incorrecte de certains téléchargements publics. Un filtrage éditorial silencieux et une limite de confort des vidéos lourdes sont également à améliorer. Un test Node existant est obsolète et échoue.

Les résultats ci-dessous sont nouveaux. Les recettes et déploiements d’audits précédents ne sont pas comptés comme des preuves de ce passage.

| ID | Priorité | Constat | Niveau de preuve |
|---|---|---|---|
| M01 | P2 | Le PDF montre reste impossible avec une vidéo ou un PDF sans poster dans le diaporama | Reproduction composant + temporisation, chemin du renderer vérifié |
| M02 | P2 | Une vue 360° cassée peut rester sans message ni bouton de reprise | Événements d’erreur reproduits dans le composant |
| M03 | P2 | Un dérivé WebP peut être téléchargé sous un nom `.jpg` | Attribut de téléchargement reproduit sur un bloc public |
| M04 | P3 | Des phrases publiques ordinaires sont supprimées sans avertissement | Fonction de construction de publication exécutée |
| M05 | P3 | Les vidéos publiques lourdes attendent le téléchargement intégral, sans progression ni annulation | Lecture du chemin d’exécution ; pas de mesure réseau réelle |
| T01 | P2 technique | Un test de câblage ancien fait échouer la série Node | Échec exécuté, assertion exacte identifiée |

## M01 — Le rapport montre peut être bloqué par le diaporama mixte

**Reproduction utilisateur :** classer une vidéo sans poster, ou un document PDF, dans la catégorie « Diaporama » ; sélectionner ce bloc pour le rapport ; demander « Préparer le rapport PDF ». Après 30 secondes, le rapport signale une image indisponible et n’autorise pas l’impression. Retirer le bloc entier contourne le problème, mais fait perdre les autres photos du diaporama.

**Cause :** la sélection du diaporama accepte tous les types (`App.tsx:1335` et catégories du lecteur dans `CartularyModals.tsx:128–136`), tandis que son renderer imprimable passe chaque entrée à `PrivateMediaImage` (`App.tsx:2442–2444`). Sans poster, ce composant ne dispose d’aucune source pour une vidéo ou un document et ne lance aucune résolution pour ces types (`PrivateMediaImage.tsx:33` et `55`). Son état reste `loading`, ce qui conduit au délai d’échec de `useReportPreparation.ts:25–28`.

**Preuve nouvelle :** deux probes exécutées, une vidéo et un PDF. Pour chaque entrée : `img` sans `src`, diagnostic `loading`, puis phase `error` après 30 000 ms simulées. Il s’agit d’une reproduction de composants et d’un raccordement au renderer lu dans le code, pas d’un PDF enregistré dans un navigateur réel.

**Correction à prévoir :** distinguer images, vidéos et documents dans la version imprimable ; représenter les deux derniers par une notice ou un poster disponible, sans attendre une image qui ne sera jamais produite. Ajouter un test de rapport mixte complet.

Sources : [sélection du diaporama](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/App.tsx:1335>), [renderer imprimable](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/App.tsx:2442>), [résolution des images](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/PrivateMediaImage.tsx:55>), [attente du rapport](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/hooks/useReportPreparation.ts:25>).

## M02 — La reprise d’une vue 360° ne couvre pas l’échec de l’image elle-même

**Reproduction utilisateur :** ouvrir une séquence dont une URL d’image renvoie une erreur réseau/404, ou dont l’image reçue ne peut pas être décodée. La vue peut rester cassée, avec les commandes de rotation toujours disponibles, sans diagnostic ni reprise de cet angle.

**Cause :** le préchargement utilise la même fonction de fin pour `onload` et `onerror` (`Spin360.tsx:29–30`). L’image réellement affichée n’a pas de gestionnaire `onError` (`240–252`). Le bouton « Réessayer » dépend exclusivement d’une erreur de résolution de la source (`255`), pas d’une erreur réseau/décodage déclenchée ensuite par l’élément `img`.

**Preuve nouvelle :** probe avec une URL directe, échec effectif du préchargement simulé, puis événement `error` sur l’image rendue : aucun `.media-load-error` et aucun bouton « Réessayer ». Le comportement d’erreur du DOM est reproduit ; aucun incident de production n’est affirmé.

**Correction à prévoir :** suivre séparément l’état de décodage de l’angle, afficher l’échec, réinitialiser cet état lors d’un changement d’angle et proposer une reprise effective. Ne pas annoncer un préchargement réussi quand il a seulement terminé en erreur.

Source : [lecteur 360°](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/Spin360.tsx:240>).

## M03 — Le téléchargement public peut avoir une extension incompatible avec ses octets

**Reproduction utilisateur :** ajouter `cadran.jpg`, conserver ce nom, autoriser puis publier sa copie de présentation. Cette copie est en WebP, mais « Télécharger le média » demande un fichier nommé `cadran.jpg`.

**Cause :** le nom initial vient de `file.name` (`cartularyCreation.ts:177`) et est repris dans les labels de publication (`websiteDraft.ts:51`, puis `ProjectedPublicBlock.tsx:40`). Le format public est fourni séparément. `mediaDownloadFileName` conserve toute extension déjà présente avant de consulter le MIME (`mediaDownload.ts:45–49`). Le même mécanisme peut concerner un nom `.mov` pour une copie transcodée en MP4.

**Impact :** le fichier est téléchargé, mais son nom décrit un autre format ; certains logiciels, classements ou validations de pièces jointes peuvent le refuser ou mal l’identifier. Le comportement de ces applications tierces n’a pas été testé ici.

**Preuve nouvelle :** rendu d’un bloc public avec MIME `image/webp`, fichier `cadran.webp` et label `cadran.jpg` ; l’attribut `download` vaut bien `cadran.jpg`. Le choix du nom est identique pour le chemin public résolu en Blob. Aucun fichier réel n’a été téléchargé dans ce passage.

**Correction à prévoir :** distinguer nom d’original et nom de copie de présentation, conserver la base lisible et adapter l’extension au MIME de la copie effectivement téléchargée.

Source : [nom de téléchargement](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/utils/mediaDownload.ts:45>).

## M04 — Filtrage silencieux de contenu public ordinaire

**Reproduction :** une description « Cadran original bleu, sans restauration. » envoyée dans le bloc public « Description de l’objet » produit un tableau de paragraphes vide.

**Cause :** le filtre anti-données privées refuse le mot `original` n’importe où dans une phrase et supprime tout le paragraphe (`websiteDraft.ts:23–25`, `48`). Aucune liste des exclusions ni raison n’est retournée à l’interface.

**Preuve nouvelle :** probe pure exécutée sur cette phrase, sans données personnelles. Ce n’est pas une fuite : le contrôle échoue de manière prudente, mais appauvrit le contenu sans explication.

**Amélioration :** conserver les barrières de confidentialité, signaler explicitement les contenus exclus avant confirmation et permettre leur reformulation. Revoir les faux positifs sans autoriser globalement les données personnelles.

Source : [filtrage éditorial](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/domain/websiteDraft.ts:23>).

## M05 — Vidéos publiques : chargement à la demande, mais pas progressif

L’affichage du texte n’attend plus tous les médias et la vidéo publique exige un clic explicite : ces comportements sont confirmés par les tests UI de ce passage. En revanche, après ce clic, `getBlob` télécharge le fichier entier, puis le contrôle d’empreinte lit son contenu avant de fournir une URL au lecteur (`publicMedia.ts:15–22`). Le lecteur n’est monté qu’à réception de cette URL (`MediaVideo.tsx:19–20`). Une copie vidéo peut atteindre 100 Mio et la publication 150 Mio (`website-publication-command.mjs:109`, `152`).

**Amélioration utilisateur :** annoncer la taille, afficher une progression et une annulation ; instruire ensuite une lecture progressive qui conserve les contrôles d’accès. Ce rapport ne recommande pas de remplacer le chemin protégé par des URLs publiques porteuses de jetons. Aucun débit mobile, temps de démarrage vidéo ou comportement Safari n’a été mesuré ici.

Sources : [résolution du Blob public](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/services/publicMedia.ts:15>), [lecteur vidéo](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/src/components/MediaVideo.tsx:19>).

## T01 — Un test existant décrit l’ancien chargement public

`tests/media-download-wiring.test.mjs:24` attend littéralement `block.assets.some((asset) => asset.downloadUrl)`. Le composant actuel accepte une référence Storage publique valide sans URL préchargée et ne contient plus cette expression. L’assertion échoue ; ce résultat ne démontre pas une fuite d’original ni un téléchargement impossible.

**À prévoir :** remplacer l’assertion de forme de code par un test fonctionnel qui distingue référence publique autorisée, résolution au clic et absence de repli vers un original privé. Les tests UI correspondants passent dans cette recette.

Source : [assertion obsolète](</Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity/tests/media-download-wiring.test.mjs:24>).

## Vérifications nouvellement exécutées

- **UI : 56/56 tests passent, 15 fichiers.** `cloud-media-resolution`, `public-media-loading`, `private-media-image-lifecycle`, `media-preloading`, `media-download-link`, `projected-public-media-download`, `public-media-service`, `demo-website-media`, `generic-print-summary`, `report-preparation`, `website-publication-panel`, `website-draft`, `private-media-access-diagnostic`, `object-url-lease-cache`, `cartulary-modals`.
- **Node : 17/18 tests passent, 5 fichiers.** `media-download-wiring`, `media-presentation-runtime`, `report-rendering`, `generic-media-command`, `website-publication-command`. Unique échec détaillé en T01.
- **Probes d’audit : 5/5 reproductions obtenues** pour M01 (2 types), M02, M03 et M04. Ces probes passent parce qu’elles démontrent les défauts actuels ; elles ne valident pas leur correction. Elles sont hors des sources, dans `/private/tmp/cartularia-medias-audit.SpoQCd/probes.test.tsx` ; commande : `npx vitest run --config /private/tmp/cartularia-medias-audit.SpoQCd/vitest.config.ts`.
- Les tests Node ont notamment reconstruit un PDF de présentation local depuis ses pixels, vérifié ses propriétés attendues et son refus au-delà des limites. Ce test de dérivé documentaire ne constitue pas une validation visuelle du rapport PDF utilisateur.

## Limites et points non clôturés

- **Invités :** le nouveau test de diagnostic confirme que le résolveur ne lit pas l’original du propriétaire. Il renvoie explicitement `shared-unavailable` quand aucune copie autorisée n’est disponible. La séparation des droits est préservée ; un parcours invité avec photos, PDF et téléchargements fonctionnels n’est pas démontré. Source actuelle : `privateMedia.ts:68–101`.
- **Mini-sites réels :** les tests de publication/révocation sont locaux avec doubles ; aucune publication distante, aucun retrait à deux sessions et aucun test propriétaire→visiteur réel n’a été effectué par ce lot.
- **Impression :** pas de boîte d’impression réelle ouverte, pas de PDF final enregistré ou examiné pour les sauts de page, polices, images et marges. Les tests de préparation ne remplacent pas cette recette.
- **Navigateurs et charge :** pas de recette Safari/Firefox, mobile réel, débit limité ou très grand ensemble média. Le navigateur utilisé par l’audit principal n’a pas été manipulé.
- **Confidentialité :** aucun assouplissement des Rules, accès aux originaux ou partage de session n’a été tenté pour rendre un média artificiellement accessible.

Ordre recommandé : M01 et M02, M03, puis T01 ; ensuite M04 et M05. Refaire enfin la recette propriétaire/invité/visiteur et un PDF réellement enregistré sur les versions effectivement déployées.
