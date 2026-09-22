import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import type {
  CartularyFollowUpTodo,
  CartularyFollowUpWriteInput,
  CartularyReminderDocument,
  FollowUpCategory,
  FollowUpSourceStatus,
  RegistryFollowUpItem,
} from '../domain/followUp.ts';
import type { RegistryItemProjection } from '../domain/projections.ts';
import { auth, db } from '../firebase.ts';
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

const reminderDate = (value: CartularyReminderDocument['dueAt']) => {
  if (typeof value === 'string') return value.slice(0, 10);
  const timestamp = value as CartularyReminderDocument['dueAt'] & { toDate?: () => Date };
  if (timestamp && typeof timestamp === 'object' && typeof timestamp.toDate === 'function') {
    return timestamp.toDate().toISOString().slice(0, 10);
  }
  if (value && typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000).toISOString().slice(0, 10);
  }
  return '';
};

const reminderToTodo = (
  cartularyId: string,
  reminderId: string,
  reminder: CartularyReminderDocument,
): CartularyFollowUpTodo | null => {
  if (reminder.visibility !== 'secret' || reminder.cartularyId !== cartularyId) return null;
  return {
    id: reminder.id || reminderId,
    text: reminder.title,
    dueAt: reminderDate(reminder.dueAt),
    category: reminder.category && FOLLOW_UP_CATEGORIES.has(reminder.category) ? reminder.category : 'custom',
    status: normalizeSourceStatus(reminder.reminderStatus),
  };
};

export const loadCartularyFollowUpTodos = async (cartularyId: string): Promise<CartularyFollowUpTodo[]> => {
  const snapshot = await getDocs(collection(db, 'cartularies', cartularyId, 'reminders'));
  return snapshot.docs.flatMap((reminderSnapshot) => {
    const reminder = reminderSnapshot.data() as CartularyReminderDocument;
    const todo = reminderToTodo(cartularyId, reminderSnapshot.id, reminder);
    return todo ? [todo] : [];
  });
};

export interface FollowUpSnapshotMetadata {
  hasPendingWrites: boolean;
  fromCache: boolean;
}

export const observeCartularyFollowUpTodos = (
  cartularyId: string,
  onTodos: (todos: CartularyFollowUpTodo[], metadata: FollowUpSnapshotMetadata) => void,
  onError?: (error: Error) => void,
) => onSnapshot(collection(db, 'cartularies', cartularyId, 'reminders'), { includeMetadataChanges: true }, (snapshot) => {
  onTodos(snapshot.docs.flatMap((reminderSnapshot) => {
    const reminder = reminderSnapshot.data() as CartularyReminderDocument;
    const todo = reminderToTodo(cartularyId, reminderSnapshot.id, reminder);
    return todo ? [todo] : [];
  }), {
    hasPendingWrites: snapshot.metadata.hasPendingWrites,
    fromCache: snapshot.metadata.fromCache,
  });
}, (error) => onError?.(error));

const loadCartularyWriteContext = async (cartularyId: string) => {
  const snapshot = await getDoc(doc(db, 'cartularies', cartularyId));
  if (!snapshot.exists()) throw new Error('Cartulaire introuvable.');
  const data = snapshot.data() as { organizationId?: unknown; registryId?: unknown };
  if (typeof data.organizationId !== 'string' || typeof data.registryId !== 'string') {
    throw new Error('Contexte du Cartulaire incomplet.');
  }
  return { organizationId: data.organizationId, registryId: data.registryId };
};

export const createCartularyFollowUpTodo = async (
  cartularyId: string,
  todo: CartularyFollowUpWriteInput,
) => {
  const user = auth.currentUser;
  if (!user) throw new Error('Connexion requise pour enregistrer ce suivi.');
  const { organizationId } = await loadCartularyWriteContext(cartularyId);
  await setDoc(doc(db, 'cartularies', cartularyId, 'reminders', todo.id), {
    id: todo.id,
    cartularyId,
    organizationId,
    title: todo.text.trim(),
    dueAt: todo.dueAt,
    category: todo.category,
    reminderStatus: todo.status,
    visibility: 'secret',
    source: todo.source,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const updateCartularyFollowUpTodo = async (
  cartularyId: string,
  reminderId: string,
  patch: Partial<Pick<CartularyFollowUpTodo, 'text' | 'dueAt' | 'category' | 'status'>>,
) => {
  const data: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.text !== undefined) data.title = patch.text.trim();
  if (patch.dueAt !== undefined) data.dueAt = patch.dueAt;
  if (patch.category !== undefined) data.category = patch.category;
  if (patch.status !== undefined) data.reminderStatus = patch.status;
  await updateDoc(doc(db, 'cartularies', cartularyId, 'reminders', reminderId), data);
};

/**
 * Replays a durable local upsert without changing the original creation audit
 * fields when the reminder already exists. The returned promise resolves only
 * once Firestore has acknowledged the selected server write.
 */
export const syncCartularyFollowUpTodo = async (
  cartularyId: string,
  todo: CartularyFollowUpWriteInput,
) => {
  const reminder = await getDoc(doc(db, 'cartularies', cartularyId, 'reminders', todo.id));
  if (!reminder.exists()) {
    await createCartularyFollowUpTodo(cartularyId, todo);
    return;
  }
  await updateCartularyFollowUpTodo(cartularyId, todo.id, {
    text: todo.text,
    dueAt: todo.dueAt,
    category: todo.category,
    status: todo.status,
  });
};

export const deleteCartularyFollowUpTodo = (
  cartularyId: string,
  reminderId: string,
) => deleteDoc(doc(db, 'cartularies', cartularyId, 'reminders', reminderId));

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

export type RegistryFollowUpCoverageState = 'loading' | 'partial' | 'ready' | 'error';

export interface RegistryFollowUpCoverage {
  state: RegistryFollowUpCoverageState;
  totalCartularies: number;
  completeCartularies: number;
  partialCartularies: number;
  loadingCartularies: number;
  failedCartularies: number;
}

type CartularyFollowUpLoadState = 'loading' | 'partial' | 'ready' | 'error';

export const observeRegistryFollowUpsFromItems = (
  items: RegistryItemProjection[],
  onItems: (items: RegistryFollowUpItem[], coverage: RegistryFollowUpCoverage) => void,
  onError?: (error: Error) => void,
) => {
  const activeItems = [...new Map(items
    .filter((item) => item.projectionStatus === 'active')
    .map((item) => [item.cartularyId, item])).values()];
  if (activeItems.length === 0) {
    onItems([], {
      state: 'ready',
      totalCartularies: 0,
      completeCartularies: 0,
      partialCartularies: 0,
      loadingCartularies: 0,
      failedCartularies: 0,
    });
    return () => undefined;
  }
  const remindersByCartulary = new Map<string, RegistryFollowUpItem[]>();
  const states = new Map<string, CartularyFollowUpLoadState>(
    activeItems.map((item) => [item.cartularyId, 'loading']),
  );
  const coverage = (): RegistryFollowUpCoverage => {
    const values = [...states.values()];
    const completeCartularies = values.filter((state) => state === 'ready').length;
    const partialCartularies = values.filter((state) => state === 'partial').length;
    const loadingCartularies = values.filter((state) => state === 'loading').length;
    const failedCartularies = values.filter((state) => state === 'error').length;
    const state: RegistryFollowUpCoverageState = completeCartularies === values.length
      ? 'ready'
      : failedCartularies === values.length
        ? 'error'
        : loadingCartularies === values.length
          ? 'loading'
          : 'partial';
    return {
      state,
      totalCartularies: values.length,
      completeCartularies,
      partialCartularies,
      loadingCartularies,
      failedCartularies,
    };
  };
  const emit = () => onItems(
    activeItems.flatMap((item) => remindersByCartulary.get(item.cartularyId) || []),
    coverage(),
  );
  emit();
  const unsubscribes = activeItems.map((item) => onSnapshot(
    collection(db, 'cartularies', item.cartularyId, 'reminders'),
    { includeMetadataChanges: true },
    (snapshot) => {
      remindersByCartulary.set(item.cartularyId, snapshot.docs.flatMap((reminderSnapshot) => {
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
      }));
      states.set(item.cartularyId, snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites ? 'partial' : 'ready');
      emit();
    },
    (error) => {
      states.set(item.cartularyId, 'error');
      emit();
      onError?.(error);
    },
  ));
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
};

export const loadRegistryFollowUps = async (registryId: string): Promise<RegistryFollowUpItem[]> => {
  const items = await loadRegistryItems(registryId);
  return loadRegistryFollowUpsFromItems(items);
};
