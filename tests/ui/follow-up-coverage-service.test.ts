import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebase = vi.hoisted(() => ({
  listeners: new Map<string, { next: (snapshot: any) => void; fail: (error: Error) => void }>(),
  onSnapshot: vi.fn((reference: { path: string }, _options: unknown, next: (snapshot: any) => void, fail: (error: Error) => void) => {
    firebase.listeners.set(reference.path, { next, fail });
    return () => firebase.listeners.delete(reference.path);
  }),
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  onSnapshot: firebase.onSnapshot,
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
}));
vi.mock('../../src/firebase.ts', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('../../src/services/projections.ts', () => ({ loadRegistryItems: vi.fn() }));

import {
  observeCartularyFollowUpTodos,
  observeRegistryFollowUpsFromItems,
} from '../../src/services/followUp.ts';

const item = (cartularyId: string) => ({
  cartularyId, organizationId: 'org-test', registryId: 'reg-test', collectionId: 'collection-test',
  assetType: 'watch', displayTitle: cartularyId, makerName: 'Maison', modelName: cartularyId,
  referenceCode: null, manufactureYear: null, lifecycleStatus: 'active', possessionStatus: 'held',
  completenessLevel: 'documented', primaryAssetId: null, sourceRevision: 1,
  projectionStatus: 'active' as const, contentHash: `hash-${cartularyId}`,
});

const snapshot = (cartularyId: string, title: string, metadata = { fromCache: false, hasPendingWrites: false }) => ({
  metadata,
  docs: title ? [{
    id: `reminder-${cartularyId}`,
    data: () => ({
      id: `reminder-${cartularyId}`,
      cartularyId,
      organizationId: 'org-test',
      title,
      dueAt: '2026-09-20',
      category: 'insurance',
      reminderStatus: 'active',
      visibility: 'secret',
    }),
  }] : [],
});

beforeEach(() => {
  firebase.listeners.clear();
  firebase.onSnapshot.mockClear();
});

describe('métadonnées et couverture des rappels Firestore', () => {
  it('expose explicitement un écho local afin qu’il ne puisse pas acquitter une opération', () => {
    const received: any[] = [];
    observeCartularyFollowUpTodos('cart-a', (todos, metadata) => received.push({ todos, metadata }));
    firebase.listeners.get('cartularies/cart-a/reminders')?.next(snapshot('cart-a', 'Assurance', {
      fromCache: true,
      hasPendingWrites: true,
    }));

    expect(received).toEqual([{
      todos: [{ id: 'reminder-cart-a', text: 'Assurance', dueAt: '2026-09-20', category: 'insurance', status: 'active' }],
      metadata: { fromCache: true, hasPendingWrites: true },
    }]);
  });

  it('conserve les résultats connus et déclare partiel si un dossier parmi plusieurs échoue', () => {
    const emissions: any[] = [];
    observeRegistryFollowUpsFromItems([item('cart-a'), item('cart-b')], (items, coverage) => {
      emissions.push({ items, coverage });
    });

    expect(emissions.at(-1)?.coverage.state).toBe('loading');
    firebase.listeners.get('cartularies/cart-a/reminders')?.next(snapshot('cart-a', 'Assurance'));
    expect(emissions.at(-1)?.coverage.state).toBe('partial');
    firebase.listeners.get('cartularies/cart-b/reminders')?.fail(new Error('permission-denied'));

    expect(emissions.at(-1)?.coverage).toMatchObject({
      state: 'partial',
      totalCartularies: 2,
      completeCartularies: 1,
      failedCartularies: 1,
    });
    expect(emissions.at(-1)?.items.map((entry: { title: string }) => entry.title)).toEqual(['Assurance']);
  });
});
