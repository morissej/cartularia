import { GeoPoint, Timestamp } from 'firebase-admin/firestore';
import { sha256Bytes, sha256Digest } from './canonical-json.mjs';
import { verifyAuditChain } from './audit-verifier.mjs';

const TYPE_KEY = '__cartulariaBackupType';

export class BackupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

export const encodeFirestoreValue = (value) => {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (value === undefined) return { [TYPE_KEY]: 'undefined' };
  if (value instanceof Timestamp) {
    return { [TYPE_KEY]: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (value instanceof Date) return { [TYPE_KEY]: 'date', iso: value.toISOString() };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { [TYPE_KEY]: 'bytes', base64: Buffer.from(value).toString('base64') };
  }
  if (value instanceof GeoPoint) {
    return { [TYPE_KEY]: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  }
  if (Array.isArray(value)) return value.map(encodeFirestoreValue);
  if (typeof value === 'object') {
    if (typeof value.path === 'string' && value.firestore) {
      return { [TYPE_KEY]: 'reference', path: value.path };
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encodeFirestoreValue(child)]));
  }
  throw new BackupError('unsupported_value', `Type Firestore non sauvegardable : ${typeof value}.`);
};

export const decodeFirestoreValue = (value, firestore) => {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map((child) => decodeFirestoreValue(child, firestore));
  if (typeof value !== 'object') throw new BackupError('invalid_encoded_value', 'Valeur de sauvegarde invalide.');
  if (value[TYPE_KEY] === 'timestamp') return new Timestamp(value.seconds, value.nanoseconds);
  if (value[TYPE_KEY] === 'date') return new Date(value.iso);
  if (value[TYPE_KEY] === 'bytes') return Buffer.from(value.base64, 'base64');
  if (value[TYPE_KEY] === 'geopoint') return new GeoPoint(value.latitude, value.longitude);
  if (value[TYPE_KEY] === 'reference') return firestore.doc(value.path);
  if (value[TYPE_KEY] === 'undefined') return null;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, decodeFirestoreValue(child, firestore)]));
};

const walkCollection = async (collectionRef, records) => {
  const snapshot = await collectionRef.get();
  for (const document of snapshot.docs) {
    const data = encodeFirestoreValue(document.data());
    records.push({ path: document.ref.path, data, digest: sha256Digest(data) });
    const subcollections = await document.ref.listCollections();
    for (const subcollection of subcollections) await walkCollection(subcollection, records);
  }
};

export const listFirestoreDocuments = async (firestore) => {
  const records = [];
  const rootCollections = await firestore.listCollections();
  for (const collectionRef of rootCollections) await walkCollection(collectionRef, records);
  return records.sort((left, right) => left.path.localeCompare(right.path));
};

export class MemoryObjectStoreAdapter {
  constructor(initialObjects = []) {
    this.objects = new Map(initialObjects.map((object) => [object.name, {
      bytes: Buffer.from(object.bytes),
      contentType: object.contentType ?? 'application/octet-stream',
      metadata: { ...(object.metadata ?? {}) },
    }]));
  }

  async list() {
    return [...this.objects.keys()].sort();
  }

  async read(name) {
    const object = this.objects.get(name);
    if (!object) throw new BackupError('object_not_found', `Objet ${name} introuvable.`);
    return { ...object, bytes: Buffer.from(object.bytes), metadata: { ...object.metadata } };
  }

  async write(name, object) {
    this.objects.set(name, {
      bytes: Buffer.from(object.bytes),
      contentType: object.contentType ?? 'application/octet-stream',
      metadata: { ...(object.metadata ?? {}) },
    });
  }
}

export class FirebaseStorageObjectStoreAdapter {
  constructor(bucket, { prefix = '' } = {}) {
    this.bucket = bucket;
    this.prefix = prefix;
  }

  async list() {
    const [files] = await this.bucket.getFiles({ prefix: this.prefix });
    return files.map((file) => file.name).sort();
  }

  async read(name) {
    const file = this.bucket.file(name);
    const [[metadata], [bytes]] = await Promise.all([file.getMetadata(), file.download()]);
    return {
      bytes,
      contentType: metadata.contentType ?? 'application/octet-stream',
      metadata: metadata.metadata ?? {},
    };
  }

  async write(name, object) {
    await this.bucket.file(name).save(object.bytes, {
      resumable: false,
      metadata: { contentType: object.contentType, metadata: object.metadata },
    });
  }
}

export const verifyBackupBundle = (bundle) => {
  if (bundle?.manifest?.format !== 'cartularia-backup-1') {
    throw new BackupError('invalid_backup_format', 'Format de sauvegarde inconnu.');
  }
  const records = [...(bundle.records ?? [])].sort((left, right) => left.path.localeCompare(right.path));
  const objects = [...(bundle.objects ?? [])].sort((left, right) => left.name.localeCompare(right.name));
  for (const record of records) {
    if (sha256Digest(record.data) !== record.digest) {
      throw new BackupError('record_digest_mismatch', `Empreinte invalide pour ${record.path}.`);
    }
  }
  for (const object of objects) {
    if (sha256Bytes(Buffer.from(object.base64, 'base64')) !== object.digest) {
      throw new BackupError('object_digest_mismatch', `Empreinte invalide pour ${object.name}.`);
    }
  }
  const core = {
    format: bundle.manifest.format,
    classification: bundle.manifest.classification,
    createdAtIso: bundle.manifest.createdAtIso,
    sourceProjectId: bundle.manifest.sourceProjectId,
    recordCount: records.length,
    objectCount: objects.length,
    recordsDigest: sha256Digest(records.map(({ path, digest }) => ({ path, digest }))),
    objectsDigest: sha256Digest(objects.map(({ name, digest }) => ({ name, digest }))),
    encryptionRequired: bundle.manifest.encryptionRequired,
  };
  const manifestDigest = sha256Digest(core);
  if (manifestDigest !== bundle.manifest.manifestDigest) {
    throw new BackupError('manifest_digest_mismatch', 'Le manifeste de sauvegarde est invalide.');
  }
  return { valid: true, manifestDigest, recordCount: records.length, objectCount: objects.length };
};

export const createPilotBackup = async ({
  firestore,
  objectStore = null,
  sourceProjectId,
  createdAtIso = new Date().toISOString(),
}) => {
  const records = await listFirestoreDocuments(firestore);
  const objectNames = objectStore ? await objectStore.list() : [];
  const objects = [];
  for (const name of objectNames) {
    const object = await objectStore.read(name);
    const bytes = Buffer.from(object.bytes);
    objects.push({
      name,
      contentType: object.contentType,
      metadata: object.metadata,
      sizeBytes: bytes.length,
      digest: sha256Bytes(bytes),
      base64: bytes.toString('base64'),
    });
  }
  const sortedObjects = objects.sort((left, right) => left.name.localeCompare(right.name));
  const manifestCore = {
    format: 'cartularia-backup-1',
    classification: 'secret',
    createdAtIso,
    sourceProjectId,
    recordCount: records.length,
    objectCount: sortedObjects.length,
    recordsDigest: sha256Digest(records.map(({ path, digest }) => ({ path, digest }))),
    objectsDigest: sha256Digest(sortedObjects.map(({ name, digest }) => ({ name, digest }))),
    encryptionRequired: true,
  };
  const bundle = {
    manifest: { ...manifestCore, manifestDigest: sha256Digest(manifestCore) },
    records,
    objects: sortedObjects,
  };
  verifyBackupBundle(bundle);
  return bundle;
};

const writeRecords = async (firestore, records) => {
  for (let start = 0; start < records.length; start += 400) {
    const batch = firestore.batch();
    for (const record of records.slice(start, start + 400)) {
      batch.set(firestore.doc(record.path), decodeFirestoreValue(record.data, firestore));
    }
    await batch.commit();
  }
};

export const restorePilotBackup = async ({ firestore, objectStore = null, bundle }) => {
  verifyBackupBundle(bundle);
  await writeRecords(firestore, bundle.records);
  if (bundle.objects.length > 0 && !objectStore) {
    throw new BackupError('object_store_required', 'Un adaptateur Storage est requis pour restaurer les fichiers.');
  }
  for (const object of bundle.objects) {
    await objectStore.write(object.name, {
      bytes: Buffer.from(object.base64, 'base64'),
      contentType: object.contentType,
      metadata: object.metadata,
    });
  }
  return { restoredRecords: bundle.records.length, restoredObjects: bundle.objects.length };
};

export const validateRestoredPilot = async ({ firestore, objectStore = null, bundle }) => {
  const errors = [];
  for (const record of bundle.records) {
    const restored = await firestore.doc(record.path).get();
    if (!restored.exists) {
      errors.push({ code: 'missing_document', path: record.path });
      continue;
    }
    if (sha256Digest(encodeFirestoreValue(restored.data())) !== record.digest) {
      errors.push({ code: 'restored_digest_mismatch', path: record.path });
    }
  }
  if (bundle.objects.length > 0 && !objectStore) errors.push({ code: 'object_store_required' });
  for (const object of bundle.objects) {
    if (!objectStore) break;
    try {
      const restored = await objectStore.read(object.name);
      if (sha256Bytes(restored.bytes) !== object.digest) errors.push({ code: 'restored_object_mismatch', path: object.name });
    } catch {
      errors.push({ code: 'missing_object', path: object.name });
    }
  }

  const rootRecords = bundle.records.filter((record) => /^cartularies\/[^/]+$/.test(record.path));
  for (const rootRecord of rootRecords) {
    const cartularyId = rootRecord.path.split('/')[1];
    const root = await firestore.doc(rootRecord.path).get();
    const auditEvents = await firestore.collection(`cartularies/${cartularyId}/auditEvents`).get();
    const chain = verifyAuditChain({
      events: auditEvents.docs.map((document) => document.data()),
      integrityHead: root.data().integrityHead,
      integritySequence: root.data().integritySequence,
    });
    if (!chain.valid) errors.push({ code: 'audit_chain_invalid', path: rootRecord.path, details: chain.errors });
    const organization = await firestore.doc(`organizations/${root.data().organizationId}`).get();
    const registry = await firestore.doc(`registries/${root.data().registryId}`).get();
    const membership = await firestore.doc(
      `organizations/${root.data().organizationId}/memberships/${root.data().accountHolderId}`,
    ).get();
    if (!organization.exists || !registry.exists || !membership.exists) {
      errors.push({ code: 'relationship_missing', path: rootRecord.path });
    }
  }

  return {
    valid: errors.length === 0,
    checkedRecords: bundle.records.length,
    checkedObjects: bundle.objects.length,
    checkedCartularies: rootRecords.length,
    errors,
  };
};
