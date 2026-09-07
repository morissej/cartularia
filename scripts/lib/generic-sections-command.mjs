import { validateGenericFieldValue } from './generic-editing-policy.mjs';

export class GenericSectionsError extends Error {
  constructor(code, message) { super(message); this.name = 'GenericSectionsError'; this.code = code; }
}

export function buildGenericSectionPatches({ draft, root, schemaFields, sections, ownerUid, occurredAt }) {
  if (!draft || draft.version !== 1 || draft.schemaId !== root.schemaId || draft.schemaVersion !== root.schemaVersion
    || !Number.isInteger(draft.baseRevision) || draft.baseRevision !== root.revision) {
    throw new GenericSectionsError('revision_conflict', 'Le Cartulaire ou son profil a changé. Rechargez les données avant d’enregistrer.');
  }
  if (!Array.isArray(draft.edits) || !draft.edits.length || draft.edits.length > 100) throw new GenericSectionsError('invalid_generic_edit', 'La liste des modifications est invalide.');
  const fields = new Map(schemaFields.map((field) => [field.fieldId, field]));
  // A repeated record is edited as a whole group: never misalign date, mileage
  // and description by accepting a change to only one of its parallel arrays.
  for (const edit of draft.edits) {
    const field = fields.get(edit?.fieldId);
    if (field?.cardinality !== 'repeatable') continue;
    const prefix = field.fieldId.split('[]')[0];
    const siblings = schemaFields.filter((candidate) => candidate.cardinality === 'repeatable' && candidate.fieldId.split('[]')[0] === prefix);
    const related = siblings.map((sibling) => draft.edits.find((entry) => entry?.fieldId === sibling.fieldId));
    if (related.some((entry) => !entry || !Array.isArray(entry.value) || entry.value.length !== edit.value?.length)) throw new GenericSectionsError('invalid_generic_edit', 'Une liste doit être enregistrée avec tous ses champs alignés.');
    if (edit.value.length > 100) throw new GenericSectionsError('invalid_generic_edit', 'Une liste comporte 100 lignes maximum.');
    if (Array.from({ length: edit.value.length }, (_, index) => related.every((entry) => entry.value[index] === null || entry.value[index] === '')).some(Boolean)) throw new GenericSectionsError('invalid_generic_edit', 'Complétez au moins une information par ligne, ou retirez la ligne vide.');
  }
  const patches = new Map();
  const seen = new Set();
  for (const edit of draft.edits) {
    if (!edit || Object.keys(edit).some((key) => !['fieldId', 'value'].includes(key)) || seen.has(edit.fieldId)) throw new GenericSectionsError('invalid_generic_edit', 'Modification dupliquée ou non autorisée.');
    seen.add(edit.fieldId);
    const field = fields.get(edit.fieldId);
    let value;
    try { value = validateGenericFieldValue(field, edit.value); }
    catch (error) { throw new GenericSectionsError('invalid_generic_edit', error.message); }
    const current = sections.find((section) => section.schemaSectionId === field.sectionId);
    const id = current?.id || field.sectionId;
    const patch = patches.get(id) || { ...current, id, schemaSectionId: field.sectionId,
      schemaVersion: `${root.schemaId}@${root.schemaVersion}`, title: current?.title || field.sectionId,
      status: 'imported_unreviewed', visibility: 'secret', revision: Number(current?.revision || 0) + 1,
      fields: { ...current?.fields } };
    patch.fields[field.fieldId] = { value, proofStatus: 'declared', confidence: 'low',
      sourceRefs: ['source_owner_generic_edit'], assertedBy: ownerUid, observedAt: occurredAt, visibility: 'secret' };
    patches.set(id, patch);
  }
  return [...patches.values()];
}

export async function loadGenericSectionPatches({ firestore, rootRef, draft, root, ownerUid, occurredAt }) {
  const schemaRef = firestore.doc(`schemaCatalog/${root.schemaId}/versions/${root.schemaVersion}`);
  const [schema, sectionSnapshot, catalogSections] = await Promise.all([schemaRef.get(), rootRef.collection('sections').get(), schemaRef.collection('sections').get()]);
  if (!schema.exists || schema.data().assetType !== root.assetType || schema.data().version !== root.schemaVersion) throw new GenericSectionsError('schema_not_ready', 'Le profil exact du Cartulaire est indisponible.');
  if (root.schemaDigest && root.schemaDigest !== schema.data().catalogDigest) throw new GenericSectionsError('schema_not_ready', 'L’empreinte du profil ne correspond plus à celle du Cartulaire.');
  const fieldSnapshots = await Promise.all(catalogSections.docs.map((section) => section.ref.collection('fields').get()));
  return buildGenericSectionPatches({ draft, root, schemaFields: fieldSnapshots.flatMap((snapshot) => snapshot.docs.map((field) => field.data())),
    sections: sectionSnapshot.docs.map((section) => ({ ...section.data(), id: section.id })), ownerUid, occurredAt });
}
