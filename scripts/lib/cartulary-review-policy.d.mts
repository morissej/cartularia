export type CartularyReviewLevel = 'partial' | 'complete';

export interface CartularyReviewDecision {
  version: 1;
  baseRevision: number;
  level: CartularyReviewLevel;
  decisionSource: 'human_confirmed';
}

export type CartularyReviewState =
  | { kind: 'pending'; actionable: boolean }
  | { kind: 'reviewed'; reviewedAt: string | null; level: string | null; actionable: boolean };

export function cartularyNeedsReview(
  record: { lifecycleStatus?: string | null; completenessLevel?: string | null } | null | undefined,
): boolean;

export const REVIEW_STATE_KEY: 'cartularia-review';
export const REVIEW_OPERATION_KIND: 'review';
export const CARTULARY_REVIEW_LEVELS: readonly CartularyReviewLevel[];

export class CartularyReviewError extends Error {
  code: 'invalid_review' | 'revision_conflict' | 'review_not_allowed';
  constructor(code: string, message: string);
}

export function buildCartularyReviewDecision(input: { baseRevision: number; level: CartularyReviewLevel }): CartularyReviewDecision;

export function parseCartularyReviewDecision(value: unknown): CartularyReviewDecision;

export function cartularyReviewRootPatch(input: {
  root: { revision?: number | null; lifecycleStatus?: string | null } | null | undefined;
  decision: CartularyReviewDecision;
  occurredAt: string;
}): { lifecycleStatus: 'active'; completenessLevel: CartularyReviewLevel; lastVerifiedAt: string };

export function deriveCartularyReviewState(
  record: { lifecycleStatus?: string | null; completenessLevel?: string | null; lastVerifiedAt?: string | null } | null | undefined,
): CartularyReviewState;
