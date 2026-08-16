import type { RegistryItemProjection } from '../../domain/projections.ts';

export interface RegistryAggregateCount {
  key: string;
  count: number;
}

export interface RegistryAttentionSummary {
  review: number;
  suspended: number;
  sensitivePossession: number;
  total: number;
}

export interface RegistryAggregateSummary {
  total: number;
  collectionCount: number;
  assetTypeCount: number;
  needsReviewCount: number;
  byAssetType: RegistryAggregateCount[];
  byCollection: RegistryAggregateCount[];
  byLifecycle: RegistryAggregateCount[];
  byCompleteness: RegistryAggregateCount[];
  attention: RegistryAttentionSummary;
  recentItems: RegistryItemProjection[];
}

const countBy = (items: RegistryItemProjection[], readKey: (item: RegistryItemProjection) => string) => {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = readKey(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key, 'fr'));
};

const timestampValue = (item: RegistryItemProjection) => item.updatedAt
  ? item.updatedAt.seconds * 1_000 + item.updatedAt.nanoseconds / 1_000_000
  : item.sourceRevision;

export const buildRegistryAggregates = (sourceItems: RegistryItemProjection[]): RegistryAggregateSummary => {
  const items = sourceItems.filter((item) => item.projectionStatus === 'active');
  const reviewItems = items.filter((item) => (
    item.lifecycleStatus === 'review'
    || item.completenessLevel === 'imported_unreviewed'
  ));
  const suspended = items.filter((item) => item.lifecycleStatus === 'suspended').length;
  const sensitivePossession = items.filter((item) => ['lost', 'stolen', 'destroyed'].includes(item.possessionStatus)).length;

  return {
    total: items.length,
    collectionCount: new Set(items.map((item) => item.collectionId)).size,
    assetTypeCount: new Set(items.map((item) => item.assetType)).size,
    needsReviewCount: reviewItems.length,
    byAssetType: countBy(items, (item) => item.assetType),
    byCollection: countBy(items, (item) => item.collectionId),
    byLifecycle: countBy(items, (item) => item.lifecycleStatus),
    byCompleteness: countBy(items, (item) => item.completenessLevel),
    attention: {
      review: reviewItems.length,
      suspended,
      sensitivePossession,
      total: reviewItems.length + suspended + sensitivePossession,
    },
    recentItems: [...items]
      .sort((left, right) => timestampValue(right) - timestampValue(left)
        || left.displayTitle.localeCompare(right.displayTitle, 'fr', { sensitivity: 'base' }))
      .slice(0, 4),
  };
};
