import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  type DocumentData,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import type { RegistryAuditEvent, RegistryAuditVerification, RegistryIntegrityEntry } from '../domain/integrity.ts';
import type { RegistryItemProjection } from '../domain/projections.ts';
import { db } from '../firebase.ts';
import { verifyRegistryAuditChain } from '../utils/auditChain.ts';
import { loadRegistryItems, observeRegistryItems } from './projections.ts';

export const REGISTRY_INTEGRITY_CONCURRENCY = 4;

const timestampToIso = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (value && typeof (value as Timestamp).toDate === 'function') return (value as Timestamp).toDate().toISOString();
  return '';
};

const toAuditEvent = (id: string, data: Record<string, unknown>): RegistryAuditEvent => ({
  eventId: String(data.eventId || id),
  cartularyId: String(data.cartularyId || ''),
  sequence: Number(data.sequence || 0),
  occurredAtIso: String(data.occurredAtIso || timestampToIso(data.occurredAt)),
  actor: data.actor && typeof data.actor === 'object' ? data.actor as Record<string, unknown> : {},
  action: String(data.action || 'unknown'),
  resource: data.resource && typeof data.resource === 'object' ? data.resource as Record<string, unknown> : {},
  beforeDigest: typeof data.beforeDigest === 'string' ? data.beforeDigest : null,
  afterDigest: String(data.afterDigest || ''),
  previousEventHash: String(data.previousEventHash || ''),
  canonicalizationVersion: String(data.canonicalizationVersion || ''),
  requestId: String(data.requestId || ''),
  hash: String(data.hash || ''),
});

const anchoringFields = (projection: DocumentData) => {
  const rawAnchoringStatus = String(projection.publicAnchoringStatus || 'not_requested');
  const publicAnchoringStatus = (
    ['processing', 'pending_confirmation', 'anchored', 'failed'].includes(rawAnchoringStatus)
      ? rawAnchoringStatus
      : 'not_requested'
  ) as RegistryIntegrityEntry['publicAnchoringStatus'];
  return {
    publicAnchoringStatus,
    publicAnchorBlockHeight: Number.isInteger(projection.publicAnchorBlockHeight)
      ? Number(projection.publicAnchorBlockHeight)
      : null,
    publicAnchorConfirmedAtIso: typeof projection.publicAnchorConfirmedAtIso === 'string'
      ? projection.publicAnchorConfirmedAtIso
      : null,
  };
};

const integrityIdentity = (item: RegistryItemProjection, root: DocumentData) => ({
  cartularyId: item.cartularyId,
  integrityHead: String(root.integrityHead || ''),
  integritySequence: Number(root.integritySequence || 0),
});

const sameIntegrityIdentity = (
  left: ReturnType<typeof integrityIdentity> | null,
  right: ReturnType<typeof integrityIdentity>,
) => Boolean(left
  && left.cartularyId === right.cartularyId
  && left.integrityHead === right.integrityHead
  && left.integritySequence === right.integritySequence);

const buildIntegrityEntry = ({
  item,
  root,
  projection,
  events,
  verification,
}: {
  item: RegistryItemProjection;
  root: DocumentData;
  projection: DocumentData;
  events: RegistryAuditEvent[];
  verification: RegistryAuditVerification;
}): RegistryIntegrityEntry => ({
  item,
  sourceRevision: Number(root.revision || item.sourceRevision),
  integrityHead: String(root.integrityHead || ''),
  integritySequence: Number(root.integritySequence || 0),
  events,
  verification,
  ...anchoringFields(projection),
  ownershipTransferCount: Number(root.ownershipTransferCount || 0),
  inheritedHead: typeof root.ownershipRollover?.inheritedHead === 'string'
    ? root.ownershipRollover.inheritedHead
    : null,
});

const loadAuditVerification = async (item: RegistryItemProjection, root: DocumentData) => {
  const cartularyRef = doc(db, 'cartularies', item.cartularyId);
  const eventsSnapshot = await getDocs(query(collection(cartularyRef, 'auditEvents'), orderBy('sequence', 'asc')));
  const events = eventsSnapshot.docs.map((event) => toAuditEvent(event.id, event.data()));
  const { integrityHead, integritySequence } = integrityIdentity(item, root);
  return {
    events,
    verification: await verifyRegistryAuditChain(events, integrityHead, integritySequence),
  };
};

const loadIntegrityEntry = async (item: RegistryItemProjection): Promise<RegistryIntegrityEntry> => {
  const cartularyRef = doc(db, 'cartularies', item.cartularyId);
  const [rootSnapshot, projectionSnapshot] = await Promise.all([
    getDoc(cartularyRef),
    getDoc(doc(db, 'integrityProjections', item.cartularyId)),
  ]);
  if (!rootSnapshot.exists()) throw new Error(`Cartulaire ${item.cartularyId} introuvable.`);
  const root = rootSnapshot.data();
  const projection = projectionSnapshot.exists() ? projectionSnapshot.data() : {};
  const { events, verification } = await loadAuditVerification(item, root);
  return buildIntegrityEntry({ item, root, projection, events, verification });
};

const mapWithConcurrency = async <Input, Output>(
  values: Input[],
  concurrency: number,
  mapper: (value: Input) => Promise<Output>,
) => {
  const results = new Array<Output>(values.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
};

export const loadRegistryIntegrity = async (registryId: string): Promise<RegistryIntegrityEntry[]> => {
  const items = (await loadRegistryItems(registryId)).filter((item) => item.projectionStatus === 'active');
  return mapWithConcurrency(items, REGISTRY_INTEGRITY_CONCURRENCY, loadIntegrityEntry);
};

const createVerificationPool = (concurrency: number) => {
  let activeCount = 0;
  let cancelled = false;
  const queue: Array<{
    task: () => Promise<void>;
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  const pump = () => {
    while (!cancelled && activeCount < concurrency && queue.length > 0) {
      const pending = queue.shift();
      if (!pending) return;
      activeCount += 1;
      void pending.task().then(pending.resolve, pending.reject).finally(() => {
        activeCount -= 1;
        pump();
      });
    }
  };
  return {
    run: (task: () => Promise<void>) => new Promise<void>((resolve, reject) => {
      if (cancelled) { resolve(); return; }
      queue.push({ task, resolve, reject });
      pump();
    }),
    cancel: () => {
      cancelled = true;
      queue.splice(0).forEach((pending) => pending.resolve());
    },
  };
};

type WatchedIntegrity = {
  item: RegistryItemProjection;
  active: boolean;
  workGeneration: number;
  root: DocumentData | null;
  projection: DocumentData;
  verifiedIdentity: ReturnType<typeof integrityIdentity> | null;
  events: RegistryAuditEvent[];
  verification: RegistryAuditVerification | null;
  entry: RegistryIntegrityEntry | null;
  unsubscribeRoot: Unsubscribe;
  unsubscribeProjection: Unsubscribe;
};

/**
 * Observes only the documents that can invalidate the displayed proof. A
 * registry item rename reuses the existing proof; a root head/sequence change
 * schedules exactly that Cartulary's full journal verification.
 */
export const observeRegistryIntegrity = (
  registryId: string,
  onEntries: (entries: RegistryIntegrityEntry[]) => void,
  onError: (error: Error) => void,
) => {
  let active = true;
  let orderedIds: string[] = [];
  const watched = new Map<string, WatchedIntegrity>();
  const pool = createVerificationPool(REGISTRY_INTEGRITY_CONCURRENCY);

  const emitIfComplete = () => {
    if (!active) return;
    const states = orderedIds.map((id) => watched.get(id));
    if (states.some((state) => !state?.entry)) return;
    onEntries(states.flatMap((state) => state?.entry ? [state.entry] : []));
  };

  const reportCurrentError = (state: WatchedIntegrity, generation: number, error: unknown) => {
    if (!active || !state.active || state.workGeneration !== generation) return;
    onError(error instanceof Error ? error : new Error('Vérification d’intégrité impossible.'));
  };

  const rebuildFromCache = (state: WatchedIntegrity) => {
    if (!state.root || !state.verification) return;
    state.entry = buildIntegrityEntry({
      item: state.item,
      root: state.root,
      projection: state.projection,
      events: state.events,
      verification: state.verification,
    });
    emitIfComplete();
  };

  const watchItem = (item: RegistryItemProjection) => {
    const state: WatchedIntegrity = {
      item,
      active: true,
      workGeneration: 0,
      root: null,
      projection: {},
      verifiedIdentity: null,
      events: [],
      verification: null,
      entry: null,
      unsubscribeRoot: () => undefined,
      unsubscribeProjection: () => undefined,
    };
    watched.set(item.cartularyId, state);
    state.unsubscribeRoot = onSnapshot(doc(db, 'cartularies', item.cartularyId), (rootSnapshot) => {
      if (!active || !state.active) return;
      const generation = ++state.workGeneration;
      if (!rootSnapshot.exists()) {
        reportCurrentError(state, generation, new Error(`Cartulaire ${item.cartularyId} introuvable.`));
        return;
      }
      state.root = rootSnapshot.data();
      const nextIdentity = integrityIdentity(state.item, state.root);
      if (sameIntegrityIdentity(state.verifiedIdentity, nextIdentity) && state.verification) {
        rebuildFromCache(state);
        return;
      }
      void pool.run(async () => {
        try {
          const result = await loadAuditVerification(state.item, state.root || {});
          if (!active || !state.active || state.workGeneration !== generation) return;
          state.events = result.events;
          state.verification = result.verification;
          state.verifiedIdentity = nextIdentity;
          rebuildFromCache(state);
        } catch (error) {
          reportCurrentError(state, generation, error);
        }
      }).catch((error: unknown) => reportCurrentError(state, generation, error));
    }, (error) => reportCurrentError(state, state.workGeneration, error));
    state.unsubscribeProjection = onSnapshot(doc(db, 'integrityProjections', item.cartularyId), (projectionSnapshot) => {
      if (!active || !state.active) return;
      state.projection = projectionSnapshot.exists() ? projectionSnapshot.data() : {};
      rebuildFromCache(state);
    }, (error) => reportCurrentError(state, state.workGeneration, error));
  };

  const unsubscribeItems = observeRegistryItems(registryId, (items) => {
    if (!active) return;
    const activeItems = [...new Map(items
      .filter((item) => item.projectionStatus === 'active')
      .map((item) => [item.cartularyId, item])).values()];
    orderedIds = activeItems.map((item) => item.cartularyId);
    const retained = new Set(orderedIds);
    for (const [cartularyId, state] of watched) {
      if (retained.has(cartularyId)) continue;
      state.active = false;
      state.workGeneration += 1;
      state.unsubscribeRoot();
      state.unsubscribeProjection();
      watched.delete(cartularyId);
    }
    for (const item of activeItems) {
      const state = watched.get(item.cartularyId);
      if (!state) {
        watchItem(item);
        continue;
      }
      state.item = item;
      rebuildFromCache(state);
    }
    if (activeItems.length === 0) onEntries([]);
    else emitIfComplete();
  }, (error) => { if (active) onError(error); });

  return () => {
    active = false;
    pool.cancel();
    unsubscribeItems();
    for (const state of watched.values()) {
      state.active = false;
      state.workGeneration += 1;
      state.unsubscribeRoot();
      state.unsubscribeProjection();
    }
    watched.clear();
  };
};
