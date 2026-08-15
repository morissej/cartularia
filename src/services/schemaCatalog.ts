import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import type { VerticalSchema, VerticalSchemaField } from '../schema/schemaTypes.ts';

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
