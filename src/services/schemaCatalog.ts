import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import type { VerticalSchema, VerticalSchemaField } from '../schema/schemaTypes.ts';

/**
 * Version de création d'une verticale (ADR-030) : version active désignée par le catalogue,
 * à défaut dernière version publiée. Même règle que la fonction serveur.
 */
export const loadCreationSchemaVersion = async (schemaId: string): Promise<string> => {
  const pointer = await getDoc(doc(db, 'schemaCatalog', schemaId));
  const data = pointer.exists() ? pointer.data() : null;
  const version = data?.activeVersion || data?.latestVersion;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Le catalogue de schémas ne désigne aucune version publiée pour ${schemaId}.`);
  }
  return version;
};

export const loadVerticalSchema = async (
  schemaId: string,
  version: string,
): Promise<VerticalSchema | null> => {
  const versionRef = doc(db, 'schemaCatalog', schemaId, 'versions', version);
  const versionSnapshot = await getDoc(versionRef);
  if (!versionSnapshot.exists()) return null;

  const sectionSnapshots = await getDocs(collection(versionRef, 'sections'));
  const fields = (await Promise.all(sectionSnapshots.docs.map(async (sectionSnapshot) => {
    const fieldSnapshots = await getDocs(collection(sectionSnapshot.ref, 'fields'));
    return fieldSnapshots.docs.map((fieldSnapshot) => fieldSnapshot.data() as VerticalSchemaField);
  }))).flat().sort((left, right) => left.fieldId.localeCompare(right.fieldId));
  const data = versionSnapshot.data();
  return {
    schemaId: data.schemaId,
    assetType: data.assetType,
    version: data.version,
    status: data.status,
    defaultVisibility: data.defaultVisibility,
    fieldCount: data.fieldCount,
    sections: data.sectionIds,
    fields,
  };
};
