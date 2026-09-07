# Correctifs médias et publication — état local au 6 septembre 2026

Ce document décrit le code local et ses tests. Il ne constitue ni une preuve de déploiement, ni une recette Firebase distante. Les changements s’appliquent aux types d’objets communs, sans exception de marque ou d’identifiant.

## État par constat

| Constats | Correction locale | Limite de validation |
|---|---|---|
| 21 | Résolution autorisée par binaryId et cartularyId pour image, vidéo, PDF, 360° et téléchargement ; erreurs et nouvelle tentative ; vérification SHA-256 du binaire privé | Tests avec résolveur simulé ; session distante sans cache et perte réelle de droits à recetter |
| 22 | Sélection du carrousel par identité, index borné avant rendu ; listes réordonnées/réduites/vides testées | Recette tactile/mobile réelle restante |
| 23, 24 | Lecteurs et téléchargements communs aux projections publiques et aperçus ; PDF publics reconstruits depuis les pixels ; vidéo publique via adaptateur de transcodage contrôlé | Vidéo non clôturée : runtime FFmpeg/FFprobe non provisionné. L’aperçu local ne remplace jamais un dérivé absent par l’original privé |
| 25 | Noms de téléchargement utiles, format, états préparation/indisponible/nouvelle tentative | Contenu téléchargé distant à vérifier ; fichiers de test locaux vérifiés |
| 26 | Publication serveur, confirmation expresse, révision attendue, reçu de rejeu ; lien public seulement après réponse serveur | Commandes testées avec transactions en mémoire ; Functions/Rules/Storage réels à recetter |
| 27 | Liste blanche commune aux sélecteurs et au serveur ; médias « Tous » seulement dans la sélection publique ; originaux absents des requêtes et aperçus | Les types vidéo/PDF ne passent que si un dérivé sûr existe réellement |
| 28 | Remplacement atomique des blocs et droits médias ; suppression physique des anciennes copies connues lors de désélection/retrait ; suppression de Collection précédée d’un retrait puis suppression atomique des parents | Copies historiques non référencées à inventorier ; les fichiers déjà téléchargés ne peuvent pas être effacés chez leurs destinataires |
| 29 | Service canonique conservé ; suppression du champ d’adresse sans effet traitée par le lot Registre | Recette lien public réel restante |
| 30 | Logos publics vers Accueil ; absence de liens Cartulaire privé en Collection publique ; liens objet conditionnés à une publication active | Publication révoquée après lecture : nouvel accès refusé, copie déjà chargée assimilée à un téléchargement |
| 34 | « Imprimer / Enregistrer en PDF » ; message demande d’impression, aucune promesse de fichier effectivement enregistré | PDF fixture rendu visuellement ; impression du rapport complet avec photos distantes restante |
| 37, 38 | Commandes À Faire/vidéo nommées, compteur accessible conservé, retour Registre filtré, libellés médias et dates localisés | Harmonisation de tout le site à consolider dans V13 |

## Contrat des trois commandes

- `getCartularyWebsiteState({ cartularyId })` : compte actif, propriétaire légal de l’objet, permission `publication.manage` et périmètre Registre requis.
- `publishCartularyWebsite({ cartularyId, requestId, expectedRevision, confirmed: true, confirmedNonPersonalMedia: true, blocks })` : blocs `{ id, title, payload, assets: [{ assetId, binaryId }] }`. Aucun URL ou chemin source n’est accepté comme source média. La confirmation non personnelle est obligatoire dès qu’un média est sélectionné.
- `revokeCartularyWebsite({ cartularyId, requestId, expectedRevision, confirmed: true })` : retrait de la projection et des copies publiques connues ; reçu rejouable si la connexion ou la suppression Storage échoue.

Retour : `cartularyId`, `publicCode`, `revision`, `status`, `blockIds`, `cleanupPending`, `pendingCleanupCount`. La préparation et son inventaire de nettoyage sont conservés dans `websiteOperations` / `websiteCleanup`, sous le Cartulaire, côté serveur. Les inventaires sont initialisés par création immuable puis relecture, jamais écrasés par une seconde demande concurrente. Les propriétaires ne doivent pas recevoir de droit client d’écriture sur ces documents.

Une suppression Storage qui échoue après le changement Firestore ne constitue pas un retrait complet : l’état serveur expose le nettoyage restant, y compris après rafraîchissement. La présence du reçu transactionnel retrouve aussi un travail interrompu immédiatement après commit. Le bouton « Reprendre la suppression des anciennes copies » appelle `revokeCartularyWebsite` avec `cleanupOnly: true` et un nouvel identifiant si nécessaire ; il ne révoque pas la publication actuelle. Une nouvelle publication ne peut pas abandonner un ancien nettoyage en échec. Les anciennes copies supprimées voient également leur descripteur marqué révoqué.

Les copies `public/{publicCode}/{assetId}/{derivativeId}` n’ont aucun jeton Firebase de téléchargement et utilisent `private, no-store, max-age=0`. `mediaAccess/{assetId}.derivativeIds` est remplacé dans la transaction de publication ; les Storage Rules doivent vérifier cette liste. Le navigateur utilise `getBlob`, sans URL à jeton persistante, avec deux transferts simultanés maximum et déduplication entre blocs. Une ancienne URL à jeton contourne les Rules : sa révocation repose donc aussi sur la suppression physique de l’ancien chemin inventorié. Une ancienne copie publique non référencée exige un inventaire séparé.

## Dérivés PDF et vidéo

L’original et son SHA-256 ne sont jamais modifiés. Les dérivés restent privés jusqu’à la sélection puis confirmation humaine. Les binaires classés `owner_document` ou sans classe connue ne peuvent pas être publiés. Les seules classes admissibles sont `media` et `condition_attachment`.

PDF : PDF.js rend chaque page dans un canvas, puis pdf-lib construit un document neuf ne contenant que les images de pages. Pas de copie des objets source, métadonnées, pièces jointes, formulaires, actions ou signatures cryptographiques. Ce document de présentation n’est pas un original ni une preuve de signature ; le texte n’y est plus sélectionnable. Limites : 50 Mio source/sortie, 30 pages, 4 Mpx/page, 80 Mpx cumulés, 120 secondes et heap JavaScript de 512 Mio dans un sous-processus distinct. Ce plafond de heap n’est pas une limite OS pour toute la mémoire native ; le quota mémoire du service reste nécessaire. Aucun audit antivirus n’est prétendu.

La détection textuelle bloque certains marqueurs personnels et adresses email dans les PDF. Elle n’est **pas** une garantie d’absence de données personnelles dans les scans, images ou vidéos : la confirmation de vérification visuelle par l’utilisateur reste obligatoire, et les documents personnels doivent rester dans le Coffre personnel. Les métadonnées supprimées ne valent pas anonymisation du contenu visible.

Vidéo : configurer côté serveur `FFMPEG_PATH` et `FFPROBE_PATH` absolus vers des exécutables provisionnés et vérifiés. Aucun téléchargement automatique de binaire ni installation globale n’est réalisé. Les planchers maintenus, vérifiés sur [les versions officielles FFmpeg](https://ffmpeg.org/download.html), sont 7.1.5, 8.0.3, 8.1.2 ou 9.0.1 ; la politique doit suivre les correctifs de sécurité futurs. L’absence, une version ancienne, une erreur ou un dépassement laisse l’original privé, non publiable.

Contrôles vidéo : une piste vidéo, 3 minutes maximum, 4K maximum en entrée ; transcodage H.264/AAC vers 1280×720 maximum, pistes sous-titres/données et métadonnées retirées, protocoles locaux seulement, deux threads, taille sortie <100 Mio, contrôle durée et métadonnées de sortie, décodage complet du résultat. Timeout du transcodage 180 s ; étapes de contrôle bornées séparément. `-max_alloc` borne une allocation, pas la mémoire totale du processus : quota mémoire du runtime indispensable. La copie et son SHA-256 sont validés avant publication. Le total publié est limité à 150 Mio.

Le traitement d’upload passe à `private-upload@1.1.0`. Les anciens médias nécessitent une reprise contrôlée du backlog existant pour produire les nouveaux dérivés ; aucun rattrapage distant n’a été lancé par ce lot. Une vidéo vérifiée alors que le runtime est absent doit être retraitée explicitement après provisionnement.

## Dépendances et tests

Dépendances projet verrouillées : `pdfjs-dist 5.6.205` (Apache-2.0), `@napi-rs/canvas 0.1.100` (MIT), `pdf-lib 1.17.1` (MIT). pdf-lib ne lit pas l’entrée non fiable dans le pipeline : il assemble seulement les images produites. Bibliothèques et principes vérifiés dans les documentations [PDF.js](https://mozilla.github.io/pdf.js/examples/) et [PDF-LIB](https://pdf-lib.js.org/docs/api/classes/pdfdocument).

L’installation npm a signalé 25 alertes globales (1 basse, 20 modérées, 2 hautes, 2 critiques). L’audit réseau détaillé a été refusé par auto-review pour éviter la transmission non autorisée de la liste des dépendances à npmjs.org. Aucune attribution aux dépendances ajoutées ni correction globale n’est revendiquée. Une autorisation d’audit ou une source locale de détails est nécessaire avant de conclure sur ces alertes.

Tests ciblés exécutés : 26 tests UI dans 9 fichiers ; 15 tests commande/pipeline dans `website-publication-command.test.mjs`, `private-upload-command.test.mjs` et `media-presentation-runtime.test.mjs` ; TypeScript, oxlint ciblé et `git diff --check` réussis. Tests de panne : suppression Storage interrompue, deux requêtes intercalées dont une avait lu un inventaire absent, rafraîchissement, nouvelle demande de reprise, et interruption après mise à jour suivie d’une autre publication. Le PDF de contrôle généré a été rendu avec Poppler et inspecté : texte et page lisibles, dimensions conservées, aucune métadonnée auteur/titre transférée, empreinte de l’original identique avant/après.

### Recette d’intégration locale Firestore + Storage

La relecture indépendante a exécuté `tests/audit-publication-emulator.test.mjs` : **3/3 tests réussis**, sur le projet fictif `cartularia-audit-publication-test`, Firestore 38480 et Storage 39419. Cette recette utilise des binaires PNG/WebP réels et des empreintes calculées, non un substitut Storage en mémoire. Les données créées pour la recette ont été nettoyées précisément.

- URL de média avec ancien jeton : HTTP 200 avant retrait ; après désélection ou retrait, HTTP 403 et vérification Admin `exists=false`, démontrant la suppression physique de la copie.
- Panne de suppression Storage injectée après commit Firestore : l’ancienne URL reste effectivement HTTP 200, et le nettoyage restant apparaît après une nouvelle instance Admin. Une nouvelle publication est bloquée tant que la suppression échoue.
- Reprise `cleanupOnly` avec un nouvel identifiant de demande : URL HTTP 403, fichier absent, révision de publication inchangée et SHA-256 de l’original privé intact.
- Rejeu d’une ancienne publication après révocation : ni la projection ni le fichier ne sont réactivés.

Ces tests vérifient explicitement le risque des URL à jeton, qui contournent les Rules. Ils ne constituent donc pas une certification des Storage Rules entre projets, des callables Functions, d’App Check, d’IAM ou de la production.

Restent à démontrer séparément : transcodage vidéo effectif avec exécutables maintenus, émulateurs complets Rules/Functions/Storage, cycle distant upload→publication→désélection→retrait, navigateur authentifié sans cache, mini-site anonyme distant et impression réelle. La révocation des URL déjà obtenues est maintenant démontrée sur émulateurs locaux, pas sur le projet distant. Aucun déploiement effectué par ce lot.

### Correctif de recette : aperçu média de la démonstration

La recette navigateur a détecté des rubriques médias vides : la source fictive marquait ses fichiers statiques `Secret`, donc la règle publique les excluait. La source de démonstration donne désormais une autorisation explicite `Tous` aux seules fixtures des définitions connues, sans binaire cloud, sous `/assets/demo-watches/`. Une définition inconnue ou une racine substituée reste `Secret` ; le filtre générique des vrais médias n’a pas changé. Cela ne publie aucun Cartulaire ni aucune Collection sur le serveur.

Les 7 nouveaux tests `demo-website-media.test.tsx` vérifient les cinq Cartulaires : fichiers réellement présents, image rendue, vidéo avec commandes, téléchargement `.webm`, mention « Aperçu local · non publié », maintien de l’exclusion d’un vrai fichier `Secret`, rejet d’une source fictive substituée. Avec les tests de projection et de brouillon : 10/10 UI réussis ; 8/8 tests du compte démo, TypeScript, oxlint et contrôle de diff réussis. La nouvelle recette navigateur après reconstruction est confiée à l’agent principal ; aucune publication distante n’est revendiquée.
