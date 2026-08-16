import { collection, getDocs } from 'firebase/firestore';
import type {
  CartularyReminderDocument,
  FollowUpCategory,
  FollowUpSourceStatus,
  RegistryFollowUpItem,
} from '../domain/followUp.ts';
import type { RegistryItemProjection } from '../domain/projections.ts';
import { db } from '../firebase.ts';
import { loadRegistryItems } from './projections.ts';

const FOLLOW_UP_CATEGORIES = new Set<FollowUpCategory>([
  'insurance',
  'visual_evidence',
  'maintenance',
  'custom',
]);

const normalizeSourceStatus = (value: string): FollowUpSourceStatus => {
  if (['completed', 'done'].includes(value)) return 'completed';
  if (['dismissed', 'cancelled', 'canceled'].includes(value)) return 'dismissed';
  if (value === 'active') return 'active';
  return 'planned';
};

const loadCartularyReminders = async (
  item: RegistryItemProjection,
): Promise<RegistryFollowUpItem[]> => {
  const snapshot = await getDocs(collection(db, 'cartularies', item.cartularyId, 'reminders'));
  return snapshot.docs.flatMap((reminderSnapshot) => {
    const reminder = reminderSnapshot.data() as CartularyReminderDocument;
    if (reminder.visibility !== 'secret' || reminder.cartularyId !== item.cartularyId) return [];
    return [{
      id: reminder.id || reminderSnapshot.id,
      cartularyId: item.cartularyId,
      organizationId: item.organizationId,
      registryId: item.registryId,
      collectionId: item.collectionId,
      assetType: item.assetType,
      displayTitle: item.displayTitle,
      title: reminder.title,
      category: reminder.category && FOLLOW_UP_CATEGORIES.has(reminder.category) ? reminder.category : 'custom',
      dueAt: reminder.dueAt,
      reminderStatus: normalizeSourceStatus(reminder.reminderStatus),
      visibility: 'secret',
    } satisfies RegistryFollowUpItem];
  });
};

export const loadRegistryFollowUpsFromItems = async (
  items: RegistryItemProjection[],
): Promise<RegistryFollowUpItem[]> => {
  const activeItems = items.filter((item) => item.projectionStatus === 'active');
  const reminders = await Promise.all(activeItems.map(loadCartularyReminders));
  return reminders.flat();
};

export const loadRegistryFollowUps = async (registryId: string): Promise<RegistryFollowUpItem[]> => {
  const items = await loadRegistryItems(registryId);
  return loadRegistryFollowUpsFromItems(items);
};
