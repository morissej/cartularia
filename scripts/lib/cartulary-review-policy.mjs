// Politique de revue d'un Cartulaire (P-C5, V5 lot A). Module pur, sans import : partagé par le
// client (tableau de bord et catalogue du Registre) et, au lot B, par la commande de synchronisation.
// Une seule définition du signal « à revoir » ; le compteur, le filtre et l'explication en dérivent.

/**
 * Signal « à revoir » (ADR-010) : état initial `review` posé à la création, ou données `imported_unreviewed`
 * non encore revues par le propriétaire. Un objet reçu par cession est `active` mais reste `imported_unreviewed`,
 * d'où la disjonction : le statut seul ne suffit pas.
 */
export const cartularyNeedsReview = (record) => record?.lifecycleStatus === 'review'
  || record?.completenessLevel === 'imported_unreviewed';
