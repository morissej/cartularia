# Lot Coffre — C01, C02 et C12

6 septembre 2026. Corrections locales autorisées. Aucun déploiement, seed, commit, changement IAM ou accès à un compte réel dans ce lot. Les modifications préexistantes sont conservées.

## C01 — Raccordement minimal des codes entre domaines

Le Cartulaire reçoit un instantané des codes Lieux/Personnes après confirmation explicite dans le Coffre déverrouillé. Les trois projets et authentifications restent séparés. Le Registre ne reçoit aucun mot de passe, clé, token Auth ni session pont.

Le premier prototype utilisait `postMessage` et `window.opener`. La revue a identifié que `firebase.personal.json` impose `Cross-Origin-Opener-Policy: same-origin`, qui coupe cette relation entre domaines. **Ce header n’a pas été affaibli.** Le protocole final utilise :

1. Une demande éphémère avec capability UUID v4, échéance de dix minutes, destination Registre exacte et destinataire pseudonymisé (UID et adresse technique d’alias). Elle voyage uniquement dans le fragment vers le domaine Coffre configuré.
2. Capture en mémoire puis retrait immédiat du fragment par l’import initial des deux points d’entrée, avant rendu. Rien n’est écrit dans localStorage/sessionStorage.
3. Une destination autorisée exactement par `VITE_REGISTRY_SITE_URL`, un alias identique au Coffre et des sessions Coffre/pont présentes et rafraîchies. Après consentement, lecture serveur des seuls codes. Les libellés sont préservés uniquement s’ils correspondent à `Lieu N` / `Personne N`; un libellé non conforme est remplacé par le code stable, jamais renuméroté arbitrairement.
4. Un retour vers `/code-handoff-return` sur l’origine Registre configurée. Le fragment est retiré avant parsing/rendu ; schéma strict, taille maximale 256 Kio et 1 000 entrées par catégorie.
5. Relais `BroadcastChannel` même origine vers l’onglet demandeur. Validation de capability, échéance exacte, UID, alias et session courante. Import unique ; les répétitions ne reçoivent qu’un accusé. Changement de compte, annulation ou expiration rendent les codes indisponibles dans la session.

Le canal retour n’affirme pas disposer d’une signature serveur de provenance : son autorisation repose sur la capability imprévisible transmise au seul Coffre HTTPS configuré et la session demandeuse. Il ne protège pas contre une compromission JavaScript des origines de confiance. Le nonce n’est pas un token d’authentification et n’ouvre aucun droit Firebase.

Le blocage de fenêtre, l’absence de BroadcastChannel, le refus dans le Coffre, l’absence d’accusé et l’expiration ont des messages distincts. La fermeture d’une fenêtre n’est pas déduite de `popup.closed`, car COOP peut produire cet état sans fermeture réelle ; l’utilisateur dispose d’une annulation explicite et d’une instruction de reprise.

La sélection d’un code continue d’écrire l’état du Cartulaire par ses commandes habituelles. **Aucun rattachement inverse automatique entre objet et propriétaire du Coffre n’est prétendu.** Les anciens comptes Registre sans alias technique compatible sont refusés avec explication, sans transfert de secrets de compatibilité.

### Preuve navigateur isolée

Fixture hors dépôt : `/private/tmp/cartularia-code-handoff-qa.S7ReJV`. Deux origines locales, ports 4205 et 4206 ; réponses HTTP avec COOP et CORP `same-origin`. Les vrais composants du protocole sont utilisés, mais les sessions et lectures de codes sont explicitement fictives, sans Firebase.

Chrome : demande depuis l’onglet Registre → Coffre affichant destination exacte → diagnostic DOM `opener absent = true` et `fragment retiré = true` → confirmation → retour sans fragment → accusé de réception → `LIE-ABCDEF12 / Lieu 1` et `CLI-12345678 / Personne 1` présents dans l’onglet initial. Scénario de refus également exécuté : accusé d’annulation et listes restées vides.

Cette preuve établit le transport navigateur avec l’isolation COOP, **pas** une connexion réelle entre les trois projets ni une écriture de Cartulaire authentifiée. Une recette sur les deux versions livrées reste nécessaire. Pour les émulateurs, les origines locales doivent être configurées explicitement dans les builds ; aucune origine reçue par URL n’est ajoutée automatiquement à l’allowlist.

## C02 — Récupération et saisies concurrentes

L’attente du formulaire de récupération remonte au Coffre et bloque édition, sauvegarde, verrouillage et connexion concurrente. Une référence de la saisie est capturée au début. Si elle change malgré le blocage, la réponse ancienne est refusée sans remplacer les valeurs, et les opérations sont suspendues jusqu’à conservation/reprise des saisies.

Tests différés : champs et actions effectivement bloqués pendant l’attente ; saisie forcée après départ conservée au retour, aucune sauvegarde et avertissement explicite. Le code ne confond plus ce conflit avec un succès de récupération.

## C12 — Synchronisation des codes durable et visible

Une sauvegarde CAS écrit d’abord `codeSyncPending=true` **dans le contenu chiffré**, puis synchronise les seuls codes, puis acquitte par une seconde sauvegarde chiffrée/CAS. Une panne de synchronisation ou d’acquittement conserve l’attente dans le Coffre. Les opérations de codes attendent toutes leurs écritures, même lorsqu’une écriture sœur échoue, avant de rendre une reprise possible.

L’attente survit à la fermeture, au rechargement et à l’ouverture du même Coffre sur un autre appareil, car elle n’est pas une file locale en clair. La rotation de mot de passe reçoit aussi cet indicateur. `Enregistrer et verrouiller` conserve l’avertissement ; une nouvelle ouverture propose `Réessayer la synchronisation des codes`. Un brouillon plus récent n’est jamais acquitté par une ancienne sauvegarde.

Coût assumé : une synchronisation pleinement réussie effectue deux sauvegardes chiffrées/CAS. Il ne s’agit pas d’une transaction distribuée atomique entre projets. Une concurrence multi-appareil réelle et les Rules distantes restent à recetter.

## Validation du lot

- 25 tests ciblés réussis dans six fichiers : protocole/capture/expiry/session/refus d’alias/libellés stables, émetteur codes-only, récupération différée, sauvegarde/reprise, chiffrement réel du marqueur et repository CAS.
- TypeScript global réussi ; lint ciblé sans avertissement ; `git diff --check` réussi.
- Navigateur : transfert accepté et refusé sur deux origines avec COOP conservé, services fictifs seulement.
- Aucune clôture de la recette Firebase multi-projet ou de la livraison en ligne n’est revendiquée.

Intégration : `useVaultCodeHandoff` fournit `locations`, `people`, `status`, `message`, `connect` et `clear`; `VaultCodeHandoffControl` est un composant séparé. Root a intégré les sélecteurs dans `src/App.tsx`; le lot a ajouté la route de retour et les imports initiaux de capture.
