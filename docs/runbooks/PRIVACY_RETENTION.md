# Runbook — Privacy, conservation et suppression

## Principes applicables

- Secret par défaut et minimisation des données.
- Absence physique des champs personnels dans les projections publiques ou communautaires.
- Identité communautaire pseudonyme séparée du compte privé.
- Écritures patrimoniales uniquement par commandes serveur.
- Sauvegardes chiffrées, accès journalisé et durée limitée.

## Revue avant mise en service

1. Associer chaque catégorie de `config/retention-matrix.json` à une base juridique, une durée et un propriétaire.
2. Confirmer les pays de résidence et la région Firestore/Storage.
3. Évaluer le chiffrement applicatif des adresses précises, identités et données de succession.
4. Définir accès, rectification, export, fermeture de compte, gel juridique et suppression/cascade.
5. Tester qu’une suppression logique traite les sous-collections selon la matrice et n’efface pas abusivement un journal soumis à conservation.
6. Vérifier les sous-traitants, transferts, contrats et procédure d’incident.

Tant qu’une ligne obligatoire reste `pending_legal_review`, le gate de production demeure bloqué.
