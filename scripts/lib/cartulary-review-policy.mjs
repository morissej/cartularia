// Politique de revue d'un Cartulaire (P-C5, V5 lots A et B). Module pur, sans import : partagé par le
// client (tableau de bord et catalogue du Registre, bloc « Revue du propriétaire ») et par la commande de
// synchronisation (`syncCartularyToRegistry`). Une seule définition du signal « à revoir » ; le compteur,
// le filtre, l'explication, la décision de revue et son application en dérivent.

/**
 * Signal « à revoir » (ADR-010) : état initial `review` posé à la création, ou données `imported_unreviewed`
 * non encore revues par le propriétaire. Un objet reçu par cession est `active` mais reste `imported_unreviewed`,
 * d'où la disjonction : le statut seul ne suffit pas.
 */
export const cartularyNeedsReview = (record) => record?.lifecycleStatus === 'review'
  || record?.completenessLevel === 'imported_unreviewed';

/** Clé de brouillon portant la décision de revue : motif `^cartularia-[A-Za-z0-9:_-]+$` des règles, hors clés personnelles. */
export const REVIEW_STATE_KEY = 'cartularia-review';
/** Genre du marqueur `cartularia-generic-operation` traité par la synchronisation, aux côtés de `media` et `sections`. */
export const REVIEW_OPERATION_KIND = 'review';
/** Paliers posés par une revue (D2 (b)) : « Revue partielle » (`partial`, défaut) ou « Dossier complet » (`complete`). */
export const CARTULARY_REVIEW_LEVELS = Object.freeze(['partial', 'complete']);

const REVIEW_DECISION_SOURCE = 'human_confirmed';
const REVIEW_DECISION_KEYS = Object.freeze(['version', 'baseRevision', 'level', 'decisionSource']);
/** Cycles de vie sur lesquels la revue n'est pas admise : l'objet n'est plus sous la main de son propriétaire éditeur. */
const REVIEW_INACTIVE_LIFECYCLES = Object.freeze(['suspended', 'transferred', 'archived']);

/** Erreur codée de la politique (motif `GenericSectionsError`) : le code est recopié dans `errorCode` de la demande. */
export class CartularyReviewError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CartularyReviewError';
    this.code = code;
  }
}

/** Décision écrite par le client sous `cartularia-review` : la révision lue et le palier choisi, jamais de date. */
export const buildCartularyReviewDecision = ({ baseRevision, level }) => ({
  version: 1,
  baseRevision,
  level,
  decisionSource: REVIEW_DECISION_SOURCE,
});

/** Relecture stricte de la décision : toute clé étrangère, version, palier ou source inconnus → `invalid_review`. */
export const parseCartularyReviewDecision = (value) => {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).some((key) => !REVIEW_DECISION_KEYS.includes(key))
    || value.version !== 1
    || !Number.isInteger(value.baseRevision)
    || !CARTULARY_REVIEW_LEVELS.includes(value.level)
    || value.decisionSource !== REVIEW_DECISION_SOURCE
  ) {
    throw new CartularyReviewError('invalid_review', 'La décision de revue est invalide.');
  }
  return { version: 1, baseRevision: value.baseRevision, level: value.level, decisionSource: REVIEW_DECISION_SOURCE };
};

/**
 * Champs de la racine posés par une revue confirmée. Sémantique de `generic-sections-command.mjs` : la décision
 * doit viser la révision courante (`revision_conflict`) ; un objet suspendu, cédé ou archivé n'est pas revu
 * (`review_not_allowed`). `occurredAt` est l'heure serveur de la synchronisation : aucune date venue du client.
 */
export const cartularyReviewRootPatch = ({ root, decision, occurredAt }) => {
  if (!root || !Number.isInteger(decision?.baseRevision) || decision.baseRevision !== root.revision) {
    throw new CartularyReviewError('revision_conflict', 'Le Cartulaire a changé. Rechargez les données avant de confirmer la revue.');
  }
  if (REVIEW_INACTIVE_LIFECYCLES.includes(root.lifecycleStatus)) {
    throw new CartularyReviewError('review_not_allowed', 'Ce Cartulaire est suspendu, cédé ou archivé : la revue n’est pas admise.');
  }
  return { lifecycleStatus: 'active', completenessLevel: decision.level, lastVerifiedAt: occurredAt };
};

/**
 * État de revue affiché par le Cartulaire : `pending` tant que le signal est levé, sinon `reviewed` avec la date et le
 * palier ; `actionable` dit si le propriétaire éditeur peut (re)confirmer la revue sur ce cycle de vie.
 */
export const deriveCartularyReviewState = (record) => {
  const actionable = !REVIEW_INACTIVE_LIFECYCLES.includes(record?.lifecycleStatus);
  if (cartularyNeedsReview(record)) return { kind: 'pending', actionable };
  return { kind: 'reviewed', reviewedAt: record?.lastVerifiedAt ?? null, level: record?.completenessLevel ?? null, actionable };
};
