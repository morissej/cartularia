import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { CANONICALIZATION_VERSION, sha256Digest } from './canonical-json.mjs';
import { ZERO_AUDIT_HASH } from './audit-verifier.mjs';

/**
 * Remontée de schéma d'un Cartulaire existant (ADR-031).
 *
 * Quand la base évolue (nouvelle version de création dans le catalogue), les Cartulaires déjà
 * créés restent épinglés sur leur version. Cette commande les aligne sur la version cible sans
 * perdre de donnée : les champs que la cible ne connaît plus passent en extensions, les sections
 * que la cible ne connaît plus deviennent `imported_unmapped`. Chaque remontée incrémente la
 * révision et s'inscrit dans la chaîne d'audit du Cartulaire.
 */

export class SchemaUpgradeCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SchemaUpgradeCommandError';
    this.code = code;
  }
}

export const compareSchemaVersions = (left, right) => String(left).localeCompare(String(right), undefined, { numeric: true });

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/** Version cible d'une verticale : version active du catalogue, à défaut dernière publiée. */
export const resolveUpgradeTarget = async ({ firestore, schemaId, targetVersion = null }) => {
  if (targetVersion) {
    if (!VERSION_PATTERN.test(String(targetVersion))) throw new SchemaUpgradeCommandError('invalid_target', `Version cible invalide : ${targetVersion}.`);
    return { version: String(targetVersion), source: 'requested' };
  }
  const pointer = await firestore.doc(`schemaCatalog/${schemaId}`).get();
  const data = pointer.exists ? pointer.data() : null;
  if (data?.activeVersion) return { version: data.activeVersion, source: 'active' };
  if (data?.latestVersion) return { version: data.latestVersion, source: 'latest' };
  throw new SchemaUpgradeCommandError('schema_not_ready', `Le catalogue ne désigne aucune version pour ${schemaId}.`);
};

/** Lecture d'une version publiée du catalogue : sections, appartenance des champs, empreinte. */
export const loadCatalogSchemaVersion = async ({ firestore, schemaId, version }) => {
  const versionRef = firestore.doc(`schemaCatalog/${schemaId}/versions/${version}`);
  const versionDocument = await versionRef.get();
  if (!versionDocument.exists) throw new SchemaUpgradeCommandError('schema_not_ready', `La version ${schemaId}@${version} n’est pas publiée dans le catalogue.`);
  const data = versionDocument.data();
  if (!['baseline', 'active'].includes(data.status)) throw new SchemaUpgradeCommandError('schema_not_ready', `La version ${schemaId}@${version} n’est pas publiée dans le catalogue.`);
  const sectionIds = Array.isArray(data.sectionIds) ? [...data.sectionIds] : [];
  const fieldSections = new Map();
  const sections = await versionRef.collection('sections').get();
  for (const section of sections.docs) {
    const fields = await section.ref.collection('fields').get();
    for (const field of fields.docs) {
      const fieldData = field.data();
      fieldSections.set(fieldData.fieldId ?? field.id, fieldData.sectionId ?? section.id);
    }
  }
  return {
    schemaId,
    version,
    sectionIds,
    fieldSections,
    catalogDigest: typeof data.catalogDigest === 'string' ? data.catalogDigest : null,
  };
};

/**
 * Plan de remontée, pur et testable : pour chaque section du Cartulaire, la version cible et le
 * déplacement des champs inconnus. Aucune valeur n'est supprimée.
 */
export const planSchemaUpgrade = ({ root, sections, target, source = null }) => {
  if (root.schemaId !== target.schemaId) {
    throw new SchemaUpgradeCommandError('schema_mismatch', `Le Cartulaire ${root.id} relève de ${root.schemaId}, pas de ${target.schemaId}.`);
  }
  if (compareSchemaVersions(target.version, root.schemaVersion) < 0) {
    throw new SchemaUpgradeCommandError('downgrade_refused', `Remontée refusée : ${root.schemaVersion} est plus récente que ${target.version}.`);
  }
  const schemaVersion = `${target.schemaId}@${target.version}`;
  // Une section est retirée par la remontée si la version d'origine la connaissait et que la cible
  // ne la connaît plus. Une section hors schéma depuis l'origine (`imported_unmapped`) reste telle quelle.
  const knownBefore = (section) => (source ? source.sectionIds.includes(section.schemaSectionId) : section.status !== 'imported_unmapped');
  const orphanedSections = [];
  const relocatedFields = [];
  const patches = [...sections]
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .map((section) => {
      const known = target.sectionIds.includes(section.schemaSectionId);
      const fields = {};
      const extensions = { ...(section.extensions ?? {}) };
      for (const [fieldId, value] of Object.entries(section.fields ?? {})) {
        if (known && target.fieldSections.get(fieldId) === section.schemaSectionId) fields[fieldId] = value;
        else {
          extensions[fieldId] = value;
          relocatedFields.push({ sectionId: section.id, fieldId });
        }
      }
      const retired = !known && knownBefore(section);
      if (retired) orphanedSections.push(section.id);
      const { updatedAt: _updatedAt, ...rest } = section;
      return {
        ...rest,
        schemaVersion,
        status: known ? (section.status ?? 'imported_unreviewed') : 'imported_unmapped',
        fields,
        ...(Object.keys(extensions).length || section.extensions ? { extensions } : {}),
        ...(retired ? { retiredFromSchema: { version: target.version, reason: 'section_removed' } } : {}),
      };
    });
  return {
    from: root.schemaVersion,
    to: target.version,
    changed: root.schemaVersion !== target.version,
    patches,
    orphanedSections,
    relocatedFields,
    digest: sha256Digest({ schemaId: target.schemaId, schemaVersion: target.version, schemaDigest: target.catalogDigest, sections: patches }),
  };
};

const createAuditEvent = ({ rootData, requestId, actorId, occurredAt, afterDigest, target }) => {
  const previousEventHash = rootData.integrityHead || ZERO_AUDIT_HASH;
  const sequence = Number(rootData.integritySequence || 0) + 1;
  const eventId = `evt_${sha256Digest(`cartulary.schema.upgraded:${requestId}`).slice(7, 31)}`;
  const eventWithoutHash = {
    eventId,
    cartularyId: rootData.id,
    sequence,
    occurredAt,
    actor: { uid: actorId, role: 'system' },
    action: 'cartulary.schema.upgraded',
    resource: { type: 'schema', id: `${target.schemaId}@${target.version}` },
    beforeDigest: previousEventHash,
    afterDigest,
    previousEventHash,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    requestId,
  };
  return { ...eventWithoutHash, hash: sha256Digest({ previousEventHash, event: eventWithoutHash }) };
};

/** Cartulaires d'une verticale dont la version diffère de la cible (parcours complet, usage opérateur). */
export const listCartulariesToUpgrade = async ({ firestore, schemaId, targetVersion }) => {
  const snapshot = await firestore.collection('cartularies').get();
  return snapshot.docs
    .map((document) => document.data())
    .filter((data) => data.schemaId === schemaId && !data.deletedAt && data.schemaVersion !== targetVersion)
    .map((data) => ({ cartularyId: data.id, schemaVersion: data.schemaVersion }));
};

export const upgradeCartularySchema = async ({
  firestore,
  cartularyId,
  targetVersion = null,
  actorId = 'system:schema-upgrade',
  requestId,
  occurredAt = new Date().toISOString(),
  dryRun = false,
}) => {
  if (!requestId) throw new SchemaUpgradeCommandError('invalid_request_id', 'requestId est requis.');
  const rootRef = firestore.doc(`cartularies/${cartularyId}`);
  const root = await rootRef.get();
  if (!root.exists) throw new SchemaUpgradeCommandError('cartulary_not_found', `Cartulaire ${cartularyId} introuvable.`);
  const rootData = root.data();
  if (rootData.deletedAt) throw new SchemaUpgradeCommandError('cartulary_deleted', `Cartulaire ${cartularyId} supprimé.`);
  const resolved = await resolveUpgradeTarget({ firestore, schemaId: rootData.schemaId, targetVersion });
  if (rootData.schemaVersion === resolved.version) {
    return { cartularyId, status: 'ignored', reason: 'already_current', schemaVersion: resolved.version };
  }
  const target = await loadCatalogSchemaVersion({ firestore, schemaId: rootData.schemaId, version: resolved.version });
  const source = await loadCatalogSchemaVersion({ firestore, schemaId: rootData.schemaId, version: rootData.schemaVersion }).catch(() => null);
  const sectionsSnapshot = await rootRef.collection('sections').get();
  const plan = planSchemaUpgrade({ root: rootData, sections: sectionsSnapshot.docs.map((document) => document.data()), target, source });
  if (dryRun) {
    return { cartularyId, status: 'planned', from: plan.from, to: plan.to, sections: plan.patches.length, orphanedSections: plan.orphanedSections, relocatedFields: plan.relocatedFields };
  }

  return firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(rootRef);
    if (!current.exists) throw new SchemaUpgradeCommandError('cartulary_not_found', 'Cartulaire introuvable pendant la transaction.');
    const currentData = current.data();
    if (currentData.revision !== rootData.revision || currentData.integrityHead !== rootData.integrityHead) {
      throw new SchemaUpgradeCommandError('revision_conflict', 'Le Cartulaire a évolué pendant la remontée.');
    }
    const nextRevision = Number(currentData.revision || 0) + 1;
    const auditEvent = createAuditEvent({ rootData: currentData, requestId, actorId, occurredAt, afterDigest: plan.digest, target });
    transaction.update(rootRef, {
      schemaVersion: target.version,
      ...(target.catalogDigest ? { schemaDigest: target.catalogDigest } : {}),
      previousSchemaVersion: currentData.schemaVersion,
      schemaUpgradedAt: FieldValue.serverTimestamp(),
      revision: nextRevision,
      integrityHead: auditEvent.hash,
      integritySequence: auditEvent.sequence,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(rootRef.collection('auditEvents').doc(auditEvent.eventId), {
      ...auditEvent,
      occurredAt: Timestamp.fromDate(new Date(occurredAt)),
      occurredAtIso: occurredAt,
    });
    for (const patch of plan.patches) {
      transaction.set(rootRef.collection('sections').doc(patch.id), { ...patch, updatedAt: FieldValue.serverTimestamp() });
    }
    return {
      cartularyId,
      status: 'upgraded',
      from: plan.from,
      to: plan.to,
      revision: nextRevision,
      auditEventId: auditEvent.eventId,
      sections: plan.patches.length,
      orphanedSections: plan.orphanedSections,
      relocatedFields: plan.relocatedFields.length,
    };
  });
};
