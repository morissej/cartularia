# Runbook — Privacy, conservation et suppression

## Principes applicables

- Secret par défaut et minimisation des données.
- Absence physique des champs personnels dans les projections publiques ou communautaires.
- Identité communautaire pseudonyme séparée du compte privé.
- Écritures patrimoniales uniquement par commandes serveur.
- Sauvegardes chiffrées, accès journalisé et durée limitée.

## Décision produit appliquée à la copie privée

- Les données du compte sont conservées tant que le compte est actif.
- Le passage explicite du compte à `inactive` fixe `purgeAfter` à deux années calendaires après `inactiveAt`.
- L’utilisateur peut supprimer immédiatement le coffre local et sa copie privée cloud depuis le panneau Intégrité. Une confirmation textuelle est exigée.
- La tâche `npm run retention:private` fait d’abord un dry-run. L’exécution exige `--execute`; à distance elle exige aussi `--allow-remote --confirm-private-purge`.
- La vague 2 purge les brouillons privés synchronisés et leurs originaux Storage. Les Cartulaires autoritaires, publications W/C/R et sauvegardes suivent leurs procédures propres : il serait dangereux de les effacer par simple déduction d’un uid.

## Revue avant mise en service

1. Associer chaque catégorie de `config/retention-matrix.json` à une base juridique, une durée et un propriétaire.
2. Confirmer les pays de résidence et la région Firestore/Storage.
3. Évaluer le chiffrement applicatif des adresses précises, identités et données de succession.
4. Définir accès, rectification, export, fermeture de compte, gel juridique et suppression/cascade.
5. Tester qu’une suppression logique traite les sous-collections selon la matrice et n’efface pas abusivement un journal soumis à conservation.
6. Vérifier les sous-traitants, transferts, contrats et procédure d’incident.

La durée de deux ans est une décision produit intégrée. Elle ne vaut ni validation juridique ni décision sur les actes publiés, les obligations probatoires et les sauvegardes ; le gate de production demeure bloqué jusqu’à cette revue.
