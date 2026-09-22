import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  itemNext: null as null | ((items: any[]) => void),
  itemFail: null as null | ((error: Error) => void),
  listeners: new Map<string, { next: (snapshot: any) => void; fail: (error: Error) => void }>(),
  getDocs: vi.fn(),
  verify: vi.fn(),
  activeReads: 0,
  maximumReads: 0,
}));

vi.mock('firebase/firestore', () => ({
  collection: (parent: { path?: string }, ...segments: string[]) => ({
    path: [parent?.path, ...segments].filter(Boolean).join('/'),
  }),
  doc: (parent: { path?: string }, ...segments: string[]) => ({
    path: [parent?.path, ...segments].filter(Boolean).join('/'),
  }),
  getDoc: vi.fn(),
  getDocs: (...args: unknown[]) => mocks.getDocs(...args),
  onSnapshot: (reference: { path: string }, next: (snapshot: any) => void, fail: (error: Error) => void) => {
    mocks.listeners.set(reference.path, { next, fail });
    return () => mocks.listeners.delete(reference.path);
  },
  orderBy: vi.fn(() => ({})),
  query: (reference: { path: string }) => reference,
}));
vi.mock('../../src/firebase.ts', () => ({ db: {} }));
vi.mock('../../src/services/projections.ts', () => ({
  loadRegistryItems: vi.fn(),
  observeRegistryItems: (_registryId: string, next: (items: any[]) => void, fail: (error: Error) => void) => {
    mocks.itemNext = next;
    mocks.itemFail = fail;
    return () => { mocks.itemNext = null; mocks.itemFail = null; };
  },
}));
vi.mock('../../src/utils/auditChain.ts', () => ({
  verifyRegistryAuditChain: (...args: unknown[]) => mocks.verify(...args),
}));

import {
  REGISTRY_INTEGRITY_CONCURRENCY,
  observeRegistryIntegrity,
} from '../../src/services/registryIntegrity.ts';

const registryItem = (index: number) => ({
  cartularyId: `cart-${String(index).padStart(3, '0')}`,
  organizationId: 'org-test',
  registryId: 'reg-test',
  collectionId: 'collection-test',
  assetType: 'watch',
  displayTitle: `Objet ${index}`,
  makerName: 'Maison',
  modelName: `Modèle ${index}`,
  referenceCode: null,
  manufactureYear: null,
  lifecycleStatus: 'active',
  possessionStatus: 'held',
  completenessLevel: 'documented',
  primaryAssetId: null,
  sourceRevision: 1,
  projectionStatus: 'active',
  contentHash: `hash-${index}`,
});

const rootSnapshot = (cartularyId: string, sequence = 1) => ({
  exists: () => true,
  data: () => ({
    id: cartularyId,
    revision: sequence,
    integrityHead: `sha256:${cartularyId}:${sequence}`,
    integritySequence: sequence,
  }),
});

const projectionSnapshot = (data?: Record<string, unknown>) => ({
  exists: () => Boolean(data),
  data: () => data,
});

const eventSnapshot = (path: string) => ({
  docs: [{
    id: `event-${path}`,
    data: () => ({
      eventId: `event-${path}`,
      cartularyId: path.split('/')[1],
      sequence: 1,
      occurredAtIso: '2026-09-21T00:00:00.000Z',
      actor: {},
      action: 'update',
      resource: {},
      beforeDigest: null,
      afterDigest: 'sha256:after',
      previousEventHash: `sha256:${'0'.repeat(64)}`,
      canonicalizationVersion: 'jcs-1',
      requestId: 'request-test',
      hash: 'sha256:event',
    }),
  }],
});

const emitProjectionAndRoot = (item: ReturnType<typeof registryItem>, sequence = 1) => {
  mocks.listeners.get(`integrityProjections/${item.cartularyId}`)?.next(projectionSnapshot());
  mocks.listeners.get(`cartularies/${item.cartularyId}`)?.next(rootSnapshot(item.cartularyId, sequence));
};

beforeEach(() => {
  mocks.itemNext = null;
  mocks.itemFail = null;
  mocks.listeners.clear();
  mocks.activeReads = 0;
  mocks.maximumReads = 0;
  mocks.getDocs.mockReset();
  mocks.verify.mockReset();
  mocks.getDocs.mockImplementation(async (reference: { path: string }) => {
    mocks.activeReads += 1;
    mocks.maximumReads = Math.max(mocks.maximumReads, mocks.activeReads);
    await new Promise((resolve) => setTimeout(resolve, 1));
    mocks.activeReads -= 1;
    return eventSnapshot(reference.path);
  });
  mocks.verify.mockImplementation(async (events: unknown[], head: string) => ({
    valid: true,
    eventCount: events.length,
    computedHead: head,
    errors: [],
  }));
});

describe('observation incrémentale de la vue Preuves', () => {
  it('une modification isolée parmi 100 dossiers ne relit et ne rehache qu’un seul journal', async () => {
    const entries: any[][] = [];
    const items = Array.from({ length: 100 }, (_, index) => registryItem(index));
    const unsubscribe = observeRegistryIntegrity('reg-test', (next) => entries.push(next), vi.fn());
    mocks.itemNext?.(items);
    items.forEach((item) => emitProjectionAndRoot(item));

    await waitFor(() => expect(entries.at(-1)).toHaveLength(100));
    expect(mocks.getDocs).toHaveBeenCalledTimes(100);
    expect(mocks.verify).toHaveBeenCalledTimes(100);
    expect(mocks.maximumReads).toBeLessThanOrEqual(REGISTRY_INTEGRITY_CONCURRENCY);

    const renamed = items.map((item, index) => index === 42 ? { ...item, displayTitle: 'Objet renommé' } : item);
    mocks.itemNext?.(renamed);
    expect(entries.at(-1)?.[42].item.displayTitle).toBe('Objet renommé');
    expect(mocks.getDocs).toHaveBeenCalledTimes(100);
    expect(mocks.verify).toHaveBeenCalledTimes(100);

    mocks.listeners.get(`cartularies/${items[42].cartularyId}`)?.next(rootSnapshot(items[42].cartularyId, 1));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(mocks.getDocs).toHaveBeenCalledTimes(100);
    expect(mocks.verify).toHaveBeenCalledTimes(100);

    mocks.listeners.get(`integrityProjections/${items[42].cartularyId}`)?.next(projectionSnapshot({
      publicAnchoringStatus: 'anchored',
      publicAnchorBlockHeight: 42,
    }));
    expect(entries.at(-1)?.[42].publicAnchoringStatus).toBe('anchored');
    expect(mocks.getDocs).toHaveBeenCalledTimes(100);
    expect(mocks.verify).toHaveBeenCalledTimes(100);

    mocks.listeners.get(`cartularies/${items[42].cartularyId}`)?.next(rootSnapshot(items[42].cartularyId, 2));
    await waitFor(() => expect(mocks.verify).toHaveBeenCalledTimes(101));
    expect(mocks.getDocs).toHaveBeenCalledTimes(101);
    unsubscribe();
  });

  it('ignore l’erreur d’une ancienne génération après le succès de la plus récente', async () => {
    let rejectOld!: (error: Error) => void;
    const oldRead = new Promise<never>((_resolve, reject) => { rejectOld = reject; });
    mocks.getDocs.mockImplementationOnce(() => oldRead).mockImplementationOnce(async (reference: { path: string }) => eventSnapshot(reference.path));
    const onEntries = vi.fn();
    const onError = vi.fn();
    const item = registryItem(1);
    const unsubscribe = observeRegistryIntegrity('reg-test', onEntries, onError);
    mocks.itemNext?.([item]);
    mocks.listeners.get(`integrityProjections/${item.cartularyId}`)?.next(projectionSnapshot());
    mocks.listeners.get(`cartularies/${item.cartularyId}`)?.next(rootSnapshot(item.cartularyId, 1));
    mocks.listeners.get(`cartularies/${item.cartularyId}`)?.next(rootSnapshot(item.cartularyId, 2));

    await waitFor(() => expect(onEntries).toHaveBeenCalledTimes(1));
    expect(onEntries.mock.calls[0][0][0].integritySequence).toBe(2);
    rejectOld(new Error('obsolete read failed'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(onError).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('invalide les travaux encore en vol au désabonnement', async () => {
    let resolveRead!: (snapshot: any) => void;
    mocks.getDocs.mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve; }));
    const onEntries = vi.fn();
    const onError = vi.fn();
    const item = registryItem(1);
    const unsubscribe = observeRegistryIntegrity('reg-test', onEntries, onError);
    mocks.itemNext?.([item]);
    emitProjectionAndRoot(item);
    unsubscribe();
    resolveRead(eventSnapshot(`cartularies/${item.cartularyId}/auditEvents`));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(onEntries).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
