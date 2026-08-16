# Vague corrective 6/6 — sécurisation finale de l’interface

Date de recette : 2026-08-16
Périmètre : Cartulaire privé, Watch website, rapport R, panneau Intégrité, liste À faire et visionneuse du Registre.

## Résultat

La vague ferme les reliquats d’interface des vagues 1 à 5 sans modifier la politique de publication ni prétendre qu’un contrôle d’intégrité prouve l’authenticité de l’objet.

- Toute suppression unitaire couverte passe par une confirmation explicite puis offre une annulation pendant 10 secondes.
- Les médias et pièces jointes binaires ne sont rendus définitivement supprimables qu’à l’expiration de cette fenêtre ; une annulation restaure aussi le binaire.
- Les suppressions confirmées et annulées produisent des événements sémantiques dans le journal, sans recopier le libellé potentiellement personnel dans l’événement.
- Les dialogues, tiroirs et visionneuses confinent le focus, se ferment avec Échap et rendent le focus au déclencheur.
- Les formulaires, contrôles de publication, états secondaires et preuves du rapport suivent la langue FR/EN. Les valeurs métier persistées restent stables ; seule leur présentation est traduite.
- Le rapport R distingue explicitement un contenu couvert par le jeton RFC 3161 courant d’un contenu dont l’empreinte a changé depuis l’horodatage.

## Politique de suppression

### Suppressions unitaires

Le mécanisme commun conserve l’élément, son index et, le cas échéant, son binaire. La restauration est idempotente : un deuxième appel d’annulation ne crée pas de doublon.

Surfaces couvertes :

- catégories propriétaire et documents confidentiels ;
- personnes de transmission et lieux de stockage ;
- médias ;
- spécifications, points d’identification et ressources ;
- documentation, rapports et pièces jointes ;
- comparables, analyses, dépenses et évaluations ;
- tâches de la liste À faire.

### Suppression totale du compte local

La purge complète reste volontairement sans annulation : elle exige la saisie de `SUPPRIMER` en français ou `DELETE` en anglais. L’interface précise que cette action n’efface pas rétroactivement les publications déjà émises.

## Accessibilité et clavier

Le hook partagé `useDialogFocus` :

1. mémorise le déclencheur ;
2. place le focus sur le premier contrôle du dialogue ;
3. boucle Tab et Maj+Tab dans la couche active ;
4. traite Échap uniquement pour la couche supérieure ;
5. restaure le focus à la fermeture.

Les boîtes de suppression utilisent `role="alertdialog"`. Les notifications d’annulation utilisent une région dynamique atomique. Le tiroir Intégrité, l’acte de publication, l’éditeur de marché, la revue 360°, la modale média et la visionneuse du Registre utilisent une couche de focus déclarée.

## Langues

La langue choisie reste persistée et pilote toujours `<html lang>`. Sont notamment traduits :

- navigation, audience, formulaires des cinq pages et libellés accessibles ;
- choix dont la valeur technique demeure en français (type de bien, statut, catégories documentaires, états, types de ressources et dépenses) ;
- acte de publication, prérequis, politique et preuve de décision ;
- panneau Intégrité et confirmation de purge ;
- rapport imprimable et preuve RFC 3161.

Les textes saisis par l’utilisateur, les descriptions de démonstration et les événements historiques du journal ne sont pas traduits automatiquement. Cette séparation évite de transformer une donnée probatoire sous couvert de localisation.

## Preuves automatisées

Commandes exécutées avec succès :

- `npm run validate:ai` — 91/91 identifiants reliés ;
- vagues correctives 1 à 6 — 62 tests réussis ;
- `npm run test:registry-views` — 17 tests réussis ;
- `npm run lint` ;
- `npm run build` ;
- `git diff --check`.

La vague 6 ajoute trois contrôles unitaires : conservation de la position, absence d’effet pour un identifiant inconnu et restauration idempotente.

## Recette navigateur

Recette effectuée sur `http://127.0.0.1:5175` :

- la suppression d’une catégorie ouvre un dialogue, place le focus sur sa fermeture, boucle Maj+Tab dans le dialogue et rend le focus au bouton d’origine après annulation ;
- une suppression confirmée réduit la collection et affiche la notification d’annulation ;
- une tâche a été supprimée puis restaurée dans le navigateur, y compris après réouverture de la liste ;
- l’acte R en anglais a été fermé avec Échap, puis validé : le rapport a affiché un bloc, une date anglaise et la preuve d’intégrité en anglais ; la sélection de test a ensuite été révoquée ;
- le rapport a correctement indiqué « Content not yet covered by a third-party timestamp » lorsque le reçu existant ne couvrait plus l’empreinte courante ;
- la purge complète a placé le focus dans le champ de confirmation, exigé `DELETE` et été annulée ;
- à 390 px, `documentElement.scrollWidth === documentElement.clientWidth === 390` sur Accueil et Valorisation ; les grandes tables conservent un défilement interne borné ;
- état final : `#cover`, langue `fr`, audience `Secret`, aucun dialogue ouvert, zéro bloc R sélectionné, cinq catégories propriétaire restaurées avec leurs identifiants de démonstration d’origine et tâche de démonstration présente.

## Limites et risques assumés

> **Avertissement — persistance, publication et intégrité.** Toute évolution ultérieure du délai d’annulation, des tombstones binaires, du contenu canonique, des projections W/C/R ou des événements du journal nécessite une migration testée. Une modification isolée du client pourrait sinon faire réapparaître un contenu supprimé, invalider une décision de publication ou rendre un reçu d’horodatage inapplicable à la révision courante.

- La purge totale n’est pas annulable après confirmation ; c’est une décision produit explicite.
- Les contenus libres ne sont pas traduits automatiquement.
- La recette a vérifié le DOM imprimable, pas l’interface native de prévisualisation d’impression du navigateur.
- Aucun nouvel horodatage tiers n’a été demandé pendant cette recette.
- Aucun déploiement Firebase, aucune écriture de règles et aucune publication de production n’ont été effectués.
