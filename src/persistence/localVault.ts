import { ACTIVE_CARTULARY_ID, IWC_CARTULARY_ID } from '../domain/cartularyIds.ts';

const DATABASE_NAME = 'cartularia-local-vault-v2';
const DATABASE_VERSION = 1;
const STATE_STORE = 'state';
const BINARY_STORE = 'binaries';
const CLOCK_STORAGE_KEY = 'cartularia-vault-clocks-v2';
const CARTULARY_ID_MIGRATION_KEY = 'cartularia-vault-cartulary-id-v3';
const CARTULARIA_KEY_PREFIX = 'cartularia-';
export const VAULT_UPDATED_EVENT = 'cartularia:vault-updated';

export type LocalBinaryKind = 'media' | 'owner_document' | 'condition_attachment';

export interface LocalStateRecord {
  id: string;
  cartularyId: string;
  key: string;
  value: string | null;
  updatedAt: number;
  dirty: boolean;
  deleted: boolean;
  cloudRevision: number;
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
}

export interface VaultBackend {
  listState(cartularyId: string): Promise<LocalStateRecord[]>;
  getState(id: string): Promise<LocalStateRecord | null>;
  putState(record: LocalStateRecord): Promise<void>;
  listBinaries(cartularyId: string): Promise<LocalBinaryRecord[]>;
  getBinary(id: string): Promise<LocalBinaryRecord | null>;
  putBinary(record: LocalBinaryRecord): Promise<void>;
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

export class ScopedStorage implements StorageLike {
  private readonly prefix: string;
  private readonly storage: StorageLike;

  constructor(
    storage: StorageLike,
    cartularyId: string,
  ) {
    this.storage = storage;
    this.prefix = `${STORAGE_SCOPE_PREFIX}${cartularyId}::`;
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

const stateId = (cartularyId: string, key: string) => `${cartularyId}::${key}`;
const binaryRecordId = (cartularyId: string, binaryId: string) => `${cartularyId}::${binaryId}`;

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
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Ouverture IndexedDB impossible.'));
});

export class IndexedDbVaultBackend implements VaultBackend {
  private databasePromise: Promise<IDBDatabase> | null = null;

  private database() {
    this.databasePromise ??= openDatabase();
    return this.databasePromise;
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
);

export class CartulariaLocalVault {
  private queue: Promise<unknown> = Promise.resolve();
  public readonly cartularyId: string;
  private readonly backend: VaultBackend;
  private readonly storage: StorageLike;
  private readonly now: () => number;

  constructor(
    cartularyId: string,
    backend: VaultBackend,
    storage: StorageLike,
    now: () => number = () => Date.now(),
  ) {
    this.cartularyId = cartularyId;
    this.backend = backend;
    this.storage = storage;
    this.now = now;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private notifyUpdated() {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(VAULT_UPDATED_EVENT));
  }

  public async flush() {
    await this.queue;
  }

  public writeJson(key: string, value: unknown): Promise<void> {
    return this.writeRaw(key, JSON.stringify(value));
  }

  public writeRaw(key: string, value: string): Promise<void> {
    if (!isPersistableKey(key)) return Promise.reject(new Error(`Clé locale Cartularia invalide : ${key}`));
    if (this.storage.getItem(key) === value) return Promise.resolve();
    const updatedAt = this.now();
    this.storage.setItem(key, value);
    const clocks = readClocks(this.storage);
    clocks[key] = updatedAt;
    writeClocks(this.storage, clocks);
    return this.enqueue(async () => {
      const id = stateId(this.cartularyId, key);
      const current = await this.backend.getState(id);
      if (current && current.updatedAt > updatedAt) return;
      await this.backend.putState({
        id,
        cartularyId: this.cartularyId,
        key,
        value,
        updatedAt,
        dirty: true,
        deleted: false,
        cloudRevision: current?.cloudRevision ?? 0,
      });
      this.notifyUpdated();
    });
  }

  public removeKey(key: string): Promise<void> {
    if (!isPersistableKey(key)) return Promise.reject(new Error(`Clé locale Cartularia invalide : ${key}`));
    const updatedAt = this.now();
    this.storage.removeItem(key);
    const clocks = readClocks(this.storage);
    clocks[key] = updatedAt;
    writeClocks(this.storage, clocks);
    return this.enqueue(async () => {
      const id = stateId(this.cartularyId, key);
      const current = await this.backend.getState(id);
      await this.backend.putState({
        id,
        cartularyId: this.cartularyId,
        key,
        value: null,
        updatedAt,
        dirty: true,
        deleted: true,
        cloudRevision: current?.cloudRevision ?? 0,
      });
      this.notifyUpdated();
    });
  }

  public mirrorLocalStorage(): Promise<void> {
    return this.enqueue(async () => {
      const currentRecords = new Map((await this.backend.listState(this.cartularyId)).map((record) => [record.key, record]));
      const clocks = readClocks(this.storage);
      const keys = Array.from({ length: this.storage.length }, (_, index) => this.storage.key(index))
        .filter((key): key is string => Boolean(key && isPersistableKey(key)));
      for (const key of keys) {
        const value = this.storage.getItem(key);
        if (value === null) continue;
        const current = currentRecords.get(key);
        if (current?.value === value && !current.deleted) continue;
        const updatedAt = clocks[key] ?? this.now();
        await this.backend.putState({
          id: stateId(this.cartularyId, key),
          cartularyId: this.cartularyId,
          key,
          value,
          updatedAt,
          dirty: true,
          deleted: false,
          cloudRevision: current?.cloudRevision ?? 0,
        });
      }
    });
  }

  public restoreLocalStorage(): Promise<void> {
    return this.enqueue(async () => {
      const clocks = readClocks(this.storage);
      const records = await this.backend.listState(this.cartularyId);
      for (const record of records) {
        const localUpdatedAt = clocks[record.key] ?? 0;
        if (localUpdatedAt > record.updatedAt) {
          const localValue = this.storage.getItem(record.key);
          await this.backend.putState({
            ...record,
            value: localValue,
            updatedAt: localUpdatedAt,
            dirty: true,
            deleted: localValue === null,
          });
          continue;
        }
        if (record.deleted) this.storage.removeItem(record.key);
        else if (record.value !== null) this.storage.setItem(record.key, record.value);
        clocks[record.key] = record.updatedAt;
      }
      writeClocks(this.storage, clocks);
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
    const updatedAt = this.now();
    return this.enqueue(async () => {
      const id = binaryRecordId(this.cartularyId, input.binaryId);
      const current = await this.backend.getBinary(id);
      const record: LocalBinaryRecord = {
        id,
        cartularyId: this.cartularyId,
        binaryId: input.binaryId,
        kind: input.kind,
        fileName: input.fileName,
        mimeType: input.mimeType || 'application/octet-stream',
        size: input.blob.size,
        sha256: input.sha256.startsWith('sha256:') ? input.sha256 : `sha256:${input.sha256}`,
        blob: input.blob,
        updatedAt,
        dirty: true,
        deleted: false,
        cloudRevision: current?.cloudRevision ?? 0,
        cloudStoragePath: current?.cloudStoragePath ?? null,
      };
      await this.backend.putBinary(record);
      this.notifyUpdated();
      return record;
    });
  }

  public deleteBinary(binaryId: string): Promise<void> {
    return this.enqueue(async () => {
      const id = binaryRecordId(this.cartularyId, binaryId);
      const current = await this.backend.getBinary(id);
      if (!current) return;
      await this.backend.putBinary({
        ...current,
        blob: null,
        updatedAt: this.now(),
        dirty: true,
        deleted: true,
      });
      this.notifyUpdated();
    });
  }

  public async getBinary(binaryId: string) {
    await this.flush();
    return this.backend.getBinary(binaryRecordId(this.cartularyId, binaryId));
  }

  public async listStateRecords() {
    await this.flush();
    return this.backend.listState(this.cartularyId);
  }

  public async listBinaryRecords() {
    await this.flush();
    return this.backend.listBinaries(this.cartularyId);
  }

  public markStateCloudSynced(key: string, cloudRevision: number): Promise<void> {
    return this.enqueue(async () => {
      const id = stateId(this.cartularyId, key);
      const record = await this.backend.getState(id);
      if (!record) return;
      await this.backend.putState({ ...record, dirty: false, cloudRevision });
    });
  }

  public prepareStateConflictResolution(key: string, cloudRevision: number): Promise<void> {
    return this.enqueue(async () => {
      const id = stateId(this.cartularyId, key);
      const record = await this.backend.getState(id);
      if (!record) throw new Error(`État local introuvable pour ${key}.`);
      await this.backend.putState({ ...record, dirty: true, cloudRevision, updatedAt: this.now() });
    });
  }

  public applyCloudState(record: LocalStateRecord): Promise<void> {
    return this.enqueue(async () => {
      await this.backend.putState({ ...record, id: stateId(this.cartularyId, record.key), cartularyId: this.cartularyId, dirty: false });
      const clocks = readClocks(this.storage);
      if (record.deleted) this.storage.removeItem(record.key);
      else if (record.value !== null) this.storage.setItem(record.key, record.value);
      clocks[record.key] = record.updatedAt;
      writeClocks(this.storage, clocks);
    });
  }

  public markBinaryCloudSynced(binaryId: string, cloudRevision: number, cloudStoragePath: string | null): Promise<void> {
    return this.enqueue(async () => {
      const id = binaryRecordId(this.cartularyId, binaryId);
      const record = await this.backend.getBinary(id);
      if (!record) return;
      await this.backend.putBinary({ ...record, dirty: false, cloudRevision, cloudStoragePath });
    });
  }

  public prepareBinaryConflictResolution(binaryId: string, cloudRevision: number): Promise<void> {
    return this.enqueue(async () => {
      const id = binaryRecordId(this.cartularyId, binaryId);
      const record = await this.backend.getBinary(id);
      if (!record) throw new Error(`Original local introuvable pour ${binaryId}.`);
      await this.backend.putBinary({ ...record, dirty: true, cloudRevision, updatedAt: this.now() });
    });
  }

  public applyCloudBinary(record: LocalBinaryRecord): Promise<void> {
    return this.enqueue(async () => {
      await this.backend.putBinary({
        ...record,
        id: binaryRecordId(this.cartularyId, record.binaryId),
        cartularyId: this.cartularyId,
        dirty: false,
      });
    });
  }

  public async deleteAllLocalData() {
    await this.flush();
    await this.backend.deleteCartulary(this.cartularyId);
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
  const [sourceState, sourceBinaries, targetState, targetBinaries] = await Promise.all([
    backend.listState(sourceCartularyId),
    backend.listBinaries(sourceCartularyId),
    backend.listState(targetCartularyId),
    backend.listBinaries(targetCartularyId),
  ]);
  const targetStateKeys = new Set(targetState.map((record) => record.key));
  const targetBinaryIds = new Set(targetBinaries.map((record) => record.binaryId));
  let migratedState = 0;
  let migratedBinaries = 0;

  for (const record of sourceState) {
    if (targetStateKeys.has(record.key)) continue;
    await backend.putState({
      ...record,
      id: stateId(targetCartularyId, record.key),
      cartularyId: targetCartularyId,
      dirty: true,
      cloudRevision: 0,
    });
    migratedState += 1;
  }
  for (const record of sourceBinaries) {
    if (targetBinaryIds.has(record.binaryId)) continue;
    await backend.putBinary({
      ...record,
      id: binaryRecordId(targetCartularyId, record.binaryId),
      cartularyId: targetCartularyId,
      dirty: true,
      cloudRevision: 0,
    });
    migratedBinaries += 1;
  }
  return { state: migratedState, binaries: migratedBinaries };
};

const defaultBackend = new IndexedDbVaultBackend();
const copyLegacyIwcStorageIntoScope = () => {
  if (typeof window === 'undefined' || ACTIVE_CARTULARY_ID !== IWC_CARTULARY_ID) return;
  const scoped = scopedStorageForCartulary(window.localStorage, IWC_CARTULARY_ID);
  const migrationKey = 'cartularia-iwc-scoped-storage-v1';
  if (window.localStorage.getItem(migrationKey) === 'done') return;
  const legacyKeys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
    .filter((key): key is string => Boolean(
      key
      && key.startsWith(CARTULARIA_KEY_PREFIX)
      && !key.startsWith(STORAGE_SCOPE_PREFIX)
      && key !== CARTULARY_ID_MIGRATION_KEY,
    ));
  legacyKeys.forEach((key) => {
    if (scoped.getItem(key) === null) {
      const value = window.localStorage.getItem(key);
      if (value !== null) scoped.setItem(key, value);
    }
  });
  window.localStorage.setItem(migrationKey, 'done');
};

copyLegacyIwcStorageIntoScope();

export const cartulariaStorage = typeof window === 'undefined'
  ? null
  : scopedStorageForCartulary(window.localStorage, DEFAULT_LOCAL_CARTULARY_ID);

export const cartulariaLocalVault = typeof window === 'undefined'
  ? null
  : new CartulariaLocalVault(DEFAULT_LOCAL_CARTULARY_ID, defaultBackend, cartulariaStorage!);

export const restoreCartulariaLocalState = async () => {
  if (!cartulariaLocalVault) return;
  try {
    if (
      DEFAULT_LOCAL_CARTULARY_ID === IWC_CARTULARY_ID
      && window.localStorage.getItem(CARTULARY_ID_MIGRATION_KEY) !== DEFAULT_LOCAL_CARTULARY_ID
    ) {
      await migrateLocalVaultCartularyId(
        defaultBackend,
        LEGACY_LOCAL_CARTULARY_ID,
        DEFAULT_LOCAL_CARTULARY_ID,
      );
      window.localStorage.setItem(CARTULARY_ID_MIGRATION_KEY, DEFAULT_LOCAL_CARTULARY_ID);
    }
    await cartulariaLocalVault.restoreLocalStorage();
  } catch (error) {
    console.error('Restauration du coffre local impossible', error);
  }
};

export const persistCartulariaJson = (key: string, value: unknown) => {
  if (!cartulariaLocalVault) return Promise.resolve();
  return cartulariaLocalVault.writeJson(key, value);
};

export const readCartulariaStorage = (key: string) => cartulariaStorage?.getItem(key) ?? null;

export const mirrorCartulariaLocalStorage = () => cartulariaLocalVault?.mirrorLocalStorage() ?? Promise.resolve();
