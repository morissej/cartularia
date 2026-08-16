import type { FollowUpCategory, RegistryFollowUpItem } from '../../domain/followUp.ts';

export type FollowUpTimeStatus = 'overdue' | 'due_soon' | 'scheduled' | 'completed';

export interface RegistryFollowUpFilters {
  query: string;
  timeStatus: 'all' | FollowUpTimeStatus;
  category: 'all' | FollowUpCategory;
  collectionId: string;
}

export interface RegistryFollowUpSummary {
  total: number;
  overdue: number;
  dueSoon: number;
  scheduled: number;
  completed: number;
}

export const DEFAULT_REGISTRY_FOLLOW_UP_FILTERS: RegistryFollowUpFilters = {
  query: '',
  timeStatus: 'all',
  category: 'all',
  collectionId: 'all',
};

const normalize = (value: string | null | undefined) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('fr');

export const followUpDate = (item: RegistryFollowUpItem): Date => {
  if (typeof item.dueAt === 'string') return new Date(item.dueAt);
  return new Date(item.dueAt.seconds * 1_000 + item.dueAt.nanoseconds / 1_000_000);
};

const startOfUtcDay = (value: Date) => Date.UTC(
  value.getUTCFullYear(),
  value.getUTCMonth(),
  value.getUTCDate(),
);

export const deriveFollowUpTimeStatus = (
  item: RegistryFollowUpItem,
  now = new Date(),
): FollowUpTimeStatus => {
  if (['completed', 'dismissed'].includes(item.reminderStatus)) return 'completed';
  const dueDay = startOfUtcDay(followUpDate(item));
  const today = startOfUtcDay(now);
  if (dueDay < today) return 'overdue';
  if (dueDay <= today + 30 * 86_400_000) return 'due_soon';
  return 'scheduled';
};

export const buildRegistryFollowUpSummary = (
  items: RegistryFollowUpItem[],
  now = new Date(),
): RegistryFollowUpSummary => {
  const statuses = items.map((item) => deriveFollowUpTimeStatus(item, now));
  return {
    total: items.length,
    overdue: statuses.filter((status) => status === 'overdue').length,
    dueSoon: statuses.filter((status) => status === 'due_soon').length,
    scheduled: statuses.filter((status) => status === 'scheduled').length,
    completed: statuses.filter((status) => status === 'completed').length,
  };
};

export const filterAndSortRegistryFollowUps = (
  items: RegistryFollowUpItem[],
  filters: RegistryFollowUpFilters,
  now = new Date(),
): RegistryFollowUpItem[] => {
  const tokens = normalize(filters.query).split(/\s+/).filter(Boolean);
  const filtered = items.filter((item) => {
    const timeStatus = deriveFollowUpTimeStatus(item, now);
    if (filters.timeStatus !== 'all' && filters.timeStatus !== timeStatus) return false;
    if (filters.category !== 'all' && filters.category !== item.category) return false;
    if (filters.collectionId !== 'all' && filters.collectionId !== item.collectionId) return false;
    const haystack = normalize([
      item.title,
      item.displayTitle,
      item.assetType,
      item.collectionId,
      item.category,
    ].join(' '));
    return tokens.every((token) => haystack.includes(token));
  });

  return [...filtered].sort((left, right) => {
    const leftStatus = deriveFollowUpTimeStatus(left, now);
    const rightStatus = deriveFollowUpTimeStatus(right, now);
    const statusOrder: Record<FollowUpTimeStatus, number> = {
      overdue: 0,
      due_soon: 1,
      scheduled: 2,
      completed: 3,
    };
    return statusOrder[leftStatus] - statusOrder[rightStatus]
      || followUpDate(left).getTime() - followUpDate(right).getTime()
      || left.title.localeCompare(right.title, 'fr', { sensitivity: 'base' });
  });
};
