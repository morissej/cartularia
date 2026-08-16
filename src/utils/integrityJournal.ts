import type { AuditEvent } from '../types';

const FORMAT_VERSION = 'cartularia-integrity-v2' as const;
const CANONICALIZATION_VERSION = 'jcs-1' as const;
const EVENT_VERSION = '2.0' as const;
const ZERO_HASH = `sha256:${'0'.repeat(64)}`;
const STATE_STORAGE_KEY = 'cartularia-integrity-v2';
const LEGACY_EVENTS_STORAGE_KEY = 'cartularia_audit_events';
const LEGACY_RECEIPTS_STORAGE_KEY = 'cartularia_audit_receipts';

type LegacyStatus = 'legacy_valid' | 'legacy_broken' | 'legacy_unverifiable';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface LegacyAuditEvent {
  id?: string;
  timestamp?: string;
  action?: string;
  actorId?: string;
  details?: string;
  previousHash?: string;
  hash?: string;
  sequence?: number;
  version?: string;
}

interface LegacyBundle {
  importedAt: string;
  bundleDigest: string;
  status: LegacyStatus;
  eventCount: number;
  events: unknown[];
  receipts: unknown[];
}

export interface LocalTimestampReceipt {
  receiptId: string;
  merkleRoot: string;
  timestamp: string;
  provider: string;
  protocol: 'local-timestamp-fixture-v2';
  qualified: false;
  publicAnchoringStatus: 'deferred';
  tokenDigest: string;
  status: 'TestReceipt';
}

export interface Rfc3161TimestampReceipt {
  receiptId: string;
  merkleRoot: string;
  timestamp: string;
  protocol: 'rfc3161-v1';
  status: 'ExternalReceipt';
  provider: string;
  tsaEndpoint: string;
  digest: string;
  requestId: string;
  requestBase64: string;
  requestSha256: string;
  tokenBase64: string;
  tokenSha256: string;
  policyOid: string;
  serialNumber: string;
  hashAlgorithm: 'sha256';
  nonce: string;
  signerSubject: string;
  signerIssuer: string;
  signerCertificateSha256: string;
  verificationStatus: 'trusted_rfc3161' | 'qualified_eidas';
  signatureVerified: true;
  chainVerified: true;
  nonceMatched: true;
  qualified: boolean;
  qualificationStatus: 'not_assessed' | 'TSA' | 'QTSA';
  publicAnchoringStatus: 'deferred';
  validationEvidence: {
    verifiedAt: string;
    verifier: string;
    trustStore: string;
    trustedListServiceId?: string;
    validationReportDigest?: string;
  };
  anchoredRevision?: number;
  anchoredContentDigest?: string;
  anchoredIntegrityHead?: string;
  anchoredIntegritySequence?: number;
}

export type AnchorReceipt = LocalTimestampReceipt | Rfc3161TimestampReceipt;

export type Rfc3161GatewayReceipt = Omit<
  Rfc3161TimestampReceipt,
  'merkleRoot' | 'timestamp' | 'anchoredRevision' | 'anchoredContentDigest' | 'anchoredIntegrityHead' | 'anchoredIntegritySequence'
> & { issuedAt: string };

export const isRfc3161Receipt = (receipt: AnchorReceipt): receipt is Rfc3161TimestampReceipt => (
  receipt.protocol === 'rfc3161-v1'
);

interface PersistedIntegrityState {
  formatVersion: typeof FORMAT_VERSION;
  cartularyId: string;
  revision: number;
  contentDigest: string;
  sectionDigests: Record<string, string>;
  integrityHead: string;
  integritySequence: number;
  events: AuditEvent[];
  receipts: AnchorReceipt[];
  legacyBundles: LegacyBundle[];
}

export interface IntegrityVerificationError {
  code:
    | 'sequence_gap'
    | 'previous_hash_mismatch'
    | 'event_hash_mismatch'
    | 'revision_regression'
    | 'head_mismatch'
    | 'root_sequence_mismatch'
    | 'content_digest_mismatch'
    | 'legacy_bundle_digest_mismatch'
    | 'legacy_status_mismatch'
    | 'timestamp_token_mismatch'
    | 'timestamp_root_unknown'
    | 'state_storage_invalid'
    | 'malformed_event'
    | 'malformed_receipt';
  sequence?: number;
}

export interface IntegrityVerificationResult {
  isValid: boolean;
  brokenSequence?: number;
  errors: IntegrityVerificationError[];
  legacyStatuses: LegacyStatus[];
}

export interface IntegrityProofState {
  revision: number;
  contentDigest: string;
  integrityHead: string;
  integritySequence: number;
  legacyStatuses: LegacyStatus[];
}

export interface PortableIntegrityBundle {
  formatVersion: 'cartularia-integrity-export-v1';
  canonicalizationVersion: typeof CANONICALIZATION_VERSION;
  exportedAt: string;
  cartularyId: string;
  revision: number;
  contentDigest: string;
  integrityHead: string;
  integritySequence: number;
  merkleRoot: string;
  events: AuditEvent[];
  receipts: AnchorReceipt[];
  legacyBundles: LegacyBundle[];
  snapshot?: unknown;
}

interface JournalOptions {
  cartularyId?: string;
  storage?: StorageLike;
  onUpdate?: () => void;
  now?: () => string;
}

interface AppendOptions {
  requestId?: string;
  resource?: AuditEvent['resource'];
}

const lockQueues = new Map<string, Promise<void>>();

const assertValidUnicode = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError('Chaîne non I-JSON : surrogate haut isolé.');
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError('Chaîne non I-JSON : surrogate bas isolé.');
    }
  }
};

const normalizeCanonicalValue = (value: unknown, stack = new Set<object>()): unknown => {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    assertValidUnicode(value);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JCS refuse NaN et les valeurs infinies.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new TypeError(`Type non JSON dans la sérialisation canonique : ${typeof value}.`);
  }
  if (typeof value !== 'object') throw new TypeError('Valeur non JSON.');
  if (stack.has(value)) throw new TypeError('Structure cyclique interdite dans la sérialisation canonique.');
  stack.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => normalizeCanonicalValue(entry, stack));
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new TypeError('Seuls les objets JSON simples sont acceptés par JCS.');
    }
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => {
      assertValidUnicode(key);
      return [key, normalizeCanonicalValue(record[key], stack)];
    }));
  } finally {
    stack.delete(value);
  }
};

export const canonicalize = (value: unknown): string => JSON.stringify(normalizeCanonicalValue(value));

export const computeHash = async (value: unknown): Promise<string> => {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : canonicalize(value));
  return computeBytesHash(bytes);
};

export const computeBytesHash = async (bytes: BufferSource | Uint8Array<ArrayBufferLike>): Promise<string> => {
  const digestInput = bytes instanceof Uint8Array ? Uint8Array.from(bytes).buffer : bytes;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', digestInput);
  return `sha256:${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

const decodeBase64 = (value: string): Uint8Array => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new TypeError('Encodage base64 invalide.');
  }
  const binary = globalThis.atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (globalThis.btoa(binary) !== value) throw new TypeError('Encodage base64 non canonique.');
  return bytes;
};

const randomId = () => globalThis.crypto.randomUUID();

const createEmptyState = (cartularyId: string): PersistedIntegrityState => ({
  formatVersion: FORMAT_VERSION,
  cartularyId,
  revision: 0,
  contentDigest: ZERO_HASH,
  sectionDigests: {},
  integrityHead: ZERO_HASH,
  integritySequence: 0,
  events: [],
  receipts: [],
  legacyBundles: [],
});

const eventPayload = (event: AuditEvent) => ({
  id: event.id,
  cartularyId: event.cartularyId,
  timestamp: event.timestamp,
  action: event.action,
  actorId: event.actorId,
  details: event.details,
  resource: event.resource,
  revision: event.revision,
  beforeDigest: event.beforeDigest,
  afterDigest: event.afterDigest,
  previousHash: event.previousHash,
  sequence: event.sequence,
  version: event.version,
  canonicalizationVersion: event.canonicalizationVersion,
  requestId: event.requestId,
});

const hashEvent = async (event: AuditEvent) => computeHash({
  previousHash: event.previousHash,
  event: eventPayload(event),
});

const parseArray = (raw: string | null): unknown[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const classifyLegacyEvents = async (events: unknown[]): Promise<LegacyStatus> => {
  if (events.length === 0) return 'legacy_unverifiable';
  const currentEvents = events as AuditEvent[];
  if (currentEvents.every((event) => event?.version === EVENT_VERSION)) {
    let previousHash = ZERO_HASH;
    for (let index = 0; index < currentEvents.length; index += 1) {
      const event = currentEvents[index];
      if (event.sequence !== index + 1 || event.previousHash !== previousHash || event.hash !== await hashEvent(event)) {
        return 'legacy_broken';
      }
      previousHash = event.hash;
    }
    return 'legacy_valid';
  }
  const candidates = events as LegacyAuditEvent[];
  const first = candidates[0];
  if (
    typeof first?.hash !== 'string'
    || typeof first.timestamp !== 'string'
    || typeof first.action !== 'string'
    || typeof first.actorId !== 'string'
    || typeof first.version !== 'string'
  ) return 'legacy_unverifiable';
  for (let index = 1; index < candidates.length; index += 1) {
    const previous = candidates[index - 1];
    const current = candidates[index];
    if (
      typeof previous.hash !== 'string'
      || typeof current.hash !== 'string'
      || typeof current.previousHash !== 'string'
      || current.previousHash !== previous.hash
      || current.sequence !== index
    ) return 'legacy_broken';
    if (
      typeof current.timestamp !== 'string'
      || typeof current.action !== 'string'
      || typeof current.actorId !== 'string'
      || typeof current.version !== 'string'
    ) return 'legacy_unverifiable';
    const legacyPayload = current.version === '1.1'
      ? `${current.previousHash}|${current.action}|${current.actorId}|${current.details ?? ''}|${current.timestamp}|${current.sequence}|${current.version}`
      : `${current.previousHash}|${current.action}|${current.actorId}|${current.timestamp}|${current.sequence}|${current.version}`;
    const recomputed = await computeHash(legacyPayload);
    if (current.hash !== recomputed.replace('sha256:', '')) return 'legacy_broken';
  }
  // Le journal v1 démarrait par un hash genesis fictif : même si ses descendants
  // se vérifient, sa racine ne peut pas être prouvée a posteriori.
  return 'legacy_unverifiable';
};

const buildMerkleRoot = async (hashes: string[]): Promise<string> => {
  if (hashes.length === 0) return ZERO_HASH;
  let layer = [...hashes];
  while (layer.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < layer.length; index += 2) {
      const left = layer[index];
      const right = layer[index + 1] ?? left;
      next.push(await computeHash({ left, right }));
    }
    layer = next;
  }
  return layer[0];
};

const resolveStorage = (): StorageLike => {
  if (!globalThis.localStorage) throw new Error('Un stockage doit être fourni hors navigateur.');
  return globalThis.localStorage;
};

export class IntegrityJournal {
  private state: PersistedIntegrityState;
  private readonly storage: StorageLike;
  private readonly onUpdate: () => void;
  private readonly now: () => string;
  private readonly lockName: string;
  private readonly stateStorageKey: string;
  private readonly readyPromise: Promise<void>;

  constructor(options: JournalOptions | (() => void) = {}) {
    const normalizedOptions: JournalOptions = typeof options === 'function' ? { onUpdate: options } : options;
    const cartularyId = normalizedOptions.cartularyId ?? 'cartularia-local-demo';
    this.storage = normalizedOptions.storage ?? resolveStorage();
    this.onUpdate = normalizedOptions.onUpdate ?? (() => undefined);
    this.now = normalizedOptions.now ?? (() => new Date().toISOString());
    this.lockName = `cartularia-integrity:${cartularyId}`;
    this.stateStorageKey = `${STATE_STORAGE_KEY}:${cartularyId}`;
    this.state = this.readState() ?? createEmptyState(cartularyId);
    this.readyPromise = this.initializeLegacyMigration();
  }

  public async ready(): Promise<void> {
    await this.readyPromise;
  }

  private readState(): PersistedIntegrityState | null {
    const raw = this.storage.getItem(this.stateStorageKey);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<PersistedIntegrityState>;
      if (
        parsed.formatVersion !== FORMAT_VERSION
        || typeof parsed.cartularyId !== 'string'
        || !Number.isInteger(parsed.revision)
        || Number(parsed.revision) < 0
        || typeof parsed.contentDigest !== 'string'
        || typeof parsed.sectionDigests !== 'object'
        || parsed.sectionDigests === null
        || typeof parsed.integrityHead !== 'string'
        || !Number.isInteger(parsed.integritySequence)
        || Number(parsed.integritySequence) < 0
        || !Array.isArray(parsed.events)
        || !Array.isArray(parsed.receipts)
        || !Array.isArray(parsed.legacyBundles)
      ) return null;
      return parsed as PersistedIntegrityState;
    } catch {
      return null;
    }
  }

  private reloadState() {
    const persisted = this.readState();
    if (!persisted) throw new Error('État d’intégrité absent ou illisible dans le stockage local.');
    this.state = persisted;
  }

  private saveState() {
    this.storage.setItem(this.stateStorageKey, JSON.stringify(this.state));
    this.onUpdate();
  }

  private async withExclusiveLock<T>(task: () => Promise<T>): Promise<T> {
    const previous = lockQueues.get(this.lockName) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    lockQueues.set(this.lockName, queued);
    await previous;
    try {
      const lockManager = globalThis.navigator?.locks;
      if (lockManager) return await lockManager.request(this.lockName, task);
      return await task();
    } finally {
      release();
      if (lockQueues.get(this.lockName) === queued) lockQueues.delete(this.lockName);
    }
  }

  private async initializeLegacyMigration() {
    if (this.readState()) return;
    await this.withExclusiveLock(async () => {
      if (this.readState()) {
        this.reloadState();
        return;
      }
      const events = parseArray(this.storage.getItem(LEGACY_EVENTS_STORAGE_KEY));
      const receipts = parseArray(this.storage.getItem(LEGACY_RECEIPTS_STORAGE_KEY));
      const rejectedStateRaw = this.storage.getItem(this.stateStorageKey);
      this.state = createEmptyState(this.state.cartularyId);
      if (rejectedStateRaw) {
        const rejectedEvents = [{ storageKey: this.stateStorageKey, raw: rejectedStateRaw }];
        const bundleDigest = await computeHash({ events: rejectedEvents, receipts: [] });
        this.state.legacyBundles.push({
          importedAt: this.now(),
          bundleDigest,
          status: 'legacy_unverifiable',
          eventCount: 0,
          events: rejectedEvents,
          receipts: [],
        });
        await this.appendEventLocked({
          action: 'legacy.journal.imported',
          actorId: 'system',
          details: 'État v2 illisible archivé sans réécriture',
          requestId: `legacy-invalid-state-${bundleDigest.slice(7, 31)}`,
          resource: { type: 'legacy_journal', id: bundleDigest },
          nextRevision: 0,
          beforeDigest: null,
          afterDigest: ZERO_HASH,
        });
      }
      if (events.length > 0 || receipts.length > 0) {
        const importedAt = this.now();
        const bundleDigest = await computeHash({ events, receipts });
        const status = await classifyLegacyEvents(events);
        this.state.legacyBundles.push({ importedAt, bundleDigest, status, eventCount: events.length, events, receipts });
        await this.appendEventLocked({
          action: 'legacy.journal.imported',
          actorId: 'system',
          details: `Journal historique importé : ${status} · ${events.length} événements`,
          requestId: `legacy-import-${bundleDigest.slice(7, 31)}`,
          resource: { type: 'legacy_journal', id: bundleDigest },
          nextRevision: 0,
          beforeDigest: null,
          afterDigest: ZERO_HASH,
        });
      }
      this.saveState();
    });
  }

  private async appendEventLocked(input: {
    action: string;
    actorId: string;
    details: string;
    requestId: string;
    resource: AuditEvent['resource'];
    nextRevision: number;
    beforeDigest: string | null;
    afterDigest: string;
  }): Promise<AuditEvent> {
    const existing = this.state.events.find((event) => event.requestId === input.requestId);
    if (existing) {
      const sameRequest = existing.action === input.action
        && existing.actorId === input.actorId
        && existing.details === input.details
        && canonicalize(existing.resource) === canonicalize(input.resource)
        && existing.revision === input.nextRevision
        && existing.beforeDigest === input.beforeDigest
        && existing.afterDigest === input.afterDigest;
      if (!sameRequest) throw new Error(`Conflit d'idempotence pour requestId=${input.requestId}.`);
      return existing;
    }
    const previousHash = this.state.integrityHead;
    const event: AuditEvent = {
      id: `evt_${randomId()}`,
      cartularyId: this.state.cartularyId,
      timestamp: this.now(),
      action: input.action,
      actorId: input.actorId,
      details: input.details,
      resource: input.resource,
      revision: input.nextRevision,
      beforeDigest: input.beforeDigest,
      afterDigest: input.afterDigest,
      previousHash,
      hash: '',
      sequence: this.state.integritySequence + 1,
      version: EVENT_VERSION,
      canonicalizationVersion: CANONICALIZATION_VERSION,
      requestId: input.requestId,
    };
    event.hash = await hashEvent(event);
    this.state.events.push(event);
    this.state.integrityHead = event.hash;
    this.state.integritySequence = event.sequence;
    this.state.revision = Math.max(this.state.revision, input.nextRevision);
    return event;
  }

  public getEvents(): AuditEvent[] {
    return structuredClone(this.state.events);
  }

  public getReceipts(): AnchorReceipt[] {
    return structuredClone(this.state.receipts);
  }

  public getProofState(): IntegrityProofState {
    return {
      revision: this.state.revision,
      contentDigest: this.state.contentDigest,
      integrityHead: this.state.integrityHead,
      integritySequence: this.state.integritySequence,
      legacyStatuses: this.state.legacyBundles.map((bundle) => bundle.status),
    };
  }

  public async logEvent(
    action: string,
    actorId: string,
    details: string,
    options: AppendOptions = {},
  ): Promise<AuditEvent> {
    await this.ready();
    return this.withExclusiveLock(async () => {
      this.reloadState();
      const event = await this.appendEventLocked({
        action,
        actorId,
        details,
        requestId: options.requestId ?? `${action}-${randomId()}`,
        resource: options.resource ?? { type: 'cartulary', id: this.state.cartularyId },
        nextRevision: this.state.revision,
        beforeDigest: this.state.contentDigest,
        afterDigest: this.state.contentDigest,
      });
      this.saveState();
      return event;
    });
  }

  public async reconcileSnapshot(
    snapshot: Record<string, unknown>,
    actorId = 'Propriétaire',
  ): Promise<AuditEvent | null> {
    await this.ready();
    const contentDigest = await computeHash(snapshot);
    const sectionEntries = await Promise.all(Object.entries(snapshot).map(async ([section, value]) => (
      [section, await computeHash(value)] as const
    )));
    const nextSectionDigests = Object.fromEntries(sectionEntries);
    return this.withExclusiveLock(async () => {
      this.reloadState();
      if (this.state.contentDigest === contentDigest) return null;
      const changedSections = Object.keys(nextSectionDigests).filter(
        (section) => nextSectionDigests[section] !== this.state.sectionDigests[section],
      );
      const initialSnapshot = this.state.contentDigest === ZERO_HASH;
      const publicationOnly = changedSections.length > 0 && changedSections.every((section) => section === 'publication');
      const action = initialSnapshot
        ? 'cartulary.snapshot.initialized'
        : publicationOnly ? 'publication.selection.updated' : 'cartulary.content.updated';
      const nextRevision = this.state.revision + 1;
      const beforeDigest = this.state.contentDigest;
      const requestId = `snapshot-r${nextRevision}-${beforeDigest.slice(7, 19)}-${contentDigest.slice(7, 19)}`;
      const event = await this.appendEventLocked({
        action,
        actorId,
        details: initialSnapshot
          ? 'État canonique initial du Cartulaire enregistré'
          : `Révision ${nextRevision} · sections modifiées : ${changedSections.join(', ')}`,
        requestId,
        resource: { type: 'cartulary_snapshot', id: this.state.cartularyId, changedSections },
        nextRevision,
        beforeDigest,
        afterDigest: contentDigest,
      });
      this.state.contentDigest = contentDigest;
      this.state.sectionDigests = nextSectionDigests;
      this.saveState();
      return event;
    });
  }

  public async getMerkleRoot(): Promise<string> {
    await this.ready();
    this.reloadState();
    return buildMerkleRoot(this.state.events.map((event) => event.hash));
  }

  public async createLocalTestTimestamp(snapshot?: Record<string, unknown>): Promise<LocalTimestampReceipt | null> {
    await this.ready();
    if (snapshot) await this.reconcileSnapshot(snapshot);
    return this.withExclusiveLock(async () => {
      this.reloadState();
      if (this.state.events.length === 0) return null;
      const merkleRoot = await buildMerkleRoot(this.state.events.map((event) => event.hash));
      const existing = this.state.receipts
        .filter((receipt): receipt is LocalTimestampReceipt => !isRfc3161Receipt(receipt))
        .find((receipt) => receipt.merkleRoot === merkleRoot);
      if (existing) return existing;
      const timestamp = this.now();
      const tokenDigest = await computeHash({ merkleRoot, timestamp, protocol: 'local-timestamp-fixture-v2' });
      const receipt: LocalTimestampReceipt = {
        receiptId: `rec_${tokenDigest.slice(7, 31)}`,
        merkleRoot,
        timestamp,
        provider: 'Adaptateur local Cartularia — non qualifié',
        protocol: 'local-timestamp-fixture-v2',
        qualified: false,
        publicAnchoringStatus: 'deferred',
        tokenDigest,
        status: 'TestReceipt',
      };
      this.state.receipts.push(receipt);
      this.saveState();
      return receipt;
    });
  }

  public async attachExternalTimestamp(receipt: Rfc3161GatewayReceipt): Promise<Rfc3161TimestampReceipt> {
    await this.ready();
    return this.withExclusiveLock(async () => {
      this.reloadState();
      if (
        receipt.protocol !== 'rfc3161-v1'
        || receipt.status !== 'ExternalReceipt'
        || receipt.hashAlgorithm !== 'sha256'
        || receipt.verificationStatus === undefined
        || receipt.signatureVerified !== true
        || receipt.chainVerified !== true
        || receipt.nonceMatched !== true
        || receipt.publicAnchoringStatus !== 'deferred'
        || !receipt.digest.startsWith('sha256:')
        || !receipt.requestSha256.startsWith('sha256:')
        || !receipt.tokenSha256.startsWith('sha256:')
        || !receipt.signerCertificateSha256.startsWith('sha256:')
        || Number.isNaN(new Date(receipt.issuedAt).valueOf())
        || Number.isNaN(new Date(receipt.validationEvidence?.verifiedAt).valueOf())
      ) throw new TypeError('Reçu RFC 3161 incomplet ou non vérifié.');
      if (
        receipt.qualified
        && (
          receipt.verificationStatus !== 'qualified_eidas'
          || receipt.qualificationStatus !== 'QTSA'
          || !receipt.validationEvidence.trustedListServiceId
          || !receipt.validationEvidence.validationReportDigest?.startsWith('sha256:')
        )
      ) throw new TypeError('La qualification eIDAS requiert une preuve de liste de confiance.');
      if (!receipt.qualified && receipt.verificationStatus === 'qualified_eidas') {
        throw new TypeError('Statut de qualification contradictoire.');
      }
      const requestBytes = decodeBase64(receipt.requestBase64);
      const tokenBytes = decodeBase64(receipt.tokenBase64);
      if (
        requestBytes.byteLength === 0
        || tokenBytes.byteLength === 0
        || tokenBytes.byteLength > 128 * 1024
        || await computeBytesHash(requestBytes) !== receipt.requestSha256
        || await computeBytesHash(tokenBytes) !== receipt.tokenSha256
      ) throw new TypeError('L’empreinte des octets RFC 3161 ne correspond pas au reçu.');

      const knownRoots: Array<{ root: string; event: AuditEvent }> = [];
      for (let length = 1; length <= this.state.events.length; length += 1) {
        knownRoots.push({
          root: await buildMerkleRoot(this.state.events.slice(0, length).map((event) => event.hash)),
          event: this.state.events[length - 1],
        });
      }
      const anchored = knownRoots.find(({ root }) => root === receipt.digest);
      if (!anchored) throw new TypeError('Le reçu ne cible aucune racine Merkle connue de ce Cartulaire.');
      const replay = this.state.receipts
        .filter(isRfc3161Receipt)
        .find((existing) => existing.receiptId === receipt.receiptId || existing.requestId === receipt.requestId);
      if (replay) {
        if (replay.tokenSha256 !== receipt.tokenSha256 || replay.merkleRoot !== receipt.digest) {
          throw new TypeError('Conflit d’idempotence du reçu RFC 3161.');
        }
        return replay;
      }
      const { issuedAt, ...gatewayReceipt } = receipt;
      const storedReceipt: Rfc3161TimestampReceipt = {
        ...gatewayReceipt,
        merkleRoot: receipt.digest,
        timestamp: issuedAt,
        anchoredRevision: anchored.event.revision,
        anchoredContentDigest: anchored.event.afterDigest,
        anchoredIntegrityHead: anchored.event.hash,
        anchoredIntegritySequence: anchored.event.sequence,
      };
      this.state.receipts.push(storedReceipt);
      this.saveState();
      return storedReceipt;
    });
  }

  public async verifyIntegrity(): Promise<IntegrityVerificationResult> {
    await this.ready();
    try {
      this.reloadState();
    } catch {
      return {
        isValid: false,
        errors: [{ code: 'state_storage_invalid' }],
        legacyStatuses: this.state.legacyBundles.map((bundle) => bundle.status),
      };
    }
    const errors: IntegrityVerificationError[] = [];
    let previousHash = ZERO_HASH;
    let lastRevision = 0;
    let lastContentDigest = ZERO_HASH;
    for (let index = 0; index < this.state.events.length; index += 1) {
      const expectedSequence = index + 1;
      const event = this.state.events[index] as AuditEvent | null | undefined;
      if (!event || typeof event !== 'object') {
        errors.push({ code: 'malformed_event', sequence: expectedSequence });
        continue;
      }
      const revisionIsValid = Number.isInteger(event.revision) && event.revision >= 0;
      if (event.sequence !== expectedSequence) errors.push({ code: 'sequence_gap', sequence: event.sequence });
      if (event.previousHash !== previousHash) errors.push({ code: 'previous_hash_mismatch', sequence: event.sequence });
      if (!revisionIsValid) errors.push({ code: 'malformed_event', sequence: event.sequence });
      else if (event.revision < lastRevision) errors.push({ code: 'revision_regression', sequence: event.sequence });
      try {
        const recomputed = await hashEvent(event);
        if (event.hash !== recomputed) errors.push({ code: 'event_hash_mismatch', sequence: event.sequence });
      } catch {
        errors.push({ code: 'malformed_event', sequence: event.sequence });
      }
      if (revisionIsValid && event.revision > lastRevision) lastContentDigest = event.afterDigest;
      if (revisionIsValid) lastRevision = Math.max(lastRevision, event.revision);
      if (typeof event.hash === 'string') previousHash = event.hash;
    }
    if (this.state.integrityHead !== previousHash) errors.push({ code: 'head_mismatch' });
    if (this.state.integritySequence !== this.state.events.length) errors.push({ code: 'root_sequence_mismatch' });
    if (this.state.revision > 0 && this.state.contentDigest !== lastContentDigest) errors.push({ code: 'content_digest_mismatch' });
    for (const bundle of this.state.legacyBundles) {
      try {
        const digest = await computeHash({ events: bundle.events, receipts: bundle.receipts });
        if (digest !== bundle.bundleDigest) errors.push({ code: 'legacy_bundle_digest_mismatch' });
        if (await classifyLegacyEvents(bundle.events) !== bundle.status) errors.push({ code: 'legacy_status_mismatch' });
      } catch {
        errors.push({ code: 'legacy_bundle_digest_mismatch' });
        errors.push({ code: 'legacy_status_mismatch' });
      }
    }
    const knownMerkleRoots = new Set<string>();
    if (this.state.events.every((event) => event && typeof event.hash === 'string')) {
      for (let length = 1; length <= this.state.events.length; length += 1) {
        knownMerkleRoots.add(await buildMerkleRoot(this.state.events.slice(0, length).map((event) => event.hash)));
      }
    }
    for (const receipt of this.state.receipts) {
      try {
        if (isRfc3161Receipt(receipt)) {
          const requestBytes = decodeBase64(receipt.requestBase64);
          const tokenBytes = decodeBase64(receipt.tokenBase64);
          const qualificationIsValid = receipt.qualified
            ? receipt.verificationStatus === 'qualified_eidas'
              && receipt.qualificationStatus === 'QTSA'
              && Boolean(receipt.validationEvidence?.trustedListServiceId)
              && Boolean(receipt.validationEvidence?.validationReportDigest?.startsWith('sha256:'))
            : receipt.verificationStatus === 'trusted_rfc3161' && receipt.qualificationStatus !== 'QTSA';
          if (
            receipt.digest !== receipt.merkleRoot
            || receipt.signatureVerified !== true
            || receipt.chainVerified !== true
            || receipt.nonceMatched !== true
            || receipt.hashAlgorithm !== 'sha256'
            || !qualificationIsValid
            || await computeBytesHash(requestBytes) !== receipt.requestSha256
            || await computeBytesHash(tokenBytes) !== receipt.tokenSha256
          ) errors.push({ code: 'timestamp_token_mismatch' });
        } else {
          const expectedTokenDigest = await computeHash({
            merkleRoot: receipt.merkleRoot,
            timestamp: receipt.timestamp,
            protocol: receipt.protocol,
          });
          if (receipt.tokenDigest !== expectedTokenDigest) errors.push({ code: 'timestamp_token_mismatch' });
        }
        if (!knownMerkleRoots.has(receipt.merkleRoot)) errors.push({ code: 'timestamp_root_unknown' });
      } catch {
        errors.push({ code: 'malformed_receipt' });
      }
    }
    const firstBroken = errors.find((error) => error.sequence !== undefined)?.sequence;
    return {
      isValid: errors.length === 0,
      ...(firstBroken === undefined ? {} : { brokenSequence: firstBroken }),
      errors,
      legacyStatuses: this.state.legacyBundles.map((bundle) => bundle.status),
    };
  }

  public async exportPortableBundle(snapshot?: Record<string, unknown>): Promise<PortableIntegrityBundle> {
    await this.ready();
    if (snapshot) await this.reconcileSnapshot(snapshot);
    this.reloadState();
    await this.logEvent(
      'integrity.proof.exported',
      'Propriétaire',
      `Export de la preuve portable · révision ${this.state.revision}`,
      { resource: { type: 'integrity_export', id: this.state.cartularyId } },
    );
    this.reloadState();
    return {
      formatVersion: 'cartularia-integrity-export-v1',
      canonicalizationVersion: CANONICALIZATION_VERSION,
      exportedAt: this.now(),
      cartularyId: this.state.cartularyId,
      revision: this.state.revision,
      contentDigest: this.state.contentDigest,
      integrityHead: this.state.integrityHead,
      integritySequence: this.state.integritySequence,
      merkleRoot: await buildMerkleRoot(this.state.events.map((event) => event.hash)),
      events: structuredClone(this.state.events),
      receipts: structuredClone(this.state.receipts),
      legacyBundles: structuredClone(this.state.legacyBundles),
      ...(snapshot ? { snapshot: structuredClone(snapshot) } : {}),
    };
  }

  public simulateTampering(sequenceNumber: number, newDetails: string) {
    this.reloadState();
    const event = this.state.events.find((candidate) => candidate.sequence === sequenceNumber);
    if (!event) return;
    event.details = newDetails;
    this.saveState();
  }

  public async migrateBrokenJournal(snapshot: Record<string, unknown>): Promise<void> {
    await this.ready();
    await this.withExclusiveLock(async () => {
      const persisted = this.readState();
      if (!persisted) {
        const rejectedStateRaw = this.storage.getItem(this.stateStorageKey);
        const rejectedEvents = [{
          storageKey: this.stateStorageKey,
          ...(rejectedStateRaw === null ? { missing: true } : { raw: rejectedStateRaw }),
        }];
        const bundleDigest = await computeHash({ events: rejectedEvents, receipts: [] });
        this.state = createEmptyState(this.state.cartularyId);
        this.state.legacyBundles.push({
          importedAt: this.now(),
          bundleDigest,
          status: 'legacy_unverifiable',
          eventCount: 0,
          events: rejectedEvents,
          receipts: [],
        });
        await this.appendEventLocked({
          action: 'legacy.journal.imported',
          actorId: 'system',
          details: 'État local absent ou illisible migré sans réécriture',
          requestId: `legacy-invalid-rollover-${bundleDigest.slice(7, 31)}`,
          resource: { type: 'legacy_journal', id: bundleDigest },
          nextRevision: 0,
          beforeDigest: null,
          afterDigest: ZERO_HASH,
        });
        this.saveState();
        return;
      }
      this.state = persisted;
      const events = structuredClone(this.state.events);
      const receipts = structuredClone(this.state.receipts);
      const bundleDigest = await computeHash({ events, receipts });
      const previousLegacyBundles = structuredClone(this.state.legacyBundles);
      this.state = createEmptyState(this.state.cartularyId);
      this.state.legacyBundles = [
        ...previousLegacyBundles,
        {
          importedAt: this.now(),
          bundleDigest,
          status: 'legacy_broken',
          eventCount: events.length,
          events,
          receipts,
        },
      ];
      await this.appendEventLocked({
        action: 'legacy.journal.imported',
        actorId: 'system',
        details: `Chaîne locale rompue migrée sans réécriture · ${events.length} événements`,
        requestId: `legacy-rollover-${bundleDigest.slice(7, 31)}`,
        resource: { type: 'legacy_journal', id: bundleDigest },
        nextRevision: 0,
        beforeDigest: null,
        afterDigest: ZERO_HASH,
      });
      this.saveState();
    });
    await this.reconcileSnapshot(snapshot, 'system');
  }
}
