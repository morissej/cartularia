import type { FirestoreTimestampValue } from './foundations.ts';

export type FollowUpCategory = 'insurance' | 'visual_evidence' | 'maintenance' | 'custom';
export type FollowUpSourceStatus = 'planned' | 'active' | 'completed' | 'dismissed';

export interface CartularyFollowUpTodo {
  id: string;
  text: string;
  dueAt: string;
  category: FollowUpCategory;
  status: FollowUpSourceStatus;
}

export const mergeCartularyFollowUpTodos = (
  remoteTodos: CartularyFollowUpTodo[],
  localTodos: CartularyFollowUpTodo[],
) => {
  const merged = new Map(remoteTodos.map((todo) => [todo.id, todo]));
  for (const todo of localTodos) merged.set(todo.id, todo);
  return [...merged.values()];
};

export interface CartularyReminderDocument {
  id: string;
  cartularyId: string;
  organizationId: string;
  title: string;
  category?: FollowUpCategory;
  dueAt: string | FirestoreTimestampValue;
  reminderStatus: string;
  visibility: 'secret';
  source?: 'cartulary' | 'registry';
  createdBy?: string;
  createdAt?: FirestoreTimestampValue;
  updatedAt?: FirestoreTimestampValue;
}

export interface CartularyFollowUpWriteInput extends CartularyFollowUpTodo {
  source: 'cartulary' | 'registry';
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
