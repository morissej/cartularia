import type { FirestoreTimestampValue } from './foundations.ts';

export type FollowUpCategory = 'insurance' | 'visual_evidence' | 'maintenance' | 'custom';
export type FollowUpSourceStatus = 'planned' | 'active' | 'completed' | 'dismissed';

export interface CartularyReminderDocument {
  id: string;
  cartularyId: string;
  organizationId: string;
  title: string;
  category?: FollowUpCategory;
  dueAt: string | FirestoreTimestampValue;
  reminderStatus: string;
  visibility: 'secret';
  createdAt?: FirestoreTimestampValue;
  updatedAt?: FirestoreTimestampValue;
}

export interface RegistryFollowUpItem {
  id: string;
  cartularyId: string;
  organizationId: string;
  registryId: string;
  collectionId: string;
  assetType: string;
  displayTitle: string;
  title: string;
  category: FollowUpCategory;
  dueAt: string | FirestoreTimestampValue;
  reminderStatus: FollowUpSourceStatus;
  visibility: 'secret';
}
