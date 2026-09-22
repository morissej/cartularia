import { ACTIVE_CARTULARY_ID, IWC_CARTULARY_ID } from '../domain/cartularyIds.ts';
import { validateFileForUpload } from '../security/fileValidation.ts';

const DATABASE_NAME = 'cartularia-local-vault-v2';
const DATABASE_VERSION = 1;
const STATE_STORE = 'state';
const BINARY_STORE = 'binaries';
const CLOCK_STORAGE_KEY = 'cartularia-vault-clocks-v2';
const CARTULARY_ID_MIGRATION_KEY = 'cartularia-vault-cartulary-id-v3';
const CARTULARIA_KEY_PREFIX = 'cartularia-';
const LOCAL_INTENT_PREFIX = 'cartularia-vault-intent-v2::';
const BINARY_INTENT_PREFIX = 'cartularia-vault-binary-intent-v1::';
const IMPORT_VERSION_PREFIX = 'cartularia-vault-import-version-v1::';
const IMPORT_CONFLICT_PREFIX = 'cartularia-vault-import-conflict-v1::';
export const VAULT_UPDATED_EVENT = 'cartularia:vault-updated';

export type LocalBinaryKind = 'media' | 'owner_document' | 'condition_attachment';

export interface LocalBinaryInput {
  binaryId: string;
  kind: LocalBinaryKind;
  fileName: string;
  mimeType: string;
  sha256: string;
  blob: Blob;
}

export interface LocalStateWriteOptions {
  /** The import version associated with the caller's displayed state. */
  expectedImportVersion?: string | null;
}

export interface LocalStateRecord {
  id: string;
  cartularyId: string;
  key: string;
  value: string | null;
  updatedAt: number;
  dirty: boolean;
  deleted: boolean;
  cloudRevision: number;
  /** Absent only on legacy records, upgraded atomically before a public read. */
  localVersion?: string;
  localLineage?: string;
  localIntentVersion?: string;
  localIntentSequence?: number;
  localImportVersion?: string;
}

export interface LocalBinaryRecord {
  id: string;
  cartularyId: string;
  binaryId: string;
  kind: LocalBinaryKind;
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  blob: Blob | null;
  updatedAt: number;
  dirty: boolean;
  deleted: boolean;
  cloudRevision: number;
  cloudStoragePath: string | null;
  localVersion?: string;
  localLineage?: string;
  localIntentVersion?: string;
  localIntentSequence?: number;
}

type RecordMutation<T> = (current: T | null) => T | null;

export interface VaultBackend {
  listState(cartularyId: string): Promise<LocalStateRecord[]>;
  getState(id: string): Promise<LocalStateRecord | null>;
  putState(record: LocalStateRecord): Promise<void>;
  mutateState(id: string, update: RecordMutation<LocalStateRecord>): Promise<LocalStateRecord | null>;
  listBinaries(cartularyId: string): Promise<LocalBinaryRecord[]>;
  getBinary(id: string): Promise<LocalBinaryRecord | null>;
  putBinary(record: LocalBinaryRecord): Promise<void>;
  mutateBinary(id: string, update: RecordMutation<LocalBinaryRecord>): Promise<LocalBinaryRecord | null>;
  commitImport(id: string, binaries: LocalBinaryRecord[], update: (current: LocalStateRecord | null) => LocalStateRecord): Promise<LocalStateRecord>;
  deleteCartulary(cartularyId: string): Promise<void>;
}

export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_SCOPE_PREFIX = 'cartularia-scope::';
const IDENTITY_SCOPE_PREFIX = 'cartularia-identity-scope::';

export class LocalVaultAccessError extends Error {
  constructor() {
    super('Le cache privé est verrouillé. Confirmez votre session et vos droits pour le rouvrir.');
    this.name = 'LocalVaultAccessError';
  }
}

export class LocalVaultImportConflictError extends Error {
  constructor() {
    super('Un import a modifié cette liste dans une autre session. Votre saisie est conservée pour reprise ; rechargez la liste avant de réessayer.');
    this.name = 'LocalVaultImportConflictError';
  }
}

export class ScopedStorage implements StorageLike {
  private readonly prefix: string;
  private readonly storage: StorageLike;

  constructor(
    storage: StorageLike,
    cartularyId: string,
    identityUid?: string,
  ) {
    this.storage = storage;
    this.prefix = identityUid === undefined
      ? `${STORAGE_SCOPE_PREFIX}${cartularyId}::`
      : `${IDENTITY_SCOPE_PREFIX}${encodeURIComponent(identityUid)}::${encodeURIComponent(cartularyId)}::`;
  }

  private scopedKey(key: string) {
    return `${this.prefix}${key}`;
  }

  private logicalKeys() {
    return Array.from({ length: this.storage.length }, (_, index) => this.storage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith(this.prefix)))
      .map((key) => key.slice(this.prefix.length));
  }

  get length() {
    return this.logicalKeys().length;
  }

  key(index: number) {
    return this.logicalKeys()[index] ?? null;
  }

  getItem(key: string) {
    return this.storage.getItem(this.scopedKey(key));
  }

  setItem(key: string, value: string) {
    this.storage.setItem(this.scopedKey(key), value);
  }

  removeItem(key: string) {
    this.storage.removeItem(this.scopedKey(key));
  }
}

export const scopedStorageForCartulary = (storage: StorageLike, cartularyId: string) => (
  new ScopedStorage(storage, cartularyId)
);

/** Identity must already have been verified by the caller; this is isolation, not encryption. */
export const scopedStorageForIdentity = (storage: StorageLike, uid: string, cartularyId: string) => {
  if (!uid || !cartularyId) throw new LocalVaultAccessError();
  return new ScopedStorage(storage, cartularyId, uid);
};

class SessionStorage implements StorageLike {
  private readonly storage: StorageLike;
  private readonly isAccessible: () => boolean;

  constructor(storage: StorageLike, isAccessible: () => boolean) {
    this.storage = storage;
    this.isAccessible = isAccessible;
  }

  get length() { return this.isAccessible() ? this.storage.length : 0; }
  key(index: number) { return this.isAccessible() ? this.storage.key(index) : null; }
  getItem(key: string) { return this.isAccessible() ? this.storage.getItem(key) : null; }
  setItem(key: string, value: string) {
    if (!this.isAccessible()) throw new LocalVaultAccessError();
    this.storage.setItem(key, value);
  }
  removeItem(key: string) {
    if (!this.isAccessible()) throw new LocalVaultAccessError();
    this.storage.removeItem(key);
  }
}

/** Persist immutable identity namespaces while exposing the real cartularyId to cloud callers. */
class IdentityVaultBackend implements VaultBackend {
  private readonly backend: VaultBackend;
  private readonly prefix: string;

  constructor(backend: VaultBackend, uid: string) {
    this.backend = backend;
    this.prefix = `identity::${encodeURIComponent(uid)}::`;
  }

  private encode<T extends LocalStateRecord | LocalBinaryRecord>(record: T): T {
    return { ...record, id: this.prefix + record.id, cartularyId: this.prefix + record.cartularyId };
  }

  private decode<T extends LocalStateRecord | LocalBinaryRecord>(record: T | null): T | null {
    if (!record || !record.id.startsWith(this.prefix) || !record.cartularyId.startsWith(this.prefix)) return null;
    return { ...record, id: record.id.slice(this.prefix.length), cartularyId: record.cartularyId.slice(this.prefix.length) };
  }

  async listState(cartularyId: string) {
    return (await this.backend.listState(this.prefix + cartularyId))
      .map((record) => this.decode(record)).filter((record): record is LocalStateRecord => record !== null);
  }
  async getState(id: string) { return this.decode(await this.backend.getState(this.prefix + id)); }
  putState(record: LocalStateRecord) { return this.backend.putState(this.encode(record)); }
  async mutateState(id: string, update: RecordMutation<LocalStateRecord>) {
    return this.decode(await this.backend.mutateState(this.prefix + id, (current) => {
      const next = update(this.decode(current));
      return next ? this.encode(next) : null;
    }));
  }
  async listBinaries(cartularyId: string) {
    return (await this.backend.listBinaries(this.prefix + cartularyId))
      .map((record) => this.decode(record)).filter((record): record is LocalBinaryRecord => record !== null);
  }
  async getBinary(id: string) { return this.decode(await this.backend.getBinary(this.prefix + id)); }
  putBinary(record: LocalBinaryRecord) { return this.backend.putBinary(this.encode(record)); }
  async mutateBinary(id: string, update: RecordMutation<LocalBinaryRecord>) {
    return this.decode(await this.backend.mutateBinary(this.prefix + id, (current) => {
      const next = update(this.decode(current));
      return next ? this.encode(next) : null;
    }));
  }
  async commitImport(id: string, binaries: LocalBinaryRecord[], update: (current: LocalStateRecord | null) => LocalStateRecord) {
    const result = await this.backend.commitImport(this.prefix + id, binaries.map((record) => this.encode(record)), (current) => (
      this.encode(update(this.decode(current)))
    ));
    return this.decode(result)!;
  }
  deleteCartulary(cartularyId: string) { return this.backend.deleteCartulary(this.prefix + cartularyId); }
}

const stateId = (cartularyId: string, key: string) => `${cartularyId}::${key}`;
const binaryRecordId = (cartularyId: string, binaryId: string) => `${cartularyId}::${binaryId}`;
const importCollision = () => new Error('Un original portant cet identifiant existe déjà. Aucun fichier n’a été importé.');
const assertUniqueImportIds = (binaries: LocalBinaryRecord[]) => {
  if (new Set(binaries.map((record) => record.id)).size !== binaries.length) throw importCollision();
};

const requestResult = <T,>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Échec IndexedDB.'));
});

const transactionDone = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error ?? new Error('Transaction IndexedDB échouée.'));
  transaction.onabort = () => reject(transaction.error ?? new Error('Transaction IndexedDB annulée.'));
});

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (!globalThis.indexedDB) {
    reject(new Error('IndexedDB est indisponible dans ce navigateur.'));
    return;
  }
  let settled = false;
  const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STATE_STORE)) {
      const state = database.createObjectStore(STATE_STORE, { keyPath: 'id' });
      state.createIndex('cartularyId', 'cartularyId', { unique: false });
    }
    if (!database.objectStoreNames.contains(BINARY_STORE)) {
      const binaries = database.createObjectStore(BINARY_STORE, { keyPath: 'id' });
      binaries.createIndex('cartularyId', 'cartularyId', { unique: false });
    }
  };
  request.onsuccess = () => {
    if (settled) {
      request.result.close();
      return;
    }
    settled = true;
    resolve(request.result);
  };
  request.onerror = () => {
    if (settled) return;
    settled = true;
    reject(request.error ?? new Error('Ouverture IndexedDB impossible.'));
  };
  request.onblocked = () => {
    if (settled) return;
    settled = true;
    reject(new Error('Ouverture IndexedDB bloquée par une autre session.'));
  };
});

export class IndexedDbVaultBackend implements VaultBackend {
  private databasePromise: Promise<IDBDatabase> | null = null;

  private database() {
    this.databasePromise ??= openDatabase();
    return this.databasePromise;
  }

  public async hasCartularyData(cartularyId: string) {
    const database = await this.database();
    const transaction = database.transaction([STATE_STORE, BINARY_STORE], 'readonly');
    const keys = await Promise.all([STATE_STORE, BINARY_STORE].map((store) => (
      requestResult(transaction.objectStore(store).index('cartularyId').getKey(cartularyId))
    )));
    return keys.some((key) => key !== undefined);
  }

  public async listState(cartularyId: string) {
    const database = await this.database();
    const transaction = database.transaction(STATE_STORE, 'readonly');
    return requestResult(transaction.objectStore(STATE_STORE).index('cartularyId').getAll(cartularyId)) as Promise<LocalStateRecord[]>;
  }

  public async getState(id: string) {
    const database = await this.database();
    const transaction = database.transaction(STATE_STORE, 'readonly');
    return (await requestResult(transaction.objectStore(STATE_STORE).get(id)) as LocalStateRecord | undefined) ?? null;
  }

  public async putState(record: LocalStateRecord) {
    const database = await this.database();
    const transaction = database.transaction(STATE_STORE, 'readwrite');
    transaction.objectStore(STATE_STORE).put(record);
    await transactionDone(transaction);
  }

  private async mutate<T extends LocalStateRecord | LocalBinaryRecord>(storeName: string, id: string, update: RecordMutation<T>): Promise<T | null> {
    const database = await this.database();
    const transaction = database.transaction(storeName, 'readwrite');
    const completion = transactionDone(transaction);
    const store = transaction.objectStore(storeName);
    let result: T | null = null;
    let failure: unknown;
    const request = store.get(id);
    // No await between read/compare/write: one real IDB transaction serializes
    // both connections and browser tabs, not only this vault instance's queue.
    request.onsuccess = () => {
      try {
        const current = (request.result as T | undefined) ?? null;
        const next = update(current);
        result = next ?? current;
        if (next) store.put(next);
      } catch (error) { failure = error; transaction.abort(); }
    };
    try { await completion; } catch (error) { throw failure ?? error; }
    return result;
  }

  public mutateState(id: string, update: RecordMutation<LocalStateRecord>) {
    return this.mutate(STATE_STORE, id, update);
  }

  public mutateBinary(id: string, update: RecordMutation<LocalBinaryRecord>) {
    return this.mutate(BINARY_STORE, id, update);
  }

  public async listBinaries(cartularyId: string) {
    const database = await this.database();
    const transaction = database.transaction(BINARY_STORE, 'readonly');
    return requestResult(transaction.objectStore(BINARY_STORE).index('cartularyId').getAll(cartularyId)) as Promise<LocalBinaryRecord[]>;
  }

  public async getBinary(id: string) {
    const database = await this.database();
    const transaction = database.transaction(BINARY_STORE, 'readonly');
    return (await requestResult(transaction.objectStore(BINARY_STORE).get(id)) as LocalBinaryRecord | undefined) ?? null;
  }

  public async putBinary(record: LocalBinaryRecord) {
    const database = await this.database();
    const transaction = database.transaction(BINARY_STORE, 'readwrite');
    transaction.objectStore(BINARY_STORE).put(record);
    await transactionDone(transaction);
  }

  public async commitImport(id: string, binaries: LocalBinaryRecord[], update: (current: LocalStateRecord | null) => LocalStateRecord) {
    assertUniqueImportIds(binaries);
    const database = await this.database();
    const transaction = database.transaction([STATE_STORE, BINARY_STORE], 'readwrite');
    const completion = transactionDone(transaction);
    const states = transaction.objectStore(STATE_STORE);
    const originals = transaction.objectStore(BINARY_STORE);
    let remaining = binaries.length + 1;
    let current: LocalStateRecord | null = null;
    let result: LocalStateRecord;
    let failure: unknown;
    const readCompleted = () => {
      if (--remaining > 0) return;
      try {
        result = update(current);
        if (result.id !== id) throw new Error('Référence locale d’import invalide.');
        // add, not put: even an unexpected identity collision must abort the
        // same transaction that contains every Blob and the reference row.
        for (const binary of binaries) originals.add(binary);
        states.put(result);
      } catch (error) { failure = error; transaction.abort(); }
    };
    const state = states.get(id);
    state.onsuccess = () => { current = state.result ?? null; readCompleted(); };
    for (const binary of binaries) {
      const existing = originals.getKey(binary.id);
      existing.onsuccess = () => {
        if (existing.result !== undefined) { failure = importCollision(); transaction.abort(); return; }
        readCompleted();
      };
    }
    try { await completion; } catch (error) { throw failure ?? error; }
    return result!;
  }

  public async deleteCartulary(cartularyId: string) {
    const database = await this.database();
    for (const storeName of [STATE_STORE, BINARY_STORE]) {
      const transaction = database.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const cursor = store.index('cartularyId').openCursor(IDBKeyRange.only(cartularyId));
      cursor.onsuccess = () => {
        const record = cursor.result;
        if (!record) return;
        record.delete();
        record.continue();
      };
      await transactionDone(transaction);
    }
  }
}

export class MemoryVaultBackend implements VaultBackend {
  public readonly state = new Map<string, LocalStateRecord>();
  public readonly binaries = new Map<string, LocalBinaryRecord>();

  async listState(cartularyId: string) {
    return [...this.state.values()].filter((record) => record.cartularyId === cartularyId).map((record) => structuredClone(record));
  }

  async getState(id: string) {
    const record = this.state.get(id);
    return record ? structuredClone(record) : null;
  }

  async putState(record: LocalStateRecord) {
    this.state.set(record.id, structuredClone(record));
  }

  async mutateState(id: string, update: RecordMutation<LocalStateRecord>) {
    const current = this.state.get(id);
    const next = update(current ? structuredClone(current) : null);
    if (next) this.state.set(id, structuredClone(next));
    return structuredClone(next ?? current ?? null);
  }

  async listBinaries(cartularyId: string) {
    return [...this.binaries.values()].filter((record) => record.cartularyId === cartularyId).map((record) => structuredClone(record));
  }

  async getBinary(id: string) {
    const record = this.binaries.get(id);
    return record ? structuredClone(record) : null;
  }

  async putBinary(record: LocalBinaryRecord) {
    this.binaries.set(record.id, structuredClone(record));
  }

  async mutateBinary(id: string, update: RecordMutation<LocalBinaryRecord>) {
    const current = this.binaries.get(id);
    const next = update(current ? structuredClone(current) : null);
    if (next) this.binaries.set(id, structuredClone(next));
    return structuredClone(next ?? current ?? null);
  }

  async commitImport(id: string, binaries: LocalBinaryRecord[], update: (current: LocalStateRecord | null) => LocalStateRecord) {
    assertUniqueImportIds(binaries);
    if (binaries.some((record) => this.binaries.has(record.id))) throw importCollision();
    const current = this.state.get(id);
    const next = structuredClone(update(current ? structuredClone(current) : null));
    if (next.id !== id) throw new Error('Référence locale d’import invalide.');
    const originals = binaries.map((record) => structuredClone(record));
    const result = structuredClone(next);
    // Every fallible preparation precedes the synchronous commit of both maps.
    for (const record of originals) this.binaries.set(record.id, record);
    this.state.set(id, next);
    return result;
  }

  async deleteCartulary(cartularyId: string) {
    [...this.state.values()].filter((record) => record.cartularyId === cartularyId).forEach((record) => this.state.delete(record.id));
    [...this.binaries.values()].filter((record) => record.cartularyId === cartularyId).forEach((record) => this.binaries.delete(record.id));
  }
}

const readClocks = (storage: StorageLike): Record<string, number> => {
  try {
    const parsed = JSON.parse(storage.getItem(CLOCK_STORAGE_KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => (
      typeof entry[1] === 'number' && Number.isFinite(entry[1])
    )));
  } catch {
    return {};
  }
};

const writeClocks = (storage: StorageLike, clocks: Record<string, number>) => {
  storage.setItem(CLOCK_STORAGE_KEY, JSON.stringify(clocks));
};

const isPersistableKey = (key: string) => (
  key.startsWith(CARTULARIA_KEY_PREFIX)
  && key !== CLOCK_STORAGE_KEY
  && key !== CARTULARY_ID_MIGRATION_KEY
  && !key.startsWith('cartularia-vault-intent-')
  && !key.startsWith(BINARY_INTENT_PREFIX)
  && !key.startsWith(IMPORT_VERSION_PREFIX)
  && !key.startsWith(IMPORT_CONFLICT_PREFIX)
);

const newLocalVersion = () => globalThis.crypto.randomUUID();
const localLineage = (current: LocalStateRecord | LocalBinaryRecord | null) => current?.localLineage ?? newLocalVersion();
const needsLocalIdentity = (record: LocalStateRecord | LocalBinaryRecord) => !record.localVersion || !record.localLineage;
const upgradeLocalIdentity = <T extends LocalStateRecord | LocalBinaryRecord>(record: T): T => ({
  ...record, localVersion: record.localVersion ?? newLocalVersion(), localLineage: localLineage(record),
});
const canRebaseLocalVersion = (current: LocalStateRecord | LocalBinaryRecord, expected: LocalStateRecord | LocalBinaryRecord) => (
  Boolean(current.localLineage && current.localLineage === expected.localLineage && current.cloudRevision === expected.cloudRevision)
);
const sameLocalVersion = <T extends LocalStateRecord | LocalBinaryRecord>(current: T | null, expected: T | null | undefined) => (
  expected === null ? current === null : Boolean(current?.localVersion && expected?.localVersion && current.localVersion === expected.localVersion)
);
interface LocalStateIntent {
  key: string;
  version: string;
  sequence: number;
  updatedAt: number;
  value?: string | null;
  deleted?: boolean;
  committed?: true;
  importVersion?: string | null;
}
const intentOrder = (left: Pick<LocalStateIntent, 'sequence' | 'version'>, right: Pick<LocalStateIntent, 'sequence' | 'version'>) => (
  left.sequence - right.sequence || left.version.localeCompare(right.version)
);

export class CartulariaLocalVault {
  private queue: Promise<unknown> = Promise.resolve();
  private accessible = true;
  public readonly cartularyId: string;
  public readonly identityUid: string | null;
  private readonly backend: VaultBackend;
  private readonly storage: StorageLike;
  private readonly now: () => number;

  constructor(
    cartularyId: string,
    backend: VaultBackend,
    storage: StorageLike,
    now: () => number = () => Date.now(),
    identityUid: string | null = null,
  ) {
    this.cartularyId = cartularyId;
    this.backend = backend;
    this.storage = storage;
    this.now = now;
    this.identityUid = identityUid;
  }

  public get isAccessible() { return this.accessible; }

  public assertAccessible() {
    if (!this.accessible) throw new LocalVaultAccessError();
  }

  public revokeAccess() { this.accessible = false; }

  private enqueue<T>(operation: () => Promise<T>, preserveAcceptedLocalWrite = false): Promise<T> {
    if (!this.accessible) return Promise.reject(new LocalVaultAccessError());
    const run = async () => {
      if (!preserveAcceptedLocalWrite) this.assertAccessible();
      return operation();
    };
    const result = this.queue.then(run, run);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private notifyUpdated() {
    if (this.accessible && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(VAULT_UPDATED_EVENT));
  }

  private intentStorageKey(intent: Pick<LocalStateIntent, 'key' | 'version'>, prefix = LOCAL_INTENT_PREFIX) {
    return `${prefix}${encodeURIComponent(intent.key)}::${intent.version}`;
  }

  private readIntents(prefix: string, key?: string): LocalStateIntent[] {
    const entries: LocalStateIntent[] = [];
    const keys = Array.from({ length: this.storage.length }, (_, index) => this.storage.key(index));
    for (const storageKey of keys) {
      if (!storageKey?.startsWith(prefix)) continue;
      try {
        const intent = JSON.parse(this.storage.getItem(storageKey) ?? 'null') as LocalStateIntent | null;
        if (!intent || typeof intent.key !== 'string' || (prefix === LOCAL_INTENT_PREFIX && !isPersistableKey(intent.key))
          || (key !== undefined && intent.key !== key) || typeof intent.version !== 'string'
          || !Number.isSafeInteger(intent.sequence) || intent.sequence < 1 || !Number.isFinite(intent.updatedAt)
          || this.intentStorageKey(intent, prefix) !== storageKey) continue;
        if (prefix === LOCAL_INTENT_PREFIX && intent.committed !== true && (typeof intent.deleted !== 'boolean'
          || (intent.deleted ? intent.value !== null : typeof intent.value !== 'string'))) continue;
        entries.push(intent);
      } catch { /* An incomplete legacy marker cannot establish a version or overwrite a value. */ }
    }
    return entries.sort(intentOrder);
  }

  private stateIntents(key?: string) { return this.readIntents(LOCAL_INTENT_PREFIX, key); }

  private appendBinaryIntent(binaryId: string): LocalStateIntent {
    const latest = this.readIntents(BINARY_INTENT_PREFIX, binaryId).at(-1);
    const intent = { key: binaryId, version: newLocalVersion(), sequence: (latest?.sequence ?? 0) + 1, updatedAt: this.now() };
    // Only ordering metadata is synchronous; the Blob still belongs in IndexedDB.
    this.storage.setItem(this.intentStorageKey(intent, BINARY_INTENT_PREFIX), JSON.stringify(intent));
    return intent;
  }

  private binaryIntentIsObsolete(current: LocalBinaryRecord | null, intent: LocalStateIntent) {
    if (!current?.localIntentVersion || current.localIntentSequence === undefined) return false;
    if (current.localIntentVersion === intent.version) return true;
    const knownReceipt = !this.accessible || this.readIntents(BINARY_INTENT_PREFIX, intent.key)
      .some((entry) => entry.version === current.localIntentVersion);
    return knownReceipt && intentOrder(intent, { version: current.localIntentVersion, sequence: current.localIntentSequence }) <= 0;
  }

  private finishBinaryIntent(record: LocalBinaryRecord) {
    if (!this.accessible || !record.localIntentVersion || record.localIntentSequence === undefined) return;
    const checkpoint: LocalStateIntent = { key: record.binaryId, version: record.localIntentVersion,
      sequence: record.localIntentSequence, updatedAt: record.updatedAt, committed: true };
    this.storage.setItem(this.intentStorageKey(checkpoint, BINARY_INTENT_PREFIX), JSON.stringify(checkpoint));
    for (const intent of this.readIntents(BINARY_INTENT_PREFIX, record.binaryId)) {
      if (intentOrder(intent, checkpoint) < 0) this.storage.removeItem(this.intentStorageKey(intent, BINARY_INTENT_PREFIX));
    }
  }

  private pendingStateIntent(key: string, current: LocalStateRecord | null): LocalStateIntent | null {
    const entries = this.stateIntents(key);
    const latest = entries.at(-1);
    if (!latest || latest.committed || latest.version === current?.localIntentVersion) return null;
    // A compact consumed checkpoint distinguishes pre-crash leftovers from edits
    // made after the synchronous cache was cleared.
    if (current?.localIntentVersion && current.localIntentSequence !== undefined
      && entries.some((entry) => entry.version === current.localIntentVersion)
      && intentOrder(latest, { version: current.localIntentVersion, sequence: current.localIntentSequence }) <= 0) return null;
    return latest;
  }

  public getImportVersion(key: string): string | null {
    this.assertAccessible();
    return this.storage.getItem(`${IMPORT_VERSION_PREFIX}${encodeURIComponent(key)}`);
  }

  private importConflictKey(intent: Pick<LocalStateIntent, 'key' | 'version'>) {
    return `${IMPORT_CONFLICT_PREFIX}${encodeURIComponent(intent.key)}::${intent.version}`;
  }

  private assertStateImportVersion(key: string, intent: LocalStateIntent, current: LocalStateRecord | null) {
    if ((intent.importVersion ?? null) === (current?.localImportVersion ?? null)) return;
    if (this.accessible) {
      try {
        // The preserved payload is no longer eligible for automatic replay.
        // Copy first so a quota error cannot erase the user's accepted input.
        const obsolete = this.stateIntents(key).filter((entry) => !entry.committed
          && entry.version !== current?.localIntentVersion
          && (entry.importVersion ?? null) !== (current?.localImportVersion ?? null));
        for (const entry of obsolete) {
          this.storage.setItem(this.importConflictKey(entry),
            JSON.stringify({ ...entry, reason: 'import-version-conflict', currentImportVersion: current?.localImportVersion ?? null }));
          this.storage.removeItem(this.intentStorageKey(entry));
        }
        if (current && !this.pendingStateIntent(key, current)) this.projectState(current);
      } catch { /* Unquarantined input still fails the same atomic version check on retry. */ }
    }
    throw new LocalVaultImportConflictError();
  }

  private appendStateIntent(key: string, value: string | null, options: LocalStateWriteOptions = {}): LocalStateIntent {
    const latest = this.stateIntents(key).at(-1);
    const intent: LocalStateIntent = {
      key, value, deleted: value === null, version: newLocalVersion(),
      sequence: (latest?.sequence ?? 0) + 1, updatedAt: this.now(),
      importVersion: options.expectedImportVersion === undefined ? this.getImportVersion(key) : options.expectedImportVersion,
    };
    // Durable payload first: quota failure leaves the visible value and previous
    // intentions intact instead of accepting an unrecoverable edit.
    this.storage.setItem(this.intentStorageKey(intent), JSON.stringify(intent));
    return intent;
  }

  private finishStateIntent(record: LocalStateRecord) {
    if (!this.accessible || !record.localIntentVersion || record.localIntentSequence === undefined) return;
    const checkpoint: LocalStateIntent = {
      key: record.key, version: record.localIntentVersion, sequence: record.localIntentSequence,
      updatedAt: record.updatedAt, committed: true,
      importVersion: record.localImportVersion ?? null,
    };
    // Only this UUID is compacted, after its receipt and content committed
    // atomically in IndexedDB. No shared pointer can overwrite a newer intent.
    this.storage.setItem(this.intentStorageKey(checkpoint), JSON.stringify(checkpoint));
    for (const intent of this.stateIntents(record.key)) {
      if (intentOrder(intent, checkpoint) < 0) this.storage.removeItem(this.intentStorageKey(intent));
    }
  }

  private projectState(record: LocalStateRecord) {
    this.assertAccessible();
    if (record.deleted) this.storage.removeItem(record.key);
    else if (record.value !== null) this.storage.setItem(record.key, record.value);
    const clocks = readClocks(this.storage);
    clocks[record.key] = record.updatedAt;
    writeClocks(this.storage, clocks);
    const importVersionKey = `${IMPORT_VERSION_PREFIX}${encodeURIComponent(record.key)}`;
    if (record.localImportVersion) this.storage.setItem(importVersionKey, record.localImportVersion);
    else this.storage.removeItem(importVersionKey);
    // Projection never rewrites an intention; another tab may stage one even
    // between the caller's check and these synchronous display writes.
  }

  private async projectCurrentState(record: LocalStateRecord) {
    await this.backend.mutateState(record.id, (current) => {
      this.assertAccessible();
      if (current && sameLocalVersion(current, record) && !this.pendingStateIntent(record.key, current)) this.projectState(current);
      return null;
    });
    this.assertAccessible();
  }

  private async persistStateIntents(key: string, acceptedBeforeLock?: LocalStateIntent) {
    const record = await this.backend.mutateState(stateId(this.cartularyId, key), (current) => {
      const intent = this.accessible ? this.pendingStateIntent(key, current) : acceptedBeforeLock;
      if (!intent || intent.committed || intent.version === current?.localIntentVersion) return null;
      if (!this.accessible && current?.localIntentVersion && current.localIntentSequence !== undefined
        && intentOrder(intent, { version: current.localIntentVersion, sequence: current.localIntentSequence }) <= 0) return null;
      this.assertStateImportVersion(key, intent, current);
      return {
        id: stateId(this.cartularyId, key), cartularyId: this.cartularyId, key,
        value: intent.value!, deleted: intent.deleted!, updatedAt: intent.updatedAt,
        localVersion: intent.version, localLineage: localLineage(current),
        localIntentVersion: intent.version, localIntentSequence: intent.sequence,
        localImportVersion: current?.localImportVersion,
        dirty: true, cloudRevision: current?.cloudRevision ?? 0,
      };
    });
    if (acceptedBeforeLock && this.accessible && this.storage.getItem(this.importConflictKey(acceptedBeforeLock)) !== null) {
      throw new LocalVaultImportConflictError();
    }
    if (record && this.accessible) {
      this.finishStateIntent(record);
      await this.projectCurrentState(record);
    }
    return record;
  }

  public async flush() {
    await this.queue;
  }

  public writeJson(key: string, value: unknown, options: LocalStateWriteOptions = {}): Promise<void> {
    return this.writeRaw(key, JSON.stringify(value), options);
  }

  public writeRaw(key: string, value: string, options: LocalStateWriteOptions = {}): Promise<void> {
    if (!this.accessible) return Promise.reject(new LocalVaultAccessError());
    if (!isPersistableKey(key)) return Promise.reject(new Error(`Clé locale Cartularia invalide : ${key}`));
    if (this.storage.getItem(key) === value) return Promise.resolve();
    const intent = this.appendStateIntent(key, value, options);
    this.storage.setItem(key, value);
    const clocks = readClocks(this.storage);
    clocks[key] = intent.updatedAt;
    writeClocks(this.storage, clocks);
    return this.enqueue(async () => {
      await this.persistStateIntents(key, intent);
      this.notifyUpdated();
    }, true);
  }

  public removeKey(key: string): Promise<void> {
    if (!this.accessible) return Promise.reject(new LocalVaultAccessError());
    if (!isPersistableKey(key)) return Promise.reject(new Error(`Clé locale Cartularia invalide : ${key}`));
    const intent = this.appendStateIntent(key, null);
    this.storage.removeItem(key);
    const clocks = readClocks(this.storage);
    clocks[key] = intent.updatedAt;
    writeClocks(this.storage, clocks);
    return this.enqueue(async () => {
      await this.persistStateIntents(key, intent);
      this.notifyUpdated();
    }, true);
  }

  public mirrorLocalStorage(): Promise<void> {
    return this.enqueue(async () => {
      this.assertAccessible();
      const keys = new Set([
        ...Array.from({ length: this.storage.length }, (_, index) => this.storage.key(index))
          .filter((key): key is string => Boolean(key && isPersistableKey(key))),
        ...this.stateIntents().map((intent) => intent.key),
      ]);
      for (const key of keys) {
        this.assertAccessible();
        await this.persistStateIntents(key);
        const mirrored = await this.backend.mutateState(stateId(this.cartularyId, key), (current) => {
          this.assertAccessible();
          // A delayed display mirror is not an edit of a versioned row. All
          // application writes carry a durable intent; only legacy raw data imports.
          if (current?.localVersion) return null;
          const value = this.storage.getItem(key);
          if (value === null) return current ? upgradeLocalIdentity(current) : null;
          return { id: stateId(this.cartularyId, key), cartularyId: this.cartularyId, key, value,
            updatedAt: readClocks(this.storage)[key] ?? this.now(), localVersion: newLocalVersion(),
            localLineage: localLineage(current), dirty: true, deleted: false, cloudRevision: current?.cloudRevision ?? 0 };
        });
        if (mirrored) await this.projectCurrentState(mirrored);
      }
    });
  }

  public restoreLocalStorage(): Promise<void> {
    return this.enqueue(async () => {
      const records = await this.backend.listState(this.cartularyId);
      this.assertAccessible();
      // Replay new keys and tombstones even if the author's first IDB write never ran.
      const keys = new Set([...records.map((record) => record.key), ...this.stateIntents().map((intent) => intent.key)]);
      for (const key of keys) {
        this.assertAccessible();
        await this.persistStateIntents(key);
        const restored = await this.backend.mutateState(stateId(this.cartularyId, key), (current) => {
          this.assertAccessible();
          if (!current || current.localVersion) return null;
          const localUpdatedAt = readClocks(this.storage)[key] ?? 0;
          if (localUpdatedAt > current.updatedAt) {
            const value = this.storage.getItem(key);
            return { ...current, value, updatedAt: localUpdatedAt, localVersion: newLocalVersion(),
              localLineage: localLineage(current), dirty: true, deleted: value === null };
          }
          return upgradeLocalIdentity(current);
        });
        if (restored) await this.projectCurrentState(restored);
      }
    });
  }

  /** The caller validates content and hashes first; only this transaction makes
   * the prepared originals and their reference list durable together. */
  public commitImport(input: {
    key: string;
    binaries: LocalBinaryInput[];
    update: (current: string | null) => string;
  }): Promise<LocalStateRecord> {
    this.assertAccessible();
    if (!isPersistableKey(input.key) || typeof input.update !== 'function') {
      return Promise.reject(new Error('Référence locale d’import invalide.'));
    }
    const ids = new Set<string>();
    for (const binary of input.binaries) {
      if (!binary.binaryId || ids.has(binary.binaryId)) return Promise.reject(importCollision());
      ids.add(binary.binaryId);
      if (!['media', 'owner_document', 'condition_attachment'].includes(binary.kind)
        || !binary.fileName || !binary.mimeType || !(binary.blob instanceof Blob)
        || !/^(?:sha256:)?[a-f0-9]{64}$/i.test(binary.sha256)) {
        return Promise.reject(new Error('Original préparé invalide. Aucun fichier n’a été importé.'));
      }
    }
    // Capture inputs before the queue yields; a caller cannot change identities
    // or substitute an original while another local transaction is completing.
    const key = input.key;
    const update = input.update;
    const binaries: LocalBinaryRecord[] = input.binaries.map((binary) => ({
      ...binary, id: binaryRecordId(this.cartularyId, binary.binaryId), cartularyId: this.cartularyId,
      size: binary.blob.size, sha256: `sha256:${binary.sha256.replace(/^sha256:/i, '').toLowerCase()}`,
      updatedAt: this.now(), localVersion: newLocalVersion(), localLineage: newLocalVersion(),
      dirty: true, deleted: false, cloudRevision: 0, cloudStoragePath: null,
    }));
    return this.enqueue(async () => {
      const result = await this.backend.commitImport(stateId(this.cartularyId, key), binaries, (current) => {
        this.assertAccessible();
        // A pending non-batch put also owns its ID, even before its IDB commit.
        if (binaries.some((binary) => this.readIntents(BINARY_INTENT_PREFIX, binary.binaryId).length > 0)) throw importCollision();
        const latestIntent = this.stateIntents(key).at(-1)?.version;
        const pending = this.pendingStateIntent(key, current);
        if (pending) this.assertStateImportVersion(key, pending, current);
        const legacyValue = current?.localVersion ? null : this.storage.getItem(key);
        const value = pending ? pending.value! : legacyValue ?? (current?.deleted ? null : current?.value ?? null);
        const updatedValue = update(value);
        if (typeof updatedValue !== 'string') throw new Error('La référence locale d’import doit être sérialisée.');
        this.assertAccessible();
        if (this.stateIntents(key).at(-1)?.version !== latestIntent
          || (!current?.localVersion && this.storage.getItem(key) !== legacyValue)) {
          throw new Error('Une modification locale est survenue pendant l’import. Réessayez.');
        }
        return { id: stateId(this.cartularyId, key), cartularyId: this.cartularyId, key,
          value: updatedValue, updatedAt: this.now(), dirty: true, deleted: false,
          cloudRevision: current?.cloudRevision ?? 0, localVersion: newLocalVersion(), localLineage: localLineage(current),
          localImportVersion: newLocalVersion(),
          localIntentVersion: pending?.version ?? current?.localIntentVersion,
          localIntentSequence: pending?.sequence ?? current?.localIntentSequence };
      });
      // IDB is already committed. A blocked display cache or a session closed
      // afterwards must not turn success into an error inviting destructive cleanup.
      if (this.accessible) {
        try { this.finishStateIntent(result); } catch { /* The atomic receipt makes replay safe. */ }
        try { await this.projectCurrentState(result); } catch { /* Restored from IDB on the next opening. */ }
      }
      this.notifyUpdated();
      return result;
    });
  }

  public putBinary(input: {
    binaryId: string;
    kind: LocalBinaryKind;
    fileName: string;
    mimeType: string;
    sha256: string;
    blob: Blob;
  }): Promise<LocalBinaryRecord> {
    if (!this.accessible) return Promise.reject(new LocalVaultAccessError());
    const intent = this.appendBinaryIntent(input.binaryId);
    return this.enqueue(async () => {
      const id = binaryRecordId(this.cartularyId, input.binaryId);
      const record = await this.backend.mutateBinary(id, (current) => this.binaryIntentIsObsolete(current, intent) ? null : ({
        id,
        cartularyId: this.cartularyId,
        binaryId: input.binaryId,
        kind: input.kind,
        fileName: input.fileName,
        mimeType: input.mimeType || 'application/octet-stream',
        size: input.blob.size,
        sha256: input.sha256.startsWith('sha256:') ? input.sha256 : `sha256:${input.sha256}`,
        blob: input.blob,
        updatedAt: intent.updatedAt,
        localVersion: intent.version,
        localLineage: localLineage(current),
        localIntentVersion: intent.version,
        localIntentSequence: intent.sequence,
        dirty: true,
        deleted: false,
        cloudRevision: current?.cloudRevision ?? 0,
        cloudStoragePath: current?.cloudStoragePath ?? null,
      }));
      this.notifyUpdated();
      this.assertAccessible();
      if (!record || record.localVersion !== intent.version) throw new Error('Une modification plus récente a remplacé cet original local.');
      this.finishBinaryIntent(record);
      return record!;
    }, true);
  }

  public async putValidatedBinary(input: {
    binaryId: string;
    kind: LocalBinaryKind;
    fileName: string;
    mimeType: string;
    sha256: string;
    blob: Blob;
  }): Promise<LocalBinaryRecord> {
    this.assertAccessible();
    const inspection = await validateFileForUpload({
      blob: input.blob,
      fileName: input.fileName,
      declaredMimeType: input.mimeType,
      allowedKinds: input.kind === 'media' ? undefined : ['image', 'document'],
    });
    return this.putBinary({ ...input, mimeType: inspection.canonicalMimeType });
  }

  public deleteBinary(binaryId: string): Promise<void> {
    if (!this.accessible) return Promise.reject(new LocalVaultAccessError());
    const intent = this.appendBinaryIntent(binaryId);
    return this.enqueue(async () => {
      const id = binaryRecordId(this.cartularyId, binaryId);
      const record = await this.backend.mutateBinary(id, (current) => current && !this.binaryIntentIsObsolete(current, intent) ? ({
        ...current,
        blob: null,
        updatedAt: intent.updatedAt,
        localVersion: intent.version,
        localLineage: localLineage(current),
        localIntentVersion: intent.version,
        localIntentSequence: intent.sequence,
        dirty: true,
        deleted: true,
      }) : null);
      if (record && record.localVersion !== intent.version) {
        this.assertAccessible();
        throw new Error('Une modification plus récente a remplacé cet original local.');
      }
      if (record) this.finishBinaryIntent(record);
      this.notifyUpdated();
    }, true);
  }

  public async getBinary(binaryId: string) {
    this.assertAccessible();
    await this.flush();
    this.assertAccessible();
    const record = await this.backend.mutateBinary(binaryRecordId(this.cartularyId, binaryId), (current) => {
      this.assertAccessible();
      return current && needsLocalIdentity(current) ? upgradeLocalIdentity(current) : null;
    });
    this.assertAccessible();
    return record;
  }

  public async listStateRecords() {
    this.assertAccessible();
    await this.flush();
    this.assertAccessible();
    const records = await this.backend.listState(this.cartularyId);
    this.assertAccessible();
    return Promise.all(records.map((record) => this.backend.mutateState(record.id, (current) => {
      this.assertAccessible();
      return current && needsLocalIdentity(current) ? upgradeLocalIdentity(current) : null;
    }))).then((current) => { this.assertAccessible(); return current.filter((record): record is LocalStateRecord => record !== null); });
  }

  public async listBinaryRecords() {
    this.assertAccessible();
    await this.flush();
    this.assertAccessible();
    const records = await this.backend.listBinaries(this.cartularyId);
    this.assertAccessible();
    return Promise.all(records.map((record) => this.backend.mutateBinary(record.id, (current) => {
      this.assertAccessible();
      return current && needsLocalIdentity(current) ? upgradeLocalIdentity(current) : null;
    }))).then((current) => { this.assertAccessible(); return current.filter((record): record is LocalBinaryRecord => record !== null); });
  }

  private acknowledgeState(key: string, cloudRevision: number, expected: LocalStateRecord | undefined, clean: boolean): Promise<boolean> {
    return this.enqueue(async () => {
      let matched = false;
      await this.backend.mutateState(stateId(this.cartularyId, key), (current) => {
        this.assertAccessible();
        if (!current || !expected || expected.key !== key || expected.cartularyId !== this.cartularyId || cloudRevision < current.cloudRevision) return null;
        matched = sameLocalVersion(current, expected) && !this.pendingStateIntent(key, current);
        if (!matched && !canRebaseLocalVersion(current, expected)) return null;
        return { ...current, cloudRevision, dirty: matched && clean ? false : current.dirty };
      });
      this.assertAccessible();
      return matched;
    });
  }

  public markStateCloudSynced(key: string, cloudRevision: number, expected?: LocalStateRecord) {
    return this.acknowledgeState(key, cloudRevision, expected, true);
  }

  public rebaseStateCloudRevision(key: string, cloudRevision: number, expected: LocalStateRecord) {
    return this.acknowledgeState(key, cloudRevision, expected, false);
  }

  public prepareStateConflictResolution(key: string, cloudRevision: number, expected?: LocalStateRecord): Promise<boolean> {
    return this.enqueue(async () => {
      let applied = false;
      const record = await this.backend.mutateState(stateId(this.cartularyId, key), (current) => {
        this.assertAccessible();
        if (!current || !sameLocalVersion(current, expected) || cloudRevision < current.cloudRevision || this.pendingStateIntent(key, current)) return null;
        applied = true;
        return { ...current, dirty: true, cloudRevision, updatedAt: this.now(), localVersion: newLocalVersion() };
      });
      this.assertAccessible();
      if (applied && record) await this.projectCurrentState(record);
      return applied;
    });
  }

  public applyCloudState(record: LocalStateRecord, expected: LocalStateRecord | null = null, options: { allowDirty?: boolean } = {}): Promise<boolean> {
    return this.enqueue(async () => {
      let applied = false;
      const result = await this.backend.mutateState(stateId(this.cartularyId, record.key), (current) => {
        this.assertAccessible();
        if ((expected && (expected.key !== record.key || expected.cartularyId !== this.cartularyId))
          || !sameLocalVersion(current, expected) || (current?.dirty && !options.allowDirty)
          || (current && record.cloudRevision < current.cloudRevision) || this.pendingStateIntent(record.key, current)) return null;
        applied = true;
        return { ...record, id: stateId(this.cartularyId, record.key), cartularyId: this.cartularyId,
          dirty: false, localVersion: newLocalVersion(), localLineage: localLineage(current),
          localIntentVersion: current?.localIntentVersion, localIntentSequence: current?.localIntentSequence,
          localImportVersion: current?.localImportVersion };
      });
      this.assertAccessible();
      if (applied && result) await this.projectCurrentState(result);
      return applied;
    });
  }

  private acknowledgeBinary(binaryId: string, cloudRevision: number, expected: LocalBinaryRecord | undefined, clean: boolean, cloudStoragePath?: string | null): Promise<boolean> {
    return this.enqueue(async () => {
      let matched = false;
      await this.backend.mutateBinary(binaryRecordId(this.cartularyId, binaryId), (current) => {
        this.assertAccessible();
        if (!current || !expected || expected.binaryId !== binaryId || expected.cartularyId !== this.cartularyId || cloudRevision < current.cloudRevision) return null;
        matched = sameLocalVersion(current, expected);
        if (!matched && !canRebaseLocalVersion(current, expected)) return null;
        return { ...current, cloudRevision, dirty: matched && clean ? false : current.dirty,
          cloudStoragePath: matched && cloudStoragePath !== undefined ? cloudStoragePath : current.cloudStoragePath };
      });
      this.assertAccessible();
      return matched;
    });
  }

  public markBinaryCloudSynced(binaryId: string, cloudRevision: number, cloudStoragePath: string | null, expected?: LocalBinaryRecord) {
    return this.acknowledgeBinary(binaryId, cloudRevision, expected, true, cloudStoragePath);
  }

  public rebaseBinaryCloudRevision(binaryId: string, cloudRevision: number, expected: LocalBinaryRecord) {
    return this.acknowledgeBinary(binaryId, cloudRevision, expected, false);
  }

  public prepareBinaryConflictResolution(binaryId: string, cloudRevision: number, expected?: LocalBinaryRecord): Promise<boolean> {
    return this.enqueue(async () => {
      let applied = false;
      await this.backend.mutateBinary(binaryRecordId(this.cartularyId, binaryId), (current) => {
        this.assertAccessible();
        if (!current || !sameLocalVersion(current, expected) || cloudRevision < current.cloudRevision) return null;
        applied = true;
        return { ...current, dirty: true, cloudRevision, updatedAt: this.now(), localVersion: newLocalVersion() };
      });
      this.assertAccessible();
      return applied;
    });
  }

  public applyCloudBinary(record: LocalBinaryRecord, expected: LocalBinaryRecord | null = null, options: { allowDirty?: boolean } = {}): Promise<boolean> {
    return this.enqueue(async () => {
      let applied = false;
      await this.backend.mutateBinary(binaryRecordId(this.cartularyId, record.binaryId), (current) => {
        this.assertAccessible();
        if ((expected && (expected.binaryId !== record.binaryId || expected.cartularyId !== this.cartularyId))
          || !sameLocalVersion(current, expected) || (current?.dirty && !options.allowDirty)
          || (current && record.cloudRevision < current.cloudRevision)) return null;
        applied = true;
        return { ...record, id: binaryRecordId(this.cartularyId, record.binaryId), cartularyId: this.cartularyId,
          dirty: false, localVersion: newLocalVersion(), localLineage: localLineage(current),
          localIntentVersion: current?.localIntentVersion, localIntentSequence: current?.localIntentSequence };
      });
      this.assertAccessible();
      return applied;
    });
  }

  public async deleteAllLocalData() {
    this.assertAccessible();
    await this.flush();
    this.assertAccessible();
    await this.backend.deleteCartulary(this.cartularyId);
    this.assertAccessible();
    const keys = Array.from({ length: this.storage.length }, (_, index) => this.storage.key(index))
      .filter((key): key is string => Boolean(key && key.startsWith(CARTULARIA_KEY_PREFIX)));
    keys.forEach((key) => this.storage.removeItem(key));
  }
}

export const LEGACY_LOCAL_CARTULARY_ID = 'cartulary-iwc-utc-01';
export const DEFAULT_LOCAL_CARTULARY_ID = ACTIVE_CARTULARY_ID;

export const migrateLocalVaultCartularyId = async (
  backend: VaultBackend,
  sourceCartularyId: string,
  targetCartularyId: string,
) => {
  if (sourceCartularyId === targetCartularyId) return { state: 0, binaries: 0 };
  const [sourceState, sourceBinaries] = await Promise.all([
    backend.listState(sourceCartularyId),
    backend.listBinaries(sourceCartularyId),
  ]);
  let migratedState = 0;
  let migratedBinaries = 0;

  for (const record of sourceState) {
    await backend.mutateState(stateId(targetCartularyId, record.key), (current) => {
      if (current) return null;
      migratedState += 1;
      return { ...record, id: stateId(targetCartularyId, record.key), cartularyId: targetCartularyId,
        localVersion: newLocalVersion(), localLineage: newLocalVersion(), dirty: true, cloudRevision: 0 };
    });
  }
  for (const record of sourceBinaries) {
    await backend.mutateBinary(binaryRecordId(targetCartularyId, record.binaryId), (current) => {
      if (current) return null;
      migratedBinaries += 1;
      return { ...record, id: binaryRecordId(targetCartularyId, record.binaryId), cartularyId: targetCartularyId,
        localVersion: newLocalVersion(), localLineage: newLocalVersion(), dirty: true, cloudRevision: 0 };
    });
  }
  return { state: migratedState, binaries: migratedBinaries };
};

/**
 * The caller must confirm identity and cartulary permissions before creating this session.
 * Local storage remains plaintext on disk. This boundary prevents application reuse across
 * accounts and revokes stale handles; it is not cryptographic protection of the browser profile.
 */
export const createVerifiedLocalVaultSession = (input: {
  uid: string;
  cartularyId: string;
  backend: VaultBackend;
  storage: StorageLike;
  now?: () => number;
}) => {
  if (!input.uid || !input.cartularyId) throw new LocalVaultAccessError();
  let active = true;
  const storage: StorageLike = new SessionStorage(
    scopedStorageForIdentity(input.storage, input.uid, input.cartularyId),
    (): boolean => active && vault.isAccessible,
  );
  const vault: CartulariaLocalVault = new CartulariaLocalVault(
    input.cartularyId,
    new IdentityVaultBackend(input.backend, input.uid),
    storage,
    input.now,
    input.uid,
  );
  return {
    uid: input.uid,
    cartularyId: input.cartularyId,
    vault,
    storage,
    lock: () => {
      active = false;
      vault.revokeAccess();
    },
  };
};

const defaultBackend = new IndexedDbVaultBackend();
let activeSession: ReturnType<typeof createVerifiedLocalVaultSession> | null = null;

// Nothing private is readable on import, including when an old unscoped cache exists.
export let cartulariaStorage: StorageLike | null = null;
export let cartulariaLocalVault: CartulariaLocalVault | null = null;

export const lockCartulariaLocalState = () => {
  activeSession?.lock();
  activeSession = null;
  cartulariaStorage = null;
  cartulariaLocalVault = null;
};

/** Only call after a fresh authenticated, server-authoritative access decision. */
export const unlockCartulariaLocalState = (input: { uid: string; cartularyId: string }) => {
  if (typeof window === 'undefined') throw new LocalVaultAccessError();
  if (
    activeSession?.uid === input.uid
    && activeSession.cartularyId === input.cartularyId
    && activeSession.vault.isAccessible
  ) return activeSession.vault;
  lockCartulariaLocalState();
  activeSession = createVerifiedLocalVaultSession({
    ...input,
    backend: defaultBackend,
    storage: window.localStorage,
  });
  cartulariaStorage = activeSession.storage;
  cartulariaLocalVault = activeSession.vault;
  return activeSession.vault;
};

/**
 * Legacy data has no trustworthy account attribution. Leave it intact and quarantined;
 * ownership of a cartulary alone does not prove ownership of every historic browser draft.
 * Recovery requires a separate, explicit provenance check; never assign it to the first login.
 */
export const hasUnscopedLocalData = async (cartularyId = DEFAULT_LOCAL_CARTULARY_ID) => {
  if (typeof window === 'undefined') return false;
  const candidates = cartularyId === IWC_CARTULARY_ID
    ? [cartularyId, LEGACY_LOCAL_CARTULARY_ID]
    : [cartularyId];
  // Inspect keys only: detecting a legacy cache must not load its photos and documents.
  if ((await Promise.all(candidates.map((id) => defaultBackend.hasCartularyData(id)))).some(Boolean)) return true;
  const legacyStorage = scopedStorageForCartulary(window.localStorage, cartularyId);
  return Array.from({ length: legacyStorage.length }, (_, index) => legacyStorage.key(index))
    .some((key) => key !== null && isPersistableKey(key))
    || ['cartularia-owner-fields', 'cartularia-media-assets-v3', 'cartularia-specification-groups']
      .some((key) => window.localStorage.getItem(key) !== null);
};

export interface LocalStateRestoreResult {
  status: 'restored' | 'skipped' | 'unavailable';
  error?: unknown;
}

export const restoreCartulariaLocalState = async (): Promise<LocalStateRestoreResult> => {
  const vault = cartulariaLocalVault;
  if (!vault) return { status: 'skipped' };
  try {
    await vault.restoreLocalStorage();
    vault.assertAccessible();
    return { status: 'restored' };
  } catch (error) {
    console.error('Restauration du coffre local impossible', error);
    return { status: 'unavailable', error };
  }
};

export const persistCartulariaJson = (key: string, value: unknown, options: LocalStateWriteOptions = {}) => {
  if (!cartulariaLocalVault) return Promise.resolve();
  return cartulariaLocalVault.writeJson(key, value, options);
};

export const readCartulariaImportVersion = (key: string) => cartulariaLocalVault?.getImportVersion(key) ?? null;

export const readCartulariaStorage = (key: string) => cartulariaStorage?.getItem(key) ?? null;

export const mirrorCartulariaLocalStorage = () => cartulariaLocalVault?.mirrorLocalStorage() ?? Promise.resolve();
