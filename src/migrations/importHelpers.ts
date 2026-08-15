import type { ProvenancedValue } from '../domain/cartulary.ts';

export const importedProvenance = <T>({
  value,
  sourceId,
  observedAt,
  assertedBy,
}: {
  value: T;
  sourceId: string;
  observedAt: string;
  assertedBy: string;
}): ProvenancedValue<T> => ({
  value,
  proofStatus: 'unverified',
  confidence: 'low',
  sourceRefs: [sourceId],
  observedAt,
  assertedBy,
  visibility: 'secret',
});
