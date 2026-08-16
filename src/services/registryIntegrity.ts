import { collection, doc, getDoc, getDocs, orderBy, query, type Timestamp } from 'firebase/firestore';
import type { RegistryAuditEvent, RegistryIntegrityEntry } from '../domain/integrity.ts';
import { db } from '../firebase.ts';
import { verifyRegistryAuditChain } from '../utils/auditChain.ts';
import { loadRegistryItems, observeRegistryItems } from './projections.ts';

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

const loadIntegrityEntry = async (
  item: Awaited<ReturnType<typeof loadRegistryItems>>[number],
): Promise<RegistryIntegrityEntry> => {
  const cartularyRef = doc(db, 'cartularies', item.cartularyId);
  const [rootSnapshot, eventsSnapshot] = await Promise.all([
    getDoc(cartularyRef),
    getDocs(query(collection(cartularyRef, 'auditEvents'), orderBy('sequence', 'asc'))),
  ]);
  if (!rootSnapshot.exists()) throw new Error(`Cartulaire ${item.cartularyId} introuvable.`);
  const root = rootSnapshot.data();
  const events = eventsSnapshot.docs.map((event) => toAuditEvent(event.id, event.data()));
  const integrityHead = String(root.integrityHead || '');
  const integritySequence = Number(root.integritySequence || 0);
  return {
    item,
    sourceRevision: Number(root.revision || item.sourceRevision),
    integrityHead,
    integritySequence,
    events,
    verification: await verifyRegistryAuditChain(events, integrityHead, integritySequence),
    publicAnchoringStatus: 'deferred',
  };
};

export const loadRegistryIntegrity = async (registryId: string): Promise<RegistryIntegrityEntry[]> => {
  const items = (await loadRegistryItems(registryId)).filter((item) => item.projectionStatus === 'active');
  return Promise.all(items.map(loadIntegrityEntry));
};

export const observeRegistryIntegrity = (
  registryId: string,
  onEntries: (entries: RegistryIntegrityEntry[]) => void,
  onError: (error: Error) => void,
) => {
  let generation = 0;
  return observeRegistryItems(registryId, (items) => {
    const currentGeneration = ++generation;
    void Promise.all(items.filter((item) => item.projectionStatus === 'active').map(loadIntegrityEntry))
      .then((entries) => {
        if (currentGeneration === generation) onEntries(entries);
      })
      .catch(onError);
  }, onError);
};
