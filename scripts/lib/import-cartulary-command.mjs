import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { CANONICALIZATION_VERSION, canonicalize, sha256Digest } from './canonical-json.mjs';

const ZERO_HASH = `sha256:${'0'.repeat(64)}`;
const FORBIDDEN_ENVELOPE_KEYS = [
  'serialNumber',
  'acquisitionPrice',
  'address',
  'storageInstructions',
  'documents',
  'media',
];

const collections = {
  sections: 'sections',
  sources: 'sources',
  assets: 'assets',
  spinSets: 'spinSets',
  observations: 'observations',
  valuations: 'valuations',
  comparables: 'comparables',
  reports: 'reports',
  reminders: 'reminders',
  ownerRelations: 'ownerRelations',
  events: 'events',
};

export class CartularyCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CartularyCommandError';
    this.code = code;
  }
}

const validateRequestId = (requestId) => {
  if (!/^[a-z0-9][a-z0-9_-]{7,127}$/.test(requestId)) {
    throw new CartularyCommandError('invalid_request_id', 'requestId doit être opaque, stable et compatible Firestore.');
  }
};

const validateBundle = (bundle) => {
  if (!bundle?.envelope?.id) throw new CartularyCommandError('invalid_bundle', 'Enveloppe de Cartulaire absente.');
  if (bundle.envelope.defaultVisibility !== 'secret' || bundle.envelope.publicationStatus !== 'none') {
    throw new CartularyCommandError('unsafe_visibility', 'Un import technique doit rester Secret et non publié.');
  }
  for (const key of FORBIDDEN_ENVELOPE_KEYS) {
    if (key in bundle.envelope) {
      throw new CartularyCommandError('unsafe_envelope', `Le champ ${key} est interdit dans l’enveloppe.`);
    }
  }
  if (bundle.sections.some((section) => section.visibility !== 'secret')) {
    throw new CartularyCommandError('unsafe_section', 'Toutes les sections importées doivent rester Secret.');
  }
  for (const collectionName of [
    'sources',
    'spinSets',
    'observations',
    'valuations',
    'comparables',
    'reports',
    'reminders',
    'ownerRelations',
    'events',
  ]) {
    if (bundle[collectionName].some((document) => document.visibility !== 'secret')) {
      throw new CartularyCommandError(
        'unsafe_child_visibility',
        `Tous les documents ${collectionName} importés doivent rester Secret.`,
      );
    }
  }
  if (
    bundle.assets.some(
      (asset) =>
        asset.visibility !== 'secret' ||
        asset.sha256 !== null ||
        asset.originalVersionId !== null ||
        'url' in asset ||
        'thumbnailUrl' in asset ||
        'posterUrl' in asset,
    )
  ) {
    throw new CartularyCommandError(
      'unsafe_asset',
      'Les métadonnées média importées ne doivent contenir ni URL, ni hash fictif, ni visibilité ouverte.',
    );
  }
  if (bundle.observations.some((observation) => observation.proofStatus !== 'unverified')) {
    throw new CartularyCommandError('unsafe_proof', 'Une observation importée doit être marquée unverified.');
  }
};

const assertFoundation = ({ organization, registry, membership, schemaVersion }, bundle, actorId) => {
  if (!organization.exists || organization.data().status !== 'active') {
    throw new CartularyCommandError('organization_not_ready', 'Organisation pilote absente ou inactive.');
  }
  if (!registry.exists || registry.data().organizationId !== bundle.envelope.organizationId) {
    throw new CartularyCommandError('registry_not_ready', 'Registre pilote absent ou rattaché à un autre tenant.');
  }
  if (
    !membership.exists ||
    membership.id !== actorId ||
    membership.data().status !== 'active' ||
    !Array.isArray(membership.data().permissions) ||
    !membership.data().permissions.includes('cartulary.edit') ||
    !Array.isArray(membership.data().scopes?.registryIds) ||
    !membership.data().scopes.registryIds.includes(bundle.envelope.registryId)
  ) {
    throw new CartularyCommandError('permission_denied', 'Le compte ne peut pas créer ce Cartulaire.');
  }
  if (
    !schemaVersion.exists ||
    schemaVersion.data().version !== bundle.envelope.schemaVersion ||
    !['baseline', 'active'].includes(schemaVersion.data().status)
  ) {
    throw new CartularyCommandError(
      'schema_not_ready',
      `Le schéma ${bundle.envelope.schemaId}@${bundle.envelope.schemaVersion} n’est pas publié dans le catalogue.`,
    );
  }
};

const createAuditEvent = ({ bundle, requestId, actorId, occurredAt, bundleDigest }) => {
  const eventId = `evt_${sha256Digest(requestId).slice(7, 31)}`;
  const eventWithoutHash = {
    eventId,
    cartularyId: bundle.envelope.id,
    sequence: 1,
    occurredAt,
    actor: { uid: actorId, role: 'legal_owner' },
    action: 'cartulary.created',
    resource: { type: 'cartulary', id: bundle.envelope.id },
    beforeDigest: null,
    afterDigest: bundleDigest,
    previousEventHash: ZERO_HASH,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    requestId,
  };
  return {
    ...eventWithoutHash,
    hash: sha256Digest({ previousEventHash: ZERO_HASH, event: eventWithoutHash }),
  };
};

const writeChildDocuments = (transaction, rootRef, bundle, serverTimestamp) => {
  for (const [bundleKey, collectionName] of Object.entries(collections)) {
    for (const document of bundle[bundleKey]) {
      transaction.create(rootRef.collection(collectionName).doc(document.id), {
        ...document,
        createdAt: serverTimestamp,
        updatedAt: serverTimestamp,
      });
    }
  }
};

export const importCartularyBundle = async ({
  firestore,
  bundle,
  requestId,
  actorId,
  expectedRevision = 0,
  occurredAt = new Date().toISOString(),
}) => {
  validateRequestId(requestId);
  validateBundle(bundle);
  if (expectedRevision !== 0) {
    throw new CartularyCommandError('revision_conflict', 'createCartulary attend expectedRevision=0.');
  }

  const rootRef = firestore.doc(`cartularies/${bundle.envelope.id}`);
  const receiptRef = rootRef.collection('commandReceipts').doc(requestId);
  const organizationRef = firestore.doc(`organizations/${bundle.envelope.organizationId}`);
  const registryRef = firestore.doc(`registries/${bundle.envelope.registryId}`);
  const membershipRef = organizationRef.collection('memberships').doc(actorId);
  const schemaVersionRef = firestore.doc(
    `schemaCatalog/${bundle.envelope.schemaId}/versions/${bundle.envelope.schemaVersion}`,
  );
  const bundleDigest = sha256Digest(bundle);

  return firestore.runTransaction(async (transaction) => {
    const [receipt, root, organization, registry, membership, schemaVersion] = await Promise.all([
      transaction.get(receiptRef),
      transaction.get(rootRef),
      transaction.get(organizationRef),
      transaction.get(registryRef),
      transaction.get(membershipRef),
      transaction.get(schemaVersionRef),
    ]);

    if (receipt.exists) {
      if (receipt.data().inputDigest !== bundleDigest) {
        throw new CartularyCommandError('idempotency_conflict', 'requestId déjà utilisé avec un contenu différent.');
      }
      return { ...receipt.data().result, replayed: true };
    }
    if (root.exists) {
      throw new CartularyCommandError('cartulary_exists', 'Le Cartulaire existe déjà sous un autre requestId.');
    }

    assertFoundation({ organization, registry, membership, schemaVersion }, bundle, actorId);

    const auditEvent = createAuditEvent({ bundle, requestId, actorId, occurredAt, bundleDigest });
    const serverTimestamp = FieldValue.serverTimestamp();
    const occurredAtTimestamp = Timestamp.fromDate(new Date(occurredAt));

    transaction.create(rootRef, {
      ...bundle.envelope,
      integrityHead: auditEvent.hash,
      integritySequence: auditEvent.sequence,
      createdAt: serverTimestamp,
      updatedAt: serverTimestamp,
    });
    writeChildDocuments(transaction, rootRef, bundle, serverTimestamp);
    transaction.create(rootRef.collection('auditEvents').doc(auditEvent.eventId), {
      ...auditEvent,
      occurredAt: occurredAtTimestamp,
      occurredAtIso: occurredAt,
    });

    const result = {
      cartularyId: bundle.envelope.id,
      revision: 1,
      auditEventId: auditEvent.eventId,
      integrityHead: auditEvent.hash,
      inputDigest: bundleDigest,
    };
    transaction.create(receiptRef, {
      requestId,
      command: 'createCartulary',
      actorId,
      inputDigest: bundleDigest,
      canonicalPayload: canonicalize({ cartularyId: bundle.envelope.id, revision: 1 }),
      result,
      createdAt: serverTimestamp,
    });

    return { ...result, replayed: false };
  });
};
