# ADR-015 — Comparaison du Registre par liste blanche

Date : 16 août 2026
Statut : adopté et implémenté localement

## Décision

La comparaison R7 est calculée côté interface à partir des projections privées déjà chargées sous `registries/{registryId}/items`. Elle ne lit pas les Cartulaires maîtres, ne crée pas de projection comparative supplémentaire et ne persiste aucun résultat.

Une liste blanche explicite définit les onze critères affichables. Ajouter un champ à `RegistryItemProjection` ne l’ajoute donc pas automatiquement à la matrice. Toute extension doit modifier volontairement la liste blanche et ses tests de non-divulgation.

## Autorisation et URL

L’URL transporte au maximum quatre identifiants opaques. Ils servent uniquement à ordonner une intention de comparaison. Après chargement, les identifiants sont rapprochés des projections actives effectivement retournées par Firestore ; une référence inconnue, retirée ou non autorisée est écartée.

La comparaison ne contourne donc ni `registry.read`, ni la portée du membership. Elle n’accorde aucun droit supplémentaire sur le Cartulaire et n’utilise jamais les paramètres de l’URL comme source d’autorisation.

## Noyau multi-actifs

La matrice compare le noyau commun : type, collection, identité synthétique, cycle de vie, possession, complétude et révision. Elle peut ainsi rapprocher des verticales différentes sans supposer qu’une montre, une automobile, une œuvre ou un bien immobilier possèdent les mêmes champs métier détaillés.

Les comparaisons verticales spécialisées restent dans leur Cartulaire ou dans une future projection explicitement versionnée. R7 n’invente pas d’équivalence entre calibre, moteur, cépage, artiste ou données immobilières.

## Données exclues

R7 ne lit et ne copie aucun média, original, archive, document, preuve, propriétaire, stockage, acquisition, valeur, dépense, adresse, jeton d’accès, empreinte de contenu ou identifiant interne d’organisation. Le lien vers le Cartulaire est une navigation, pas une incorporation de ses données.

## Persistance

La sélection reste dans l’URL. Elle n’est ni un enregistrement métier ni une préférence durable. Une future fonction de vues enregistrées devra disposer de son propre contrat d’autorisation et d’une persistance serveur ; elle n’est pas implicitement créée par cette décision.
