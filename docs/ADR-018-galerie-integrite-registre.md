# ADR-018 — Galerie et intégrité du Registre par lecture des Cartulaires

- Statut : accepté
- Date : 2026-08-16

## Décision

Le Registre ajoute deux vues transverses : `Galerie` et `Intégrité & historique`.

La Galerie affiche une image de présentation par projection active puis ouvre le diaporama autorisé du Cartulaire. Les filtres portent sur le noyau commun et les catégories média. Aucun master, fichier, preuve ou archive n'est copié sous `registries/{registryId}`. Le Registre lit la référence `storagePath` portée par le média du Cartulaire et Firebase Storage n'autorise l'original privé qu'au propriétaire actif. Le repli statique local IWC reste limité aux émulateurs et ne sert qu'en cas d'absence d'original raccordé.

La projection IWC ouvre l'interface Cartulaire complète déjà existante, avec un retour explicite vers le Registre. Les autres verticales continuent d'utiliser la vue générique pilotée par schéma.

La vue Intégrité lit la racine et les `auditEvents` de chaque Cartulaire autorisé. Elle recalcule la chaîne SHA-256, vérifie l'ordre, les liens et la tête, puis restitue l'activité sans copier le journal dans le Registre. Elle présente le pipeline journal chaîné, lot Merkle, horodatage RFC 3161 et ancrage public, en indiquant explicitement que l'ancrage blockchain reste différé.

## Comparaison

Comparer reste un outil ponctuel du Catalogue, déclenché après sélection de deux à quatre Cartulaires. La route privée est conservée, mais l'entrée permanente de navigation est retirée. La comparaison ne porte que sur le noyau projeté commun et n'accorde aucun droit supplémentaire.

## Portée de la preuve

Une chaîne valide rend une altération ultérieure détectable et atteste la cohérence d'un état empreinté. Elle ne prouve pas à elle seule l'authenticité de l'objet, la vérité d'une déclaration, l'identité juridique ou la propriété légale.
